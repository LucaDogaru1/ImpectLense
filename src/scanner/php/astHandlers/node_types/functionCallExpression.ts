import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { configReferenceType } from "./configReference";

export function functionCallExpressionType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode || nameNode.text !== "config") {
        return;
    }

    configReferenceType(node, context);
}
