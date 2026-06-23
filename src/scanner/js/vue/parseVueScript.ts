import Parser from "tree-sitter";
import { stripTypescript } from "../nuxt/stripTypescript";

export interface ParsedVueScript {
    tree: Parser.Tree;
    scriptSource: string;
    usedTsParser: boolean;
    usedStripFallback: boolean;
}

function isTypeScriptLang(lang: string | undefined): boolean {
    return lang === "ts" || lang === "tsx";
}

export function parseVueScript(
    rawScript: string,
    lang: string | undefined,
    jsParser: Parser,
    tsParser: Parser
): ParsedVueScript {
    if (isTypeScriptLang(lang)) {
        try {
            const tree = tsParser.parse(rawScript);
            if (!tree.rootNode.hasError) {
                return {
                    tree,
                    scriptSource: rawScript,
                    usedTsParser: true,
                    usedStripFallback: false,
                };
            }
        } catch {
            // Fall back to strip + JavaScript parser below.
        }

        const stripped = stripTypescript(rawScript);
        return {
            tree: jsParser.parse(stripped),
            scriptSource: stripped,
            usedTsParser: false,
            usedStripFallback: true,
        };
    }

    return {
        tree: jsParser.parse(rawScript),
        scriptSource: rawScript,
        usedTsParser: false,
        usedStripFallback: false,
    };
}
