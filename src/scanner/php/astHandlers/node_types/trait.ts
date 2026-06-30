import { graph } from "../../../../graph/graph";
import { GraphNode } from "../../../../graph/GraphTypes";
import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";

export function traitType(
    rootNodeChild: Parser.SyntaxNode,
    file: string,
    context: WalkContext
): string {
    const nameNode = rootNodeChild.childForFieldName("name")?.text;

    if (!nameNode) {
        return "";
    }

    const traitId = context.currentNamespace
        ? `${context.currentNamespace}\\${nameNode}`
        : nameNode;

    graph.nodes.set(traitId, <GraphNode>{
        id: traitId,
        type: "trait",
        name: nameNode,
        file: file,
        startPosition: rootNodeChild.startPosition,
        endPosition: rootNodeChild.endPosition,
    });

    return traitId;
}
