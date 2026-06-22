import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";

export function requestInputType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const calledName = node.childForFieldName("name")?.text;
    const objectNode = node.childForFieldName("object")?.text ?? "";

    if (calledName !== "input") return;
    if (!objectNode.includes("$request")) return;
    if (!context.currentMethod) return;

    const argsNode = node.childForFieldName("arguments");
    const firstArg = argsNode?.namedChildren[0];

    if (!firstArg) return;

    const fieldName = cleanPhpString(firstArg.text);

    if (!fieldName) return;

    const fieldId = `request_field:${fieldName}`;
    const edgeId = `${context.currentMethod}->${fieldId}`;

    graph.nodes.set(fieldId, {
        id: fieldId,
        type: "request_field",
        name: fieldName,
    });

    graph.edges.set(edgeId, {
        from: context.currentMethod,
        to: fieldId,
        type: "READS_FIELD",
    });
}

function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}