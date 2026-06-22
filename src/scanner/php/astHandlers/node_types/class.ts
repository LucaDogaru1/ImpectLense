import {graph} from "../../../../graph/graph";
import {GraphNode} from "../../../../graph/GraphTypes";
import Parser from "tree-sitter";
import {WalkContext} from "../../walk/context";
import { attachClassRoles } from "../../semantic/classRoles";

export function classType(rootNodeChild: Parser.SyntaxNode, file: string, context: WalkContext): string {
    const nameNode = rootNodeChild.childForFieldName("name")?.text;

    if(!nameNode) return "";

    const classId = context.currentNamespace ? context.currentNamespace + "\\" + nameNode : nameNode;

    graph.nodes.set(classId, <GraphNode>{
        id: classId,
        type: 'class',
        name: nameNode,
        file: file,
        startPosition: rootNodeChild.startPosition,
        endPosition: rootNodeChild.endPosition,
    })

    attachClassRoles(classId, file);

    return classId;
}