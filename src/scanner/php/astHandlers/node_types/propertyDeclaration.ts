import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { ensureModelField, cleanPhpString, isLikelyFieldName } from "../../semantic/fieldNodes";

export function propertyDeclarationType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentClass) return;

    for (const child of node.namedChildren) {
        if (child.type !== "property_declarator") continue;

        const nameNode = child.childForFieldName("name") ?? child.namedChildren.find(c => c.type === "variable_name");
        if (!nameNode) continue;

        const fieldName = cleanPhpString(nameNode.text.replace(/^\$/, ""));
        if (!isLikelyFieldName(fieldName)) continue;

        ensureModelField(context.currentClass, fieldName, file);
    }
}
