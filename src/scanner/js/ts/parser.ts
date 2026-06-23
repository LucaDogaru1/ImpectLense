import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

export function createTsParser(): Parser {
    const parser = new Parser();
    parser.setLanguage(TypeScript.typescript);
    return parser;
}
