import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { configReferenceType } from "./configReference";

function readFunctionCallName(node: Parser.SyntaxNode): string | undefined {
    const fromField = node.childForFieldName("name")?.text;

    if (fromField) {
        return fromField.replace(/^\\+/, "");
    }

    const nameNode = node.namedChildren.find(child => child.type === "name");

    if (nameNode) {
        return nameNode.text.replace(/^\\+/, "");
    }

    const qualifiedName = node.namedChildren.find(child => child.type === "qualified_name");

    if (qualifiedName) {
        return qualifiedName.text.split("\\").pop()?.replace(/^\\+/, "");
    }

    return undefined;
}

export function functionCallExpressionType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const functionName = readFunctionCallName(node);

    if (functionName === "config") {
        configReferenceType(node, context);
    }
}

function readScopedCallClassName(node: Parser.SyntaxNode): string | undefined {
    const qualifiedName = node.namedChildren.find(child => child.type === "qualified_name")?.text;

    if (qualifiedName) {
        return qualifiedName.split("\\").pop();
    }

    return node.children.find(child => child.type === "name")?.text;
}

export function isConfigFacadeGetCall(node: Parser.SyntaxNode): boolean {
    const className = readScopedCallClassName(node);
    const methodName = node.childForFieldName("name")?.text;

    return className === "Config" && methodName === "get";
}

export { readFunctionCallName };
