import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { resolveClassName } from "./resolveClassName";
import { WalkContext } from "../walk/context";

export function resolveTraits(classNode: Parser.SyntaxNode, context: WalkContext): void {
    if (!context.currentClass) {
        return;
    }

    for (const child of classNode.namedChildren) {
        if (child.type !== "declaration_list") {
            continue;
        }

        for (const declaration of child.namedChildren) {
            if (declaration.type !== "use_declaration") {
                continue;
            }

            for (const nameNode of declaration.namedChildren) {
                if (nameNode.type !== "name") {
                    continue;
                }

                const traitName = resolveClassName(nameNode.text, context);

                graph.edges.set(`${context.currentClass}->${traitName}:USES_TRAIT`, {
                    from: context.currentClass,
                    to: traitName,
                    type: "USES_TRAIT",
                });
            }
        }
    }
}
