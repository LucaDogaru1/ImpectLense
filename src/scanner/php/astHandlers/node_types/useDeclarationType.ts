import Parser from "tree-sitter";

export function useDeclarationType(rootNoteChild:Parser.SyntaxNode)
{
   const alias = rootNoteChild.children.map(child => {
       return child.children.find(child => child.type === "name")?.text ?? "";
    }).toString();

    const fullName = rootNoteChild.text ?? "";

    return {
        alias,
        fullName
    }
}