import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";

export function subscriptExpressionType(
    rootNodeChild: Parser.SyntaxNode,
    context: WalkContext
): void {

    const path = extractPath(rootNodeChild);

    if (!path) {
        return;
    }

    context.extractedFields.push({
        kind: "array_access",
        key: path,
        className: context.currentClass,
        methodName: context.currentMethod,
    });

}

function extractPath(node: Parser.SyntaxNode): string {
    const matches = node.text.match(/\[['"]([^'"]+)['"]\]/g);

    if (!matches) {
        return "";
    }

    return matches
        .map(match =>
            match
                .replace(/^\[['"]/, "")
                .replace(/['"]]$/, "")
        )
        .join(".");
}