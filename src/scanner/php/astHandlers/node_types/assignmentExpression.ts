import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { resolveClassName } from "../../resolvers/resolveClassName";
import { graph } from "../../../../graph/graph";

export function assignmentExpression(
    rootNodeChild: Parser.SyntaxNode,
    context: WalkContext
): void {
    const left = rootNodeChild.childForFieldName("left");
    const right = rootNodeChild.childForFieldName("right");

    if (!left || !right) return;

    if (right.type !== "object_creation_expression") return;

    const className =
        right.childForFieldName("name")?.text
        ?? right.children.find(child => child.type === "name")?.text;

    if (!className) return;

    const resolvedClassName = resolveClassName(className, context);

    if (!resolvedClassName) return;

    const leftKey = normalizeAssignedTarget(left.text);

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

function normalizeAssignedTarget(value: string): string {
    if (value.startsWith("$this->")) {
        return value.replace("$this->", "this.");
    }

    return value;
}