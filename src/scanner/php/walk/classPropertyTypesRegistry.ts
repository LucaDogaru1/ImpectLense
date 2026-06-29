import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { resolveClassName } from "../resolvers/resolveClassName";
import { WalkContext } from "./context";

export const classPropertyTypesRegistry = new Map<string, Map<string, string>>();

export function classPropertyTypesForClass(
    classNode: Parser.SyntaxNode,
    context: WalkContext,
    classId: string
): Map<string, string> {
    const types = classPropertyTypesRegistry.get(classId) ?? new Map<string, string>();
    const baseClause = classNode.namedChildren.find(child => child.type === "base_clause");
    if (baseClause) {
        for (const child of baseClause.namedChildren) {
            if (child.type !== "name") {
                continue;
            }

            const parentTypes = classPropertyTypesRegistry.get(
                resolveClassName(child.text, context)
            );

            if (parentTypes) {
                for (const [key, value] of parentTypes) {
                    types.set(key, value);
                }
            }
        }
    }

    classPropertyTypesRegistry.set(classId, types);
    return types;
}

export function propagateClassPropertyTypes(): void {
    const extendsEdges = [...graph.edges.values()].filter(edge => edge.type === "EXTENDS");

    for (let pass = 0; pass < 8; pass += 1) {
        for (const { from: child, to: parent } of extendsEdges) {
            const parentTypes = classPropertyTypesRegistry.get(parent);
            if (!parentTypes) {
                continue;
            }

            const childTypes = classPropertyTypesRegistry.get(child) ?? new Map();
            for (const [key, value] of parentTypes) {
                childTypes.set(key, value);
            }
            classPropertyTypesRegistry.set(child, childTypes);
        }
    }
}
