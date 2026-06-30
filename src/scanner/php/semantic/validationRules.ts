import Parser from "tree-sitter";
import { cleanPhpString } from "./fieldNodes";

export function extractValidationRulesFromArray(arrayNode: Parser.SyntaxNode): Array<{
    field: string;
    rules: string;
}> {
    const result: Array<{ field: string; rules: string }> = [];

    for (const child of arrayNode.namedChildren) {
        if (child.type !== "array_element_initializer") {
            continue;
        }

        const strings = child.namedChildren.filter(entry => entry.type === "string");
        const keyNode = strings[0];
        const valueNode = strings[1];

        if (!keyNode || !valueNode) {
            continue;
        }

        const field = cleanPhpString(keyNode.text);
        const rules = cleanPhpString(valueNode.text);

        if (!field || !rules) {
            continue;
        }

        result.push({ field, rules });
    }

    return result;
}

export function findFirstArrayInNode(
    node: Parser.SyntaxNode | null | undefined
): Parser.SyntaxNode | undefined {
    if (!node) {
        return undefined;
    }

    if (
        node.type === "array_creation_expression" ||
        node.type === "short_array_creation_expression"
    ) {
        return node;
    }

    for (const child of node.namedChildren) {
        const found = findFirstArrayInNode(child);

        if (found) {
            return found;
        }
    }

    return undefined;
}
