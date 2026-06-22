import Parser from "tree-sitter";

export function nameSpaceDefinitionType(rootNodeChild: Parser.SyntaxNode):string
{
    return rootNodeChild.childForFieldName("name")?.text ?? "";
}