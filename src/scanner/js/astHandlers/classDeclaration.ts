import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { extractComponentKeywords } from "../resolvers/keyWordExtractor";
import { JsWalkContext } from "../walk/context";

export function classDeclarationType(
    node: Parser.SyntaxNode,
    context: JsWalkContext,
    options?: { exported?: boolean }
): string {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text;
    if (!name) {
        return "";
    }

    const classId = `${context.moduleId}::${name}`;

    graph.nodes.set(classId, {
        id: classId,
        parent: context.moduleId,
        type: "class",
        name,
        file: context.file,
        keywords: extractComponentKeywords(node, { seed: name, skipStrings: true }),
        description: options?.exported ? "Exported class" : "Class declaration",
    });

    graph.edges.set(`${context.moduleId}->${classId}`, {
        from: context.moduleId,
        to: classId,
        type: "CONTAINS",
    });

    return classId;
}
