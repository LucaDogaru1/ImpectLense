import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { ensureModelField, cleanPhpString, isLikelyFieldName } from "../../semantic/fieldNodes";
import { applyPropertyPhpDocTypes } from "../../semantic/phpDocPropertyTypes";

export function propertyDeclarationType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentClass) return;

    applyPropertyPhpDocTypes(node, context);

    for (const child of node.namedChildren) {
        if (child.type !== "property_declarator" && child.type !== "property_element") continue;

        const nameNode = child.childForFieldName("name") ?? child.namedChildren.find(c => c.type === "variable_name");
        if (!nameNode) continue;

        const fieldName = cleanPhpString(nameNode.text.replace(/^\$/, ""));
        if (!isLikelyFieldName(fieldName)) continue;

        ensureModelField(context.currentClass, fieldName, file);
    }
}
