import Parser from "tree-sitter";

export function argumentsNode(
    node: Parser.SyntaxNode | null | undefined
): Parser.SyntaxNode | null {
    if (!node) {
        return null;
    }

    return (
        node.childForFieldName("arguments") ??
        node.namedChildren.find(child => child.type === "arguments") ??
        null
    );
}

export function rootVariableFromArgument(arg: Parser.SyntaxNode): string | null {
    const match = arg.text.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/);

    if (match) {
        return match[0];
    }

    for (const child of arg.namedChildren) {
        const nested = child.text.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/);

        if (nested) {
            return nested[0];
        }
    }

    return null;
}
