import Parser from "tree-sitter";
import { WalkContext } from "../walk/context";
import { resolveClassName } from "../resolvers/resolveClassName";
import { lookupMethodReturnType } from "../resolvers/lookupMethodOnType";
import { isBuiltinTypeName } from "./builtinTypes";

export function parsePhpDocReturnType(docComment: string): { typeName: string; isArray: boolean } | null {
    const match = docComment.match(/@return\s+([A-Za-z0-9_\\|]+)(\[\])?/);

    if (!match) {
        return null;
    }

    const rawType = match[1]!.split("|")[0]!.trim();

    if (!rawType || isBuiltinTypeName(rawType)) {
        return null;
    }

    return {
        typeName: rawType,
        isArray: match[2] === "[]",
    };
}

export function parsePhpDocPropertyAnnotations(
    docComment: string
): Array<{ typeName: string; propertyName: string; isArray: boolean }> {
    const results: Array<{ typeName: string; propertyName: string; isArray: boolean }> = [];

    for (const match of docComment.matchAll(
        /@property(?:-(?:read|write))?\s+(\S+)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g
    )) {
        let rawType = match[1]!.split("|")[0]!.trim();
        const isArray = rawType.endsWith("[]");

        if (isArray) {
            rawType = rawType.slice(0, -2);
        }

        if (!rawType || isBuiltinTypeName(rawType)) {
            continue;
        }

        results.push({
            typeName: rawType,
            propertyName: match[2]!,
            isArray,
        });
    }

    return results;
}

export function parsePhpDocVarType(docComment: string): { typeName: string; isArray: boolean } | null {
    const match = docComment.match(/@var\s+([A-Za-z0-9_\\|]+)(\[\])?/);

    if (!match) {
        return null;
    }

    const rawType = match[1]!.split("|")[0]!.trim();

    if (!rawType || isBuiltinTypeName(rawType)) {
        return null;
    }

    return {
        typeName: rawType,
        isArray: match[2] === "[]",
    };
}

export function readPrecedingDocComment(node: Parser.SyntaxNode): string | null {
    const parent = node.parent;

    if (!parent) {
        return null;
    }

    const index = parent.children.indexOf(node);

    if (index <= 0) {
        return null;
    }

    for (let siblingIndex = index - 1; siblingIndex >= 0; siblingIndex -= 1) {
        const sibling = parent.children[siblingIndex];

        if (sibling?.type === "comment") {
            return sibling.text;
        }

        if (sibling && sibling.type !== "comment" && sibling.namedChildCount > 0) {
            break;
        }
    }

    return null;
}

export function storePropertyType(
    propertyName: string,
    typeName: string,
    isArray: boolean,
    context: WalkContext
): void {
    if (isBuiltinTypeName(typeName)) {
        return;
    }

    const resolvedType = resolveClassName(typeName, context);
    const propertyKey = `this.${propertyName}`;

    if (isArray) {
        context.classPropertyTypes.set(propertyKey, `${resolvedType}[]`);
        context.classPropertyTypes.set(`${propertyKey}[]`, resolvedType);
        return;
    }

    context.classPropertyTypes.set(propertyKey, resolvedType);
}

export function elementTypeFromCollectionType(collectionType: string | undefined): string | undefined {
    if (!collectionType?.endsWith("[]")) {
        return undefined;
    }

    return collectionType.slice(0, -2);
}

function resolveThisPropertyType(
    propertyName: string,
    context: WalkContext
): string | undefined {
    const propertyKey = `this.${propertyName}`;

    return (
        context.classPropertyTypes.get(propertyKey) ??
        context.variableTypes.get(`$this->${propertyName}`) ??
        context.variableTypes.get(propertyName)
    );
}

export function resolveCollectionElementType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const collectionType = resolveCollectionExpressionType(node, context);

    return elementTypeFromCollectionType(collectionType);
}

function resolveCollectionExpressionType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    if (node.type === "parenthesized_expression") {
        return resolveCollectionExpressionType(node.namedChildren[0]!, context);
    }

    if (node.type === "variable_name") {
        const variableType =
            context.variableTypes.get(node.text) ??
            context.variableTypes.get(node.text.replace(/^\$/, ""));

        if (variableType) {
            return variableType;
        }

        return undefined;
    }

    if (node.type === "member_access_expression" && node.text.startsWith("$this->")) {
        const propertyName = node.text.replace("$this->", "");

        return resolveThisPropertyType(propertyName, context);
    }

    if (node.type === "member_call_expression") {
        const calledName = node.childForFieldName("name")?.text;
        const objectNode = node.childForFieldName("object");

        if (!calledName || !objectNode) {
            return undefined;
        }

        const objectType = resolveCollectionExpressionType(objectNode, context);

        if (!objectType) {
            return undefined;
        }

        return lookupMethodReturnType(objectType, calledName);
    }

    return resolveArraySubscriptElementType(node, context);
}

function readSubscriptObjectText(node: Parser.SyntaxNode): string | undefined {
    const objectNode = node.childForFieldName("object");

    if (objectNode) {
        return objectNode.text;
    }

    const firstChild = node.namedChildren[0];

    if (
        firstChild?.type === "member_access_expression" ||
        firstChild?.type === "variable_name"
    ) {
        return firstChild.text;
    }

    return undefined;
}

export function resolveArraySubscriptElementType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    if (node.type !== "subscript_expression") {
        return undefined;
    }

    const objectText = readSubscriptObjectText(node);

    if (!objectText?.startsWith("$this->")) {
        return undefined;
    }

    const propertyName = objectText.replace("$this->", "");
    const propertyKey = `this.${propertyName}`;

    return (
        context.classPropertyTypes.get(`${propertyKey}[]`) ??
        elementTypeFromCollectionType(context.classPropertyTypes.get(propertyKey))
    );
}

export function resolveExpressionElementType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    if (node.type === "binary_expression") {
        const left = node.childForFieldName("left");

        if (left) {
            return resolveExpressionElementType(left, context);
        }
    }

    return resolveArraySubscriptElementType(node, context);
}

export function applyClassPhpDocProperties(
    classNode: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentClass) {
        return;
    }

    const docComment = readPrecedingDocComment(classNode);

    if (!docComment) {
        return;
    }

    for (const property of parsePhpDocPropertyAnnotations(docComment)) {
        storePropertyType(property.propertyName, property.typeName, property.isArray, context);
    }
}

export function applyPropertyPhpDocTypes(node: Parser.SyntaxNode, context: WalkContext): void {
    if (!context.currentClass) {
        return;
    }

    const docComment = readPrecedingDocComment(node);

    if (!docComment) {
        return;
    }

    const parsed = parsePhpDocVarType(docComment);

    if (!parsed) {
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
        storePropertyType(propertyName, parsed.typeName, parsed.isArray, context);
    }
}
