import Parser from "tree-sitter";
import {
    normalizeInferredFetchPath,
    resolveTemplateString,
} from "../resolvers/fetchEndpointExtractor";
import { JsWalkContext } from "../walk/context";

function readArrowBodyTemplate(node: Parser.SyntaxNode | null | undefined): string | null {
    if (!node) {
        return null;
    }

    let body = node;
    if (body.type === "parenthesized_expression") {
        body = body.namedChildren[0] ?? body;
    }

    if (body.type !== "template_string") {
        return null;
    }

    return normalizeInferredFetchPath(resolveTemplateString(body, new Map()));
}

function readComputedTemplateUrl(valueNode: Parser.SyntaxNode): string | null {
    if (valueNode.type !== "call_expression") {
        return null;
    }

    const callee = valueNode.childForFieldName("function");
    if (callee?.type !== "identifier" || callee.text !== "computed") {
        return null;
    }

    const args = valueNode.childForFieldName("arguments");
    const callback = args?.namedChildren[0];
    if (!callback || callback.type !== "arrow_function") {
        return null;
    }

    return readArrowBodyTemplate(callback.childForFieldName("body"));
}

function readDeclaratorValue(node: Parser.SyntaxNode): string | null {
    const valueNode = node.childForFieldName("value");
    if (!valueNode) {
        return null;
    }

    if (valueNode.type === "string") {
        const fragment = valueNode.children.find(child => child.type === "string_fragment");
        return fragment?.text ?? valueNode.text.replace(/^["'`]|["'`]$/g, "");
    }

    return null;
}

export function trackModuleConstants(node: Parser.SyntaxNode, context: JsWalkContext): void {
    for (const child of node.children) {
        if (child.type !== "variable_declarator") {
            continue;
        }

        const name = child.childForFieldName("name")?.text;
        const valueNode = child.childForFieldName("value");
        const value =
            readDeclaratorValue(child) ??
            (valueNode ? readComputedTemplateUrl(valueNode) : null);
        if (name && value) {
            context.moduleConstants.set(name, value);
        }
    }
}
