import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { WalkContext } from "../walk/context";
import { resolveClassName } from "../resolvers/resolveClassName";
import { resolveExpressionType } from "./resolveExpressionType";

const PERSIST_METHODS = new Set([
    "create",
    "update",
    "save",
    "insert",
    "upsert",
    "persist",
]);

export function isLikelyModelClass(classId: string): boolean {
    const node = graph.nodes.get(classId);

    if (node?.type !== "class") {
        return false;
    }

    const shortName = classId.split("\\").pop() ?? classId;

    return /(?:Model|Content|Entity)$/i.test(shortName);
}

export function resolvePersistTargetFromScopedCall(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const targetMethodName =
        node.childForFieldName("name")?.text ??
        node.children.find(child => child.type === "name")?.text;
    const relativeScope = node.children.find(child => child.type === "relative_scope")?.text;
    const classNameNode = node.children.find(
        child =>
            (child.type === "name" || child.type === "qualified_name") &&
            child.text !== targetMethodName
    );

    if (!targetMethodName || !PERSIST_METHODS.has(targetMethodName)) {
        return undefined;
    }

    let resolvedClass: string | undefined;

    if (relativeScope === "self" || relativeScope === "static") {
        resolvedClass = context.currentClass;
    } else if (classNameNode) {
        resolvedClass = resolveClassName(classNameNode.text, context);
    } else {
        return undefined;
    }

    if (!resolvedClass || !graph.nodes.has(resolvedClass) || !isLikelyModelClass(resolvedClass)) {
        return undefined;
    }

    return resolvedClass;
}

export function resolvePersistTargetFromMemberCall(
    node: Parser.SyntaxNode,
    context: WalkContext
): string | undefined {
    const methodName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object");

    if (!methodName || !objectNode || !PERSIST_METHODS.has(methodName)) {
        return undefined;
    }

    const objectType = resolveExpressionType(objectNode, context);

    if (!objectType || !graph.nodes.has(objectType) || !isLikelyModelClass(objectType)) {
        return undefined;
    }

    return objectType;
}
