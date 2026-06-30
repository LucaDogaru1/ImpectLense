import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";
import { lookupMethodTarget } from "../../resolvers/lookupMethodOnType";
import { resolveExpressionType } from "../../semantic/resolveExpressionType";
import { resolveDataFlowSourceId } from "./DataFlowAssignment";
import { argumentsNode, rootVariableFromArgument } from "../argumentsNode";

export function dataFlowMethodCall(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentMethod) return;

    const args = argumentsNode(node);
    if (!args) return;

    const targetMethod = resolveTargetMethod(node, context);
    if (!targetMethod) return;

    args.namedChildren.forEach((arg, index) => {
        const variableName = rootVariableFromArgument(arg);
        if (!variableName) return;

        const fields = context.dataFlows.get(variableName);
        if (!fields) return;

        for (const field of fields) {
            const sourceId = resolveDataFlowSourceId(
                context.currentMethod!,
                variableName,
                field
            );

            graph.edges.set(`${sourceId}->${targetMethod}:FLOWS_TO:${index}`, {
                from: sourceId,
                to: targetMethod,
                type: "FLOWS_TO",
                via: variableName,
                argumentIndex: index,
                confidence: 1,
            });
        }
    });
}

function resolveTargetMethod(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | null {
    const methodName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object");

    if (!methodName || !objectNode) return null;

    const objectType = resolveExpressionType(objectNode, context);

    if (!objectType) return null;

    return lookupMethodTarget(objectType, methodName) ?? null;
}
