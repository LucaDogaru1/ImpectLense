import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";

export function dataFlowMethodCall(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentMethod) return;

    const args = node.childForFieldName("arguments");
    if (!args) return;

    const targetMethod = resolveTargetMethod(node, context);
    if (!targetMethod) return;

    args.namedChildren.forEach((arg, index) => {
        const variableName = getRootVariableName(arg.text);
        if (!variableName) return;

        const fields = context.dataFlows.get(variableName);
        if (!fields) return;

        const targetParameterId = findTargetParameterByIndex(
            targetMethod,
            index
        );

        for (const field of fields) {
            const sourceVariableFieldId =
                `${context.currentMethod}::${variableName}.${field}`;

            graph.edges.set(
                `${sourceVariableFieldId}->${targetMethod}:FLOWS_TO:${index}`,
                {
                    from: sourceVariableFieldId,
                    to: targetMethod,
                    type: "FLOWS_TO",
                    via: variableName,
                    argumentIndex: index,
                    confidence: 1,
                }
            );

            if (targetParameterId) {
                graph.edges.set(
                    `${sourceVariableFieldId}->${targetParameterId}:ARGUMENT_TO:${index}`,
                    {
                        from: sourceVariableFieldId,
                        to: targetParameterId,
                        type: "ARGUMENT_TO",
                        via: variableName,
                        argumentIndex: index,
                        confidence: 1,
                    }
                );
            }
        }
    });
}

function findTargetParameterByIndex(
    targetMethod: string,
    argumentIndex: number
): string | null {
    for (const edge of graph.edges.values()) {
        if (
            edge.from === targetMethod &&
            edge.type === "HAS_PARAMETER" &&
            edge.argumentIndex === argumentIndex
        ) {
            return edge.to;
        }
    }

    return null;
}

function resolveTargetMethod(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | null {
    const method = node.childForFieldName("name")?.text;
    const object = node.childForFieldName("object")?.text;

    if (!method || !object) return null;

    if (object.startsWith("$this->")) {
        const property = object.replace("$this->", "");

        const className =
            context.classPropertyTypes.get(property) ??
            context.classPropertyTypes.get(`this.${property}`);

        if (!className) return null;

        return `${className}::${method}`;
    }

    return null;
}

function getRootVariableName(value: string): string | null {
    const match = value.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/);

    return match?.[0] ?? null;
}