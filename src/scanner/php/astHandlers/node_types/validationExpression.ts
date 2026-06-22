import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";

export function validationExpressionType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const calledName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object")?.text ?? "";

    if (calledName !== "validate") return;
    if (!objectNode.includes("$request")) return;
    if (!context.currentMethod) return;

    const argsNode = node.childForFieldName("arguments");
    const arrayNode = findFirstDescendantOfType(argsNode, "array_creation_expression");

    if (!arrayNode) return;

    const validationRules = extractValidationRules(arrayNode);

    for (const rule of validationRules) {
        const validationId = `validation:${context.currentMethod}:${rule.field}`;
        const requestFieldId = `request_field:${rule.field}`;

        graph.nodes.set(validationId, {
            id: validationId,
            type: "validation_rule",
            name: `${rule.field}: ${rule.rules}`,
        });

        graph.nodes.set(requestFieldId, {
            id: requestFieldId,
            type: "request_field",
            name: rule.field,
        });

        graph.edges.set(`${context.currentMethod}->${validationId}`, {
            from: context.currentMethod,
            to: validationId,
            type: "VALIDATES",
        });

        graph.edges.set(`${validationId}->${requestFieldId}`, {
            from: validationId,
            to: requestFieldId,
            type: "VALIDATES_FIELD",
        });
    }
}

function extractValidationRules(arrayNode: Parser.SyntaxNode): Array<{
    field: string;
    rules: string;
}> {
    const result: Array<{ field: string; rules: string }> = [];

    for (const child of arrayNode.namedChildren) {
        if (child.type !== "array_element_initializer") continue;

        const strings = child.namedChildren.filter(c => c.type === "string");

        const keyNode = strings[0];
        const valueNode = strings[1];

        if (!keyNode || !valueNode) continue;

        const field = cleanPhpString(keyNode.text);
        const rules = cleanPhpString(valueNode.text);

        if (!field || !rules) continue;

        result.push({ field, rules });
    }

    return result;
}

function findFirstDescendantOfType(
    node: Parser.SyntaxNode | null | undefined,
    type: string
): Parser.SyntaxNode | undefined {
    if (!node) return undefined;

    if (node.type === type) return node;

    for (const child of node.namedChildren) {
        const found = findFirstDescendantOfType(child, type);

        if (found) return found;
    }

    return undefined;
}

function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}