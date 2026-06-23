import Parser from "tree-sitter";
import { cleanPhpString, isLikelyFieldName } from "./fieldNodes";

export interface NestedFieldEntry {
    path: string;
    modelProperty: string | null;
}

function isArrayLiteral(node: Parser.SyntaxNode | null | undefined): node is Parser.SyntaxNode {
    if (!node) {
        return false;
    }

    return (
        node.type === "array_creation_expression" ||
        node.type === "short_array_creation_expression"
    );
}

export function extractThisPropertyName(valueText: string): string | null {
    const match = valueText.match(/\$this->([a-zA-Z_][a-zA-Z0-9_]*)/);
    return match?.[1] ?? null;
}

export function extractPropertyAccessPath(valueText: string): string | null {
    const property = extractThisPropertyName(valueText);
    if (!property) {
        return null;
    }

    let path = property;

    for (const segment of valueText.matchAll(/\[\s*['"]([^'"]+)['"]\s*\]/g)) {
        const key = segment[1];
        if (key && isLikelyFieldName(key)) {
            path += `.${key}`;
        }
    }

    return path;
}

export function extractNestedArrayFieldEntries(
    arrayNode: Parser.SyntaxNode,
    prefix = ""
): NestedFieldEntry[] {
    const entries: NestedFieldEntry[] = [];

    for (const child of arrayNode.namedChildren) {
        if (child.type !== "array_element_initializer") {
            continue;
        }

        const keyNode = child.namedChildren[0];
        if (!keyNode) {
            continue;
        }

        const key = cleanPhpString(keyNode.text);
        if (!isLikelyFieldName(key)) {
            continue;
        }

        const path = prefix ? `${prefix}.${key}` : key;
        const valueNode = child.namedChildren[child.namedChildren.length - 1];
        const valueText = valueNode?.text ?? "";
        const modelProperty =
            extractPropertyAccessPath(valueText) ?? extractThisPropertyName(valueText);

        entries.push({ path, modelProperty });

        if (isArrayLiteral(valueNode)) {
            entries.push(...extractNestedArrayFieldEntries(valueNode, path));
        }
    }

    return entries;
}

export function collectModelFieldPathsForProperty(
    className: string,
    propertyName: string,
    modelFieldIds: Iterable<{ id: string; name?: string | null }>
): string[] {
    const paths = new Set<string>([propertyName]);
    const prefix = `${propertyName}.`;

    for (const node of modelFieldIds) {
        if (!node.id.startsWith(`model_field:${className}:`)) {
            continue;
        }

        const name = node.name ?? node.id.split(":").pop() ?? "";
        if (name === propertyName || name.startsWith(prefix)) {
            paths.add(name);
        }
    }

    return [...paths];
}
