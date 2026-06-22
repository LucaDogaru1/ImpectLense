import Parser from "tree-sitter";
import { endpointNodeId } from "../../php/routes/endpointId";
import { graph } from "../../../graph/graph";
import { JsWalkContext } from "../walk/context";
import { resolveHttpResourceChain } from "./httpResourceRegistry";
import { resolveTemplateString } from "./fetchEndpointExtractor";

export interface ParsedMemberCall {
    chain: string[];
    method: string;
}

const HTTP_GET_METHODS = new Set(["fetch", "get", "index", "show", "list"]);
const HTTP_POST_METHODS = new Set(["post", "create", "store", "save"]);
const HTTP_PUT_METHODS = new Set(["put", "update", "patch", "sync"]);
const HTTP_DELETE_METHODS = new Set(["delete", "destroy", "remove"]);

function inferHttpMethod(methodName: string, callNode: Parser.SyntaxNode): string {
    const lower = methodName.toLowerCase();

    if (HTTP_GET_METHODS.has(lower)) {
        return "GET";
    }
    if (HTTP_POST_METHODS.has(lower)) {
        return "POST";
    }
    if (HTTP_DELETE_METHODS.has(lower)) {
        return "DELETE";
    }
    if (HTTP_PUT_METHODS.has(lower)) {
        if (lower === "sync") {
            const args = callNode.childForFieldName("arguments");
            const verbArg = args?.namedChildren[0];
            const verb = verbArg?.type === "string"
                ? verbArg.text.replace(/["']/g, "").toUpperCase()
                : null;
            if (verb === "PUT" || verb === "PATCH" || verb === "POST" || verb === "DELETE") {
                return verb;
            }
            return "PUT";
        }
        return lower === "patch" ? "PATCH" : "PUT";
    }

    return "GET";
}

function normalizeUrlTemplate(url: string): string {
    return url
        .replace(/\{[^}]+\}/g, "{param}")
        .replace(/\/+/g, "/");
}

function resolveCallUrl(
    urlTemplate: string,
    callNode: Parser.SyntaxNode,
    context: JsWalkContext
): string {
    let path = normalizeUrlTemplate(urlTemplate);

    const hasIdPlaceholder = /\{param\}/.test(path);
    const args = callNode.childForFieldName("arguments");
    const firstArg = args?.namedChildren[0];

    if (!hasIdPlaceholder) {
        return path;
    }

    if (firstArg?.type === "array" && firstArg.namedChildren.length === 0) {
        return path.replace(/\/{param\}/, "").replace(/\/+$/, "") || path;
    }

    if (firstArg?.type === "string" || firstArg?.type === "template_string") {
        if (firstArg.type === "template_string") {
            path = resolveTemplateString(firstArg, context.moduleConstants);
        } else {
            path = firstArg.text.replace(/^["'`]|["'`]$/g, "");
        }
    }

    return normalizeUrlTemplate(path);
}

export function parseMemberCall(node: Parser.SyntaxNode): ParsedMemberCall | null {
    const fn = node.childForFieldName("function");
    if (!fn || fn.type !== "member_expression") {
        return null;
    }

    const method = fn.childForFieldName("property")?.text;
    if (!method) {
        return null;
    }

    const chain: string[] = [];
    let current: Parser.SyntaxNode | null = fn.childForFieldName("object");

    while (current) {
        if (current.type === "identifier") {
            chain.unshift(current.text);
            break;
        }

        if (current.type === "member_expression") {
            const property = current.childForFieldName("property")?.text;
            if (property) {
                chain.unshift(property);
            }
            current = current.childForFieldName("object");
            continue;
        }

        break;
    }

    if (chain.length === 0) {
        return null;
    }

    return { chain, method };
}

function readDirectHttpUrl(callNode: Parser.SyntaxNode, context: JsWalkContext): string | null {
    const args = callNode.childForFieldName("arguments");
    const urlNode = args?.namedChildren[0];
    if (!urlNode) {
        return null;
    }

    if (urlNode.type === "string") {
        return normalizeUrlTemplate(urlNode.text.replace(/^["'`]|["'`]$/g, ""));
    }

    if (urlNode.type === "template_string") {
        return normalizeUrlTemplate(resolveTemplateString(urlNode, context.moduleConstants));
    }

    return null;
}

export function extractHttpClientEndpoint(
    callNode: Parser.SyntaxNode,
    context: JsWalkContext
): { method: string; path: string; via: string } | null {
    const memberCall = parseMemberCall(callNode);
    if (!memberCall) {
        return null;
    }

    const httpMethod = inferHttpMethod(memberCall.method, callNode);
    const via = `${memberCall.chain.join(".")}.${memberCall.method}`;

    if (memberCall.chain.length >= 1) {
        const clientRoot = memberCall.chain[0]!.toLowerCase();
        const clientVerb = memberCall.method.toLowerCase();
        const knownHttpClients = new Set(["http", "axios", "client"]);

        if (
            knownHttpClients.has(clientRoot) &&
            (HTTP_GET_METHODS.has(clientVerb) ||
                HTTP_POST_METHODS.has(clientVerb) ||
                HTTP_PUT_METHODS.has(clientVerb) ||
                HTTP_DELETE_METHODS.has(clientVerb))
        ) {
            const path = readDirectHttpUrl(callNode, context);
            if (path) {
                return { method: httpMethod, path, via };
            }
        }
    }

    const importRoot = memberCall.chain.length >= 2 && context.imports.has(memberCall.chain[0]!)
        ? context.imports.get(memberCall.chain[0]!)!
        : context.moduleId;

    const chainForLookup =
        memberCall.chain.length >= 2 && context.imports.has(memberCall.chain[0]!)
            ? memberCall.chain.slice(1)
            : memberCall.chain;

    const definition = resolveHttpResourceChain(importRoot, context.imports, chainForLookup);

    if (!definition) {
        return null;
    }

    const path = resolveCallUrl(definition.urlTemplate, callNode, context);
    return { method: httpMethod, path, via };
}

export function recordHttpClientEndpoint(
    callNode: Parser.SyntaxNode,
    caller: string,
    context: JsWalkContext
): boolean {
    const endpoint = extractHttpClientEndpoint(callNode, context);
    if (!endpoint) {
        return false;
    }

    const endpointId = endpointNodeId(endpoint.method, endpoint.path);
    const label = `${endpoint.method} ${endpoint.path}`;

    graph.nodes.set(endpointId, {
        id: endpointId,
        type: "api_endpoint",
        name: label,
        file: context.file,
        keywords: [
            endpoint.method.toLowerCase(),
            ...endpoint.path.split("/").filter(part => part && !part.startsWith("{")),
        ],
        description: "HTTP endpoint inferred from HTTP client call",
    });

    graph.edges.set(`${caller}->${endpointId}:HTTP:${endpoint.via}`, {
        from: caller,
        to: endpointId,
        type: "HTTP_REQUEST",
        via: endpoint.via,
        reason: label,
        confidence: 0.85,
    });

    return true;
}
