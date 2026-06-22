import Parser from "tree-sitter";

const STOP_WORDS = new Set([
    "import", "export", "default", "from", "const", "let", "var", "function",
    "return", "true", "false", "null", "undefined", "type", "required",
    "object", "string", "boolean", "number", "array",
]);

export interface ComponentKeywordOptions {
    /** Skip template / large string literals (handled by vue template extractor). */
    skipStrings?: boolean;
    extra?: string[];
}

export function extractNodeKeywords(node: Parser.SyntaxNode, seed = ""): string[] {
    return extractComponentKeywords(node, { seed });
}

export function extractComponentKeywords(
    node: Parser.SyntaxNode,
    options: ComponentKeywordOptions & { seed?: string } = {}
): string[] {
    const keywords = new Set<string>();

    if (options.seed) {
        keywords.add(options.seed.toLowerCase());
    }

    for (const extra of options.extra ?? []) {
        keywords.add(extra);
    }

    const queue: Parser.SyntaxNode[] = [node];

    while (queue.length > 0) {
        const current = queue.pop()!;

        if (current.type === "pair") {
            const key = current.childForFieldName("key")?.text.replace(/["']/g, "");
            if (key && key !== "template" && !STOP_WORDS.has(key.toLowerCase())) {
                keywords.add(key.toLowerCase());
            }
        }

        if (current.type === "identifier" || current.type === "property_identifier") {
            const value = current.text.toLowerCase();
            if (value.length >= 3 && !STOP_WORDS.has(value)) {
                keywords.add(value);
            }
        }

        if (
            !options.skipStrings &&
            (current.type === "string" || current.type === "string_fragment")
        ) {
            const value = current.text.replace(/["'`]/g, "").toLowerCase();
            if (value.length >= 3 && value.length <= 40 && !value.includes("<")) {
                keywords.add(value);
            }
        }

        if (current.type === "template_string") {
            continue;
        }

        for (const child of current.children) {
            if (child.type === "template" && child.text.length > 80) {
                continue;
            }
            queue.push(child);
        }
    }

    return [...keywords].slice(0, 24);
}
