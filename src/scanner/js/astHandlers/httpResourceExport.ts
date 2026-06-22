import Parser from "tree-sitter";
import { getScanConfig } from "../../../shared/config/scanRuntime";
import {
    HttpResourceDefinition,
    registerHttpResource,
} from "../resolvers/httpResourceRegistry";
import { JsWalkContext } from "../walk/context";

function resourceClassPattern(): RegExp {
    const pattern = getScanConfig().httpResourceClassPattern ?? "Resource";
    return new RegExp(`${pattern}$`, "i");
}

function readStringFromNode(node: Parser.SyntaxNode | null | undefined): string | null {
    if (!node) {
        return null;
    }

    if (node.type === "string") {
        const fragment = node.children.find(child => child.type === "string_fragment");
        return fragment?.text ?? node.text.replace(/^["'`]|["'`]$/g, "");
    }

    if (node.type === "template_string") {
        return node.children
            .filter(child => child.type === "string_fragment")
            .map(child => child.text)
            .join("");
    }

    return null;
}

function readUrlFromNewExpression(node: Parser.SyntaxNode): HttpResourceDefinition | null {
    if (node.type !== "new_expression") {
        return null;
    }

    const constructor = node.childForFieldName("constructor");
    const className = constructor?.type === "identifier"
        ? constructor.text
        : constructor?.text ?? "";

    const args = node.childForFieldName("arguments");
    const configObject = args?.namedChildren.find(child => child.type === "object");
    if (!configObject) {
        return null;
    }

    let url: string | null = null;

    for (const child of configObject.children) {
        if (child.type !== "pair") {
            continue;
        }

        const key = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (key !== "url") {
            continue;
        }

        url = readStringFromNode(child.childForFieldName("value"));
        break;
    }

    if (!url) {
        return null;
    }

    if (className && !resourceClassPattern().test(className) && !url.startsWith("/")) {
        return null;
    }

    return {
        urlTemplate: url,
        resourceClass: className || undefined,
    };
}

function readPropertyNameFromPair(pairNode: Parser.SyntaxNode): string | null {
    if (pairNode.type !== "pair") {
        return null;
    }

    const keyNode = pairNode.childForFieldName("key");
    if (!keyNode) {
        return null;
    }

    return keyNode.text.replace(/["']/g, "");
}

export function trackHttpResourcesInObject(
    objectNode: Parser.SyntaxNode,
    context: JsWalkContext
): void {
    for (const child of objectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const propertyName = readPropertyNameFromPair(child);
        const valueNode = child.childForFieldName("value");
        if (!propertyName || !valueNode) {
            continue;
        }

        const definition = readUrlFromNewExpression(valueNode);
        if (definition) {
            registerHttpResource(context.moduleId, propertyName, definition);
        }
    }
}

export function trackHttpResourceDeclarator(
    declarator: Parser.SyntaxNode,
    context: JsWalkContext
): void {
    const name = declarator.childForFieldName("name")?.text;
    const valueNode = declarator.childForFieldName("value");
    if (!name || !valueNode) {
        return;
    }

    const definition = readUrlFromNewExpression(valueNode);
    if (definition) {
        registerHttpResource(context.moduleId, name, definition);
    }
}
