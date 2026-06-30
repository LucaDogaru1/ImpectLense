import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { ensureModelField, cleanPhpString, isLikelyFieldName } from "../../semantic/fieldNodes";
import {
    applyPropertyPhpDocTypes,
    storePropertyType,
} from "../../semantic/phpDocPropertyTypes";
import { extractNamedTypeFromNode } from "../../semantic/returnTypes";
import { resolveClassName } from "../../resolvers/resolveClassName";

function findPropertyTypeNode(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
    return node.namedChildren.find(
        child =>
            child.type === "named_type" ||
            child.type === "primitive_type" ||
            child.type === "nullable_type" ||
            child.type === "optional_type" ||
            child.type === "union_type" ||
            child.type === "intersection_type"
    );
}

function storeNativePropertyTypes(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const typeNode = findPropertyTypeNode(node);

    if (!typeNode) {
        return;
    }

    const rawType = extractNamedTypeFromNode(typeNode);

    if (!rawType) {
        return;
    }

    const resolvedType = resolveClassName(rawType, context);

    if (!resolvedType) {
        return;
    }

    for (const child of node.namedChildren) {
        if (child.type !== "property_declarator" && child.type !== "property_element") {
            continue;
        }

        const nameNode =
            child.childForFieldName("name") ??
            child.namedChildren.find(namedChild => namedChild.type === "variable_name");

        if (!nameNode) {
            continue;
        }

        const propertyName = nameNode.text.replace(/^\$/, "");
        const propertyKey = `this.${propertyName}`;

        if (context.classPropertyTypes.has(propertyKey)) {
            continue;
        }

        storePropertyType(propertyName, rawType, false, context);
    }
}

export function propertyDeclarationType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentClass) return;

    applyPropertyPhpDocTypes(node, context);
    storeNativePropertyTypes(node, context);

    for (const child of node.namedChildren) {
        if (child.type !== "property_declarator" && child.type !== "property_element") continue;

        const nameNode = child.childForFieldName("name") ?? child.namedChildren.find(c => c.type === "variable_name");
        if (!nameNode) continue;

        const fieldName = cleanPhpString(nameNode.text.replace(/^\$/, ""));
        if (!isLikelyFieldName(fieldName)) continue;

        ensureModelField(context.currentClass, fieldName, file);
    }
}
