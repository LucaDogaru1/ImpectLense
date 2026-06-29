import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { resolveClassName } from "../../resolvers/resolveClassName";
import { graph } from "../../../../graph/graph";
import { ensureModelField } from "../../semantic/fieldNodes";
import { extractNestedArrayFieldEntries } from "../../semantic/nestedArrayFields";

export function assignmentExpression(
    rootNodeChild: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    const left = rootNodeChild.childForFieldName("left");
    const right = rootNodeChild.childForFieldName("right");

    if (!left || !right) return;

    recordModelPropertyArrayShape(left, right, context, file);

    const leftKey = normalizeAssignedTarget(left.text);

    if (leftKey.startsWith("this.") && right.type === "variable_name") {
        const sourceType =
            context.variableTypes.get(right.text) ??
            context.variableTypes.get(right.text.replace(/^\$/, ""));

        if (sourceType) {
            context.variableTypes.set(leftKey, sourceType);
            context.classPropertyTypes.set(leftKey, sourceType);
        }

        return;
    }

    if (right.type !== "object_creation_expression") return;

    const className =
        right.childForFieldName("name")?.text
        ?? right.children.find(child => child.type === "name")?.text;

    if (!className) return;

    const resolvedClassName = resolveClassName(className, context);

    if (!resolvedClassName) return;

    context.variableTypes.set(leftKey, resolvedClassName);

    if (leftKey.startsWith("this.")) {
        context.classPropertyTypes.set(leftKey, resolvedClassName);

        if (context.currentClass) {
            const propertyName = leftKey.replace("this.", "");
            const propertyId = `${context.currentClass}::$${propertyName}`;

            graph.nodes.set(propertyId, {
                id: propertyId,
                parent: context.currentClass,
                type: "property",
                name: `$${propertyName}`,
            });

            graph.edges.set(`${context.currentClass}->${propertyId}`, {
                from: context.currentClass,
                to: propertyId,
                type: "CONTAINS",
            });

            graph.edges.set(`${propertyId}->${resolvedClassName}`, {
                from: propertyId,
                to: resolvedClassName,
                type: "TYPE_OF",
            });
        }

        if (context.currentMethod) {
            graph.edges.set(`${context.currentMethod}->${resolvedClassName}:INSTANTIATES`, {
                from: context.currentMethod,
                to: resolvedClassName,
                type: "INSTANTIATES",
            });
        }
    }
}

function recordModelPropertyArrayShape(
    left: Parser.SyntaxNode,
    right: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentClass || !/\/models\//i.test(file.replace(/\\/g, "/"))) {
        return;
    }

    const propertyName = left.text.match(/^\$this->([a-zA-Z_][a-zA-Z0-9_]*)$/)?.[1];
    if (!propertyName) {
        return;
    }

    if (
        right.type !== "array_creation_expression" &&
        right.type !== "short_array_creation_expression"
    ) {
        const arrayNode = resolveArrayLiteralNode(right);
        if (!arrayNode) {
            return;
        }

        ensureModelField(context.currentClass, propertyName, file);

        for (const entry of extractNestedArrayFieldEntries(arrayNode, propertyName)) {
            ensureModelField(context.currentClass, entry.path, file);
        }
        return;
    }

    ensureModelField(context.currentClass, propertyName, file);

    for (const entry of extractNestedArrayFieldEntries(right, propertyName)) {
        ensureModelField(context.currentClass, entry.path, file);
    }
}

function resolveArrayLiteralNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (
        node.type === "array_creation_expression" ||
        node.type === "short_array_creation_expression"
    ) {
        return node;
    }

    for (const child of node.namedChildren) {
        const resolved = resolveArrayLiteralNode(child);
        if (resolved) {
            return resolved;
        }
    }

    return null;
}

function normalizeAssignedTarget(value: string): string {
    if (value.startsWith("$this->")) {
        return value.replace("$this->", "this.");
    }

    return value;
}