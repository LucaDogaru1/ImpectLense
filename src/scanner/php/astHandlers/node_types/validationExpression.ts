import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";
import {
    extractValidationRulesFromArray,
    findFirstArrayInNode,
} from "../../semantic/validationRules";

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
    const arrayNode = findFirstArrayInNode(argsNode);

    if (!arrayNode) return;

    const validationRules = extractValidationRulesFromArray(arrayNode);

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
