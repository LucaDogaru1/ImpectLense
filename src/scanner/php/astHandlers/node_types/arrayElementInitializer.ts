import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";

export function arrayElementInitializerType(
    node: Parser.SyntaxNode,
    context: WalkContext
) {
    const keyNode = node.children[0];
    const valueNode = node.children[node.children.length - 1];

    if (!keyNode) {
        return;
    }

    const key = cleanPhpString(keyNode.text);
    const value = valueNode?.text ?? "";

    const kind = inferFieldKind(key, value, context);

    context.extractedFields.push({
        kind,
        key,
        value,
        className: context.currentClass,
        methodName: context.currentMethod,
    });
}

function inferFieldKind(
    key: string,
    value: string,
    context: WalkContext
) {
    if (value.includes("$request->input(")) {
        return "request_field";
    }

    if (
        value.includes("required") ||
        value.includes("string") ||
        value.includes("url") ||
        value.includes("max:")
    ) {
        return "validation_field";
    }

    return "array_field";
}

function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}