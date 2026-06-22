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

    let path: string | null = null;

    if (urlNode.type === "template_string") {
        path = resolveTemplateString(urlNode, context.moduleConstants);
    } else if (urlNode.type === "string") {
        path = readStringLiteral(urlNode);
    } else if (urlNode.type === "identifier" && context.moduleConstants.has(urlNode.text)) {
        path = context.moduleConstants.get(urlNode.text)!;
    }

    if (!path) {
        return null;
    }

    path = path.replace(/\$\{[^}]+\}/g, "{param}").replace(/\/+/g, "/");

    return {
        method: readHttpMethod(callNode),
        path,
    };
}

export function fetchEndpointNodeId(endpoint: FetchEndpoint): string {
    return canonicalEndpointId(endpoint.method, endpoint.path);
}
