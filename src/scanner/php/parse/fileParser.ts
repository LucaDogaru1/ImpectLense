import Parser from "tree-sitter";
import fs from "node:fs";

export function parsePhpFile(parser: Parser ,filePath:string):Parser.Tree {
    const source = fs.readFileSync(filePath, "utf-8");
    return parser.parse(source);
}