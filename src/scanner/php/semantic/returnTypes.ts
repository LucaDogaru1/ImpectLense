import Parser from "tree-sitter";
import { resolveClassName } from "../resolvers/resolveClassName";
import { WalkContext } from "../walk/context";
import {
    parsePhpDocReturnType,
    readPrecedingDocComment,
} from "./phpDocPropertyTypes";

const IGNORED_RETURN_TYPES = new Set([
    "array",
    "bool",
    "boolean",
    "callable",
    "false",
    "float",
    "int",
    "integer",
    "iterable",
    "mixed",
    "never",
    "null",
    "object",
    "resource",
    "string",
    "true",
    "void",
    "static",
    "self",
    "parent",
]);

export function extractNamedTypeFromNode(typeNode: Parser.SyntaxNode): string | undefined {
    if (typeNode.type === "named_type" || typeNode.type === "primitive_type") {
        const rawType = typeNode.text.replace(/^\?/, "").split("|")[0]?.trim();

        if (!rawType || IGNORED_RETURN_TYPES.has(rawType.toLowerCase())) {
            return undefined;
        }

        return rawType;
    }

    if (typeNode.type === "nullable_type" || typeNode.type === "optional_type") {
        const inner = typeNode.namedChildren[0];

        if (inner) {
            return extractNamedTypeFromNode(inner);
        }
    }

    if (typeNode.type === "union_type" || typeNode.type === "intersection_type") {
        for (const child of typeNode.namedChildren) {
            const typeName = extractNamedTypeFromNode(child);

            if (typeName && !IGNORED_RETURN_TYPES.has(typeName.toLowerCase())) {
                return typeName;
            }
        }
    }

    return undefined;
}

export function extractMethodReturnType(
    methodNode: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const returnTypeNode = methodNode.childForFieldName("return_type");
    let nativeType: string | undefined;

    if (returnTypeNode) {
        const typeName = extractNamedTypeFromNode(returnTypeNode);

        if (typeName) {
            nativeType = resolveClassName(typeName, context);
        } else if (returnTypeNode.text.replace(/^\?/, "").split("|")[0]?.trim().toLowerCase() === "array") {
            nativeType = "array";
        }
    }

    const docComment = readPrecedingDocComment(methodNode);
    const phpDocReturn = docComment ? parsePhpDocReturnType(docComment) : null;

    if (phpDocReturn) {
        const resolvedDocType = resolveClassName(phpDocReturn.typeName, context);

        if (resolvedDocType) {
            return phpDocReturn.isArray ? `${resolvedDocType}[]` : resolvedDocType;
        }
    }

    return nativeType === "array" ? undefined : nativeType;
}

export { lookupMethodReturnType, lookupMethodTarget } from "../resolvers/lookupMethodOnType";
