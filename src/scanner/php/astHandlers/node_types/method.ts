import { graph } from "../../../../graph/graph";
import { GraphNode } from "../../../../graph/GraphTypes";
import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import {extractNodeKeywords} from "../../resolvers/keyWordExtractor";

export function methodType(
    rootNodeChild: Parser.SyntaxNode,
    file: string,
    context: WalkContext
): string {
    const visibility =
        rootNodeChild.children.find(child => child.type === "visibility_modifier")?.text
        ?? "public";

    const isStatic = rootNodeChild.children.some(
        child => child.type === "static_modifier"
    );

    const nameNode = rootNodeChild.childForFieldName("name")?.text;
    const parent = context.currentClass ?? context.currentInterface;

    if (!nameNode || !parent) return "";

    const methodName = parent + "::" + nameNode;

    const keywordData = extractNodeKeywords(rootNodeChild, nameNode);

    graph.nodes.set(methodName, <GraphNode>{
        id: methodName,
        parent: parent,
        type: "method",
        name: nameNode,
        file: file,
        isStatic: isStatic,
        visibility: visibility,
        startPosition: rootNodeChild.startPosition,
        endPosition: rootNodeChild.endPosition,
        keywords: keywordData.keywords,
        description: keywordData.description,
    });

    graph.edges.set(parent + "->" + methodName, {
        from: parent,
        to: methodName,
        type: "CONTAINS",
    });

    return methodName;
}