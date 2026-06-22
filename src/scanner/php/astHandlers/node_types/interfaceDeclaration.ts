import Parser from "tree-sitter";
import {WalkContext} from "../../walk/context";
import {graph} from "../../../../graph/graph";

export function interfaceDeclaration(rootNodeChild: Parser.SyntaxNode, file:string, context:WalkContext):string {
    const name = rootNodeChild.childForFieldName("name")?.text ?? "";

    const id = context.currentNamespace
        ? `${context.currentNamespace}\\${name}`
        : name;

    const interfaceNode = {
        id,
        type: "interface",
        name,
        file,
        startPosition: rootNodeChild.startPosition,
        endPosition: rootNodeChild.endPosition,
    };

    graph.nodes.set(id, interfaceNode);

    return id;
}