import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";

export function createJsParser(): Parser {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    return parser;
}
