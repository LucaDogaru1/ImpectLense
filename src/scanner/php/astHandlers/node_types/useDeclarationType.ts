import Parser from "tree-sitter";

function readUseClauseName(clause: Parser.SyntaxNode): string {
    const qualifiedName = clause.namedChildren.find(
        child => child.type === "qualified_name" || child.type === "name"
    );

    return qualifiedName?.text ?? "";
}

function readUseClauseAlias(clause: Parser.SyntaxNode, fullName: string): string {
    const aliasClause = clause.namedChildren.find(
        child => child.type === "namespace_aliasing_clause"
    );
    const aliasName = aliasClause?.namedChildren.find(child => child.type === "name")?.text;

    if (aliasName) {
        return aliasName;
    }

    const leafName = fullName.split("\\").pop();

    return leafName ?? fullName;
}

export function useDeclarationType(rootNoteChild: Parser.SyntaxNode): {
    alias: string;
    fullName: string;
} {
    const fullName = readUseClauseName(rootNoteChild);
    const alias = readUseClauseAlias(rootNoteChild, fullName);

    return {
        alias,
        fullName,
    };
}
