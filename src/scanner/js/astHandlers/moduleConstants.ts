import Parser from "tree-sitter";
import { JsWalkContext } from "../walk/context";

function readDeclaratorValue(node: Parser.SyntaxNode): string | null {
    const valueNode = node.childForFieldName("value");
    if (!valueNode) {
        return null;
    }

    if (valueNode.type === "string") {
        const fragment = valueNode.children.find(child => child.type === "string_fragment");
        return fragment?.text ?? valueNode.text.replace(/^["'`]|["'`]$/g, "");
    }

    return null;
}

export function trackModuleConstants(node: Parser.SyntaxNode, context: JsWalkContext): void {
    for (const child of node.children) {
        if (child.type !== "variable_declarator") {
            continue;
        }

        const name = child.childForFieldName("name")?.text;
        const value = readDeclaratorValue(child);
        if (name && value) {
            context.moduleConstants.set(name, value);
        }
    }
}
