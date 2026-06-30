import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";
import {
    extractValidationRulesFromArray,
    findFirstArrayInNode,
} from "../../semantic/validationRules";

export function extractFormRequestRules(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentMethod?.endsWith("::rules")) {
        return;
    }

    const arrayNode = findFirstArrayInNode(node);

    if (!arrayNode) {
        return;
    }

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
