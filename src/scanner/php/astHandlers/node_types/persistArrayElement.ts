import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";
import {
    cleanPhpString,
    ensureModelField,
    isLikelyFieldName,
    linkPersists,
} from "../../semantic/fieldNodes";

export function persistArrayElementType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentMethod || !context.currentClass) return;
    if (context.currentMethod.endsWith("::__construct")) return;

    const targetClass = context.persistTargetClass;
    if (!targetClass || !graph.nodes.has(targetClass)) return;

    const keyNode = node.namedChildren[0];
    if (!keyNode) return;

    const key = cleanPhpString(keyNode.text);
    if (!isLikelyFieldName(key)) return;

    const valueNode = node.namedChildren[node.namedChildren.length - 1];
    if (valueNode && isStaticLiteralValue(valueNode)) {
        return;
    }

    const modelFieldNodeId = ensureModelField(targetClass, key, file);
    linkPersists(context.currentMethod, modelFieldNodeId, key);
}

function isStaticLiteralValue(node: Parser.SyntaxNode): boolean {
    return (
        node.type === "string" ||
        node.type === "encapsed_string" ||
        node.type === "integer" ||
        node.type === "float" ||
        node.type === "boolean" ||
        node.type === "null"
    );
}
