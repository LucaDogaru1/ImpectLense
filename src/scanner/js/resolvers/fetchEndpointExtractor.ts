import Parser from "tree-sitter";
import { canonicalEndpointId } from "./endpointNormalizer";
import { JsWalkContext } from "../walk/context";

export interface FetchEndpoint {
    method: string;
    path: string;
}

function readStringLiteral(node: Parser.SyntaxNode | null | undefined): string | null {
    if (!node) {
        return null;
    }

    if (node.type === "string") {
        const fragment = node.children.find(child => child.type === "string_fragment");
        return fragment?.text ?? node.text.replace(/^["'`]|["'`]$/g, "");
    }

    if (node.type === "template_string") {
        return resolveTemplateString(node, new Map());
    }

    return null;
}

function resolveTemplatePart(node: Parser.SyntaxNode, constants: Map<string, string>): string {
    if (node.type === "string_fragment") {
        return node.text;
    }

    if (node.type === "template_substitution") {
        const expr = node.namedChildren[0];
        if (expr?.type === "identifier" && constants.has(expr.text)) {
            return constants.get(expr.text)!;
        }
        if (expr?.type === "identifier") {
            return `{${expr.text}}`;
        }
        return "{param}";
    }

    return "";
}

export function resolveTemplateString(
    node: Parser.SyntaxNode,
    constants: Map<string, string>
): string {
    let result = "";

    for (const child of node.children) {
        if (child.type === "template_substitution" || child.type === "string_fragment") {
            result += resolveTemplatePart(child, constants);
        }
    }

    return result;
}

function unwrapFetchUrlNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
    if (node.type === "call_expression") {
        const fn = node.childForFieldName("function");
        if (fn?.type === "identifier" && (fn.text === "unref" || fn.text === "toValue")) {
            const args = node.childForFieldName("arguments");
            const inner = args?.namedChildren[0];
            if (inner) {
                return unwrapFetchUrlNode(inner);
            }
        }
    }

    if (node.type === "member_expression") {
        const property = node.childForFieldName("property");
        if (property?.text === "value") {
            const object = node.childForFieldName("object");
            if (object) {
                return unwrapFetchUrlNode(object);
            }
        }
    }

    return node;
}

/** Pull a stable API path out of Nuxt-style host-prefixed template URLs. */
export function normalizeInferredFetchPath(path: string): string {
    let normalized = path.replace(/\$\{[^}]+\}/g, "{param}").replace(/\/+/g, "/");

    const apiMatch = normalized.match(/\/?api\/v\d+\/[^?\s]*/);
    if (apiMatch) {
        return apiMatch[0].startsWith("/") ? apiMatch[0] : `/${apiMatch[0]}`;
    }

    normalized = normalized.replace(/^(\{[^{}]+\})+/, "");
    if (normalized && !normalized.startsWith("/")) {
        return `/${normalized}`;
    }

    return normalized || "/";
}

export function resolveFetchUrlArg(
    urlNode: Parser.SyntaxNode,
    context: JsWalkContext
): string | null {
    const resolvedNode = unwrapFetchUrlNode(urlNode);
    let path: string | null = null;

    if (resolvedNode.type === "template_string") {
        path = resolveTemplateString(resolvedNode, context.moduleConstants);
    } else if (resolvedNode.type === "string") {
        path = readStringLiteral(resolvedNode);
    } else if (
        resolvedNode.type === "identifier" &&
        context.moduleConstants.has(resolvedNode.text)
    ) {
        path = context.moduleConstants.get(resolvedNode.text)!;
    }

    if (!path) {
        return null;
    }

    return normalizeInferredFetchPath(path);
}

function readHttpMethod(callNode: Parser.SyntaxNode): string {
    const args = callNode.children.filter(child => child.type === "arguments");
    const optionsArg = args[0]?.namedChildren[1];
    if (!optionsArg || optionsArg.type !== "object") {
        return "GET";
    }

    for (const child of optionsArg.children) {
        if (child.type !== "pair") {
            continue;
        }

        const key = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (key !== "method") {
            continue;
        }

        const value = child.childForFieldName("value")?.text.replace(/["']/g, "");
        if (value) {
            return value.toUpperCase();
        }
    }

    return "GET";
}

export function extractFetchEndpoint(
    callNode: Parser.SyntaxNode,
    context: JsWalkContext
): FetchEndpoint | null {
    const argsNode = callNode.children.find(child => child.type === "arguments");
    const urlNode = argsNode?.namedChildren[0];
    if (!urlNode) {
        return null;
    }

    const path = resolveFetchUrlArg(urlNode, context);
    if (!path) {
        return null;
    }

    return {
        method: readHttpMethod(callNode),
        path,
    };
}

export function isDirectFetchCallee(name: string): boolean {
    return name === "fetch" || name === "$fetch" || name === "useFetch";
}

export function fetchEndpointNodeId(endpoint: FetchEndpoint): string {
    return canonicalEndpointId(endpoint.method, endpoint.path);
}
