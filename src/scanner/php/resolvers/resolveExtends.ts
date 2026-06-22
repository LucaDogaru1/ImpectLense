import {WalkContext} from "../walk/context";
import Parser from "tree-sitter";
import {resolveClassName} from "./resolveClassName";
import {graph} from "../../../graph/graph";

export function resolveExtends(child: Parser.SyntaxNode, context: WalkContext)
{
    if(!context.currentClass) return;

    const baseClause = child.namedChildren.find(grandChild =>
        grandChild.type === "base_clause"
    );

    if(!baseClause) return;

    for (const child of baseClause.namedChildren) {
        if (
            child.type !== "name"
        ) {
            continue;
        }

        const parentClassName = resolveClassName(child.text, context);

        graph.edges.set(parentClassName + "->" + context.currentClass, {
            from: context.currentClass,
            to: parentClassName,
            type: "EXTENDS",
        });
    }
}