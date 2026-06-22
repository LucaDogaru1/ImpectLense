import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { sqsMethodCallType } from "./sqsMethodCall";

export function memberCallExpressionType(
    rootNode: Parser.SyntaxNode,
    context: WalkContext
): void {
    const calledName = rootNode.childForFieldName("name")?.text;
    const objectNode = rootNode.childForFieldName("object")?.text;

    if (!calledName || !objectNode || !context.currentMethod) {
        return;
    }

    let targetMethod: string | undefined;

    if (objectNode === "$this" && context.currentClass) {
        targetMethod = `${context.currentClass}::${calledName}`;
    } else if (objectNode.startsWith("$this->")) {
        const propertyName = objectNode.replace("$this->", "");
        const normalizedProperty = `this.${propertyName}`;

        const className =
            context.variableTypes.get(normalizedProperty) ??
            context.classPropertyTypes.get(normalizedProperty) ??
            context.classPropertyTypes.get(propertyName);

        if (className) {
            targetMethod = `${className}::${calledName}`;
        }
    } else {
        const className =
            context.variableTypes.get(objectNode) ??
            context.classPropertyTypes.get(objectNode);

        if (className) {
            targetMethod = `${className}::${calledName}`;
        }
    }

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