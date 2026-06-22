import Parser from "tree-sitter";
import Php from  "tree-sitter-php";

export function createPhpParser(): Parser {
    const parser = new Parser();
    parser.setLanguage(Php.php);
    return parser;
}