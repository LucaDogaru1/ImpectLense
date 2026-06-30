import Parser from "tree-sitter";
import { resolveClassName } from "../resolvers/resolveClassName";
import { WalkContext } from "../walk/context";
import { lookupMethodReturnType } from "../resolvers/lookupMethodOnType";
import { lookupClassPropertyType } from "../walk/classPropertyTypesRegistry";
import { resolveExpressionElementType } from "./phpDocPropertyTypes";
import { resolveNewExpressionClassName } from "../astHandlers/node_types/objectCreationExpression";

function resolveMemberAccessType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const propertyName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object");

    if (!propertyName || !objectNode) {
        return undefined;
    }

    const objectType = resolveExpressionType(objectNode, context);

    if (!objectType) {
        return undefined;
    }

    return lookupClassPropertyType(objectType, propertyName);
}

function resolveVariableType(variableName: string, context: WalkContext): string | undefined {
    return (
        context.variableTypes.get(variableName) ??
        context.variableTypes.get(variableName.replace(/^\$/, ""))
    );
}

function resolveObjectCreationType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const memberAccess = node.namedChildren.find(
        child => child.type === "member_access_expression"
    );

    if (memberAccess) {
        const className = resolveNewExpressionClassName(node, context);
        const methodName = memberAccess.childForFieldName("name")?.text;

        if (className && methodName) {
            return lookupMethodReturnType(className, methodName);
        }
    }

    return resolveNewExpressionClassName(node, context);
}

function resolveMemberCallReturnType(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const calledName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object");

    if (!calledName || !objectNode) {
        return undefined;
    }

    const objectType = resolveExpressionType(objectNode, context);

    if (!objectType) {
        return undefined;
    }

    return lookupMethodReturnType(objectType, calledName);
}

export function resolveExpressionType(
    node: Parser.SyntaxNode | null | undefined,
    context: WalkContext
): string | undefined {
    if (!node) {
        return undefined;
    }

    if (node.type === "parenthesized_expression") {
        return resolveExpressionType(node.namedChildren[0], context);
    }

    if (node.type === "variable_name") {
        if (node.text === "$this" && context.currentClass) {
            return context.currentClass;
        }

        return resolveVariableType(node.text, context);
    }

    if (node.type === "object_creation_expression") {
        return resolveObjectCreationType(node, context);
    }

    if (node.type === "member_call_expression") {
        return resolveMemberCallReturnType(node, context);
    }

    if (node.type === "member_access_expression") {
        if (node.text.startsWith("$this->") && context.currentClass) {
            const propertyName = node.childForFieldName("name")?.text;

            if (propertyName) {
                return (
                    lookupClassPropertyType(context.currentClass, propertyName) ??
                    context.classPropertyTypes.get(`this.${propertyName}`)
                );
            }
        }

        return resolveMemberAccessType(node, context);
    }

    if (node.type === "binary_expression") {
        const left = node.childForFieldName("left");

        if (left) {
            return resolveExpressionType(left, context);
        }
    }

    return resolveExpressionElementType(node, context);
}
