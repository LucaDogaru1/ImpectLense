import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { extractComponentKeywords } from "../resolvers/keyWordExtractor";
import { JsWalkContext } from "../walk/context";
import { attachVueComponentRoles } from "../semantic/componentRoles";

export function functionDeclarationType(
    node: Parser.SyntaxNode,
    context: JsWalkContext,
    options?: { exported?: boolean }
): string {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text;
    if (!name) {
        return "";
    }

    const functionId = `${context.moduleId}::${name}`;
    const keywords = extractComponentKeywords(node, { seed: name, skipStrings: true });
    const nodeType = options?.exported && name.startsWith("use") ? "composable" : "method";

    graph.nodes.set(functionId, {
        id: functionId,
        parent: context.moduleId,
        type: nodeType,
        name,
        file: context.file,
        keywords,
        description: options?.exported ? "Exported function" : "Function declaration",
    });

    graph.edges.set(`${context.moduleId}->${functionId}`, {
        from: context.moduleId,
        to: functionId,
        type: "CONTAINS",
    });

    if (options?.exported && name.startsWith("use")) {
        attachVueComponentRoles(functionId, name, context.file);
    }

    return functionId;
}
