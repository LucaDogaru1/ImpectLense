import Parser from "tree-sitter";
import {WalkContext} from "../walk/context";
import {resolveClassName} from "./resolveClassName";
import {graph} from "../../../graph/graph";

export function resolveImplements(child: Parser.SyntaxNode, context: WalkContext) {
    if(!context.currentClass) return;

    const clause = child.namedChildren.find(grandChild =>
        grandChild.type === "class_interface_clause");

    if(!clause) return;

    for (const child of clause.namedChildren) {
        if (
            child.type !== "name" &&
            child.type !== "qualified_name" &&
            child.type !== "namespace_name"
        ) {
            continue;
        }

        const interfaceName = resolveClassName(child.text, context);

        graph.edges.set(interfaceName + "->" + context.currentClass, {
            from: context.currentClass,
            to: interfaceName,
            type: "IMPLEMENTS",
        });
    }
}