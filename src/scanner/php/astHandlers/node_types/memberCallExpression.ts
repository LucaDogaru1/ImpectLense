import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { lookupMethodTarget } from "../../resolvers/lookupMethodOnType";
import { resolveExpressionType } from "../../semantic/resolveExpressionType";
import { sqsMethodCallType } from "./sqsMethodCall";

function resolveVariableClassName(variableName: string, context: WalkContext): string | undefined {
    return (
        context.variableTypes.get(variableName) ??
        context.variableTypes.get(variableName.replace(/^\$/, ""))
    );
}

function resolveObjectClassName(
    objectNode: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    if (objectNode.type === "variable_name") {
        if (objectNode.text === "$this" && context.currentClass) {
            return context.currentClass;
        }

        return resolveVariableClassName(objectNode.text, context);
    }

    if (objectNode.type === "member_call_expression" || objectNode.type === "object_creation_expression") {
        return resolveExpressionType(objectNode, context);
    }

    if (objectNode.type === "member_access_expression") {
        return resolveExpressionType(objectNode, context);
    }

    if (objectNode.text === "$this" && context.currentClass) {
        return context.currentClass;
    }

    if (objectNode.type === "member_access_expression" && objectNode.text.startsWith("$this->")) {
        const propertyName = objectNode.childForFieldName("name")?.text ?? objectNode.text.replace("$this->", "");
        const normalizedProperty = `this.${propertyName}`;

        return (
            context.variableTypes.get(normalizedProperty) ??
            context.classPropertyTypes.get(normalizedProperty) ??
            context.classPropertyTypes.get(propertyName)
        );
    }

    return resolveExpressionType(objectNode, context);
}

export function memberCallExpressionType(
    rootNode: Parser.SyntaxNode,
    context: WalkContext
): void {
    const calledName = rootNode.childForFieldName("name")?.text;
    const objectNode = rootNode.childForFieldName("object");

    if (!calledName || !objectNode || !context.currentMethod) {
        return;
    }

    const className = resolveObjectClassName(objectNode, context);
    const targetMethod = className ? lookupMethodTarget(className, calledName) : undefined;

    if (!targetMethod) {
        return;
    }

    const edgeId = `${context.currentMethod}->${targetMethod}`;

    graph.edges.set(edgeId, {
        from: context.currentMethod,
        to: targetMethod,
        type: "CALLS",
    });

    sqsMethodCallType(rootNode, context);
}
