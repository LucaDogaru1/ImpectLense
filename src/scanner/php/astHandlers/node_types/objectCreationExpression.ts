import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { resolveClassName } from "../../resolvers/resolveClassName";
import { lookupMethodTarget } from "../../resolvers/lookupMethodOnType";

function resolveCreatedClassName(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const memberAccess = node.namedChildren.find(
        child => child.type === "member_access_expression"
    );

    if (memberAccess) {
        const constructorCall = memberAccess.namedChildren.find(
            child => child.type === "function_call_expression"
        );
        const className =
            constructorCall?.childForFieldName("name")?.text ??
            constructorCall?.namedChildren.find(child => child.type === "name")?.text;

        if (className) {
            return resolveClassName(className, context);
        }
    }

    const className =
        node.childForFieldName("name")?.text ??
        node.namedChildren.find(child => child.type === "name")?.text;

    if (!className) {
        return undefined;
    }

    return resolveClassName(className, context);
}

export function resolveNewExpressionClassName(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    if (node.type !== "object_creation_expression") {
        return undefined;
    }

    return resolveCreatedClassName(node, context);
}

export function objectCreationExpressionType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const memberAccess = node.namedChildren.find(
        child => child.type === "member_access_expression"
    );

    if (!memberAccess || !context.currentMethod) {
        return;
    }

    const methodName = memberAccess.childForFieldName("name")?.text;

    if (!methodName) {
        return;
    }

    const className = resolveCreatedClassName(node, context);
    const targetMethod = className ? lookupMethodTarget(className, methodName) : undefined;

    if (!targetMethod) {
        return;
    }

    graph.edges.set(`${context.currentMethod}->${targetMethod}`, {
        from: context.currentMethod,
        to: targetMethod,
        type: "CALLS",
    });
}
