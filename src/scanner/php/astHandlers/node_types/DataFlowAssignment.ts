import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";

export function dataFlowAssignment(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentMethod) {
        return;
    }

    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");

    if (!left || !right) {
        return;
    }

    const targetVar = getRootVariableName(left.text);

    if (!targetVar) {
        return;
    }

    const requestFields = findAllRequestInputFields(right);

    if (requestFields.length === 0) {
        return;
    }

    if (!context.dataFlows.has(targetVar)) {
        context.dataFlows.set(targetVar, new Set());
    }

    const flowSet = context.dataFlows.get(targetVar)!;

    for (const field of requestFields) {
        flowSet.add(field);

        const requestFieldId = `request_field:${field}`;
        const variableFieldId =
            `${context.currentMethod}::${targetVar}.${field}`;

        graph.nodes.set(requestFieldId, {
            id: requestFieldId,
            type: "request_field",
            name: field,
        });

        graph.nodes.set(variableFieldId, {
            id: variableFieldId,
            type: "variable_field",
            name: `${targetVar}.${field}`,
            scope: context.currentMethod,
        });

        graph.edges.set(
            `${requestFieldId}->${variableFieldId}`,
            {
                from: requestFieldId,
                to: variableFieldId,
                type: "ASSIGNS",
                confidence: 1,
            }
        );
    }
}

function getRootVariableName(value: string): string | null {
    const match = value.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/);
    return match?.[0] ?? null;
}

function findAllRequestInputFields(
    node: Parser.SyntaxNode
): string[] {
    const result = new Set<string>();

    function walk(current: Parser.SyntaxNode): void {
        if (current.type === "member_call_expression") {
            const method =
                current.childForFieldName("name")?.text;

            const object =
                current.childForFieldName("object")?.text ?? "";

            if (
                method === "input" &&
                object.includes("$request")
            ) {
                const args =
                    current.childForFieldName("arguments");

                const stringNode =
                    findFirstString(args);

                if (stringNode) {
                    result.add(
                        cleanPhpString(stringNode.text)
                    );
                }
            }
        }

        for (const child of current.namedChildren) {
            walk(child);
        }
    }

    walk(node);

    return [...result];
}

function findFirstString(
    node: Parser.SyntaxNode | null | undefined
): Parser.SyntaxNode | undefined {
    if (!node) {
        return undefined;
    }

    if (node.type === "string") {
        return node;
    }

    for (const child of node.namedChildren) {
        const found = findFirstString(child);

        if (found) {
            return found;
        }
    }

    return undefined;
}

function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}