import Parser from "tree-sitter";

const STOP_WORDS = new Set([
    "the", "and", "or", "a", "an", "to", "of", "in", "on", "for", "by",
    "with", "from", "this", "that", "all", "is", "are", "be", "as",
    "return", "returns", "used", "when", "via",
    "der", "die", "das", "und", "oder", "ein", "eine", "zu", "von", "mit",
]);

export function extractNodeKeywords(
    node: Parser.SyntaxNode,
    name: string
): {
    keywords: string[];
    description?: string;
} {
    const nameKeywords = splitIdentifier(name);
    const commentText = collectNearbyComments(node);
    const commentKeywords = extractWords(commentText);

    return {
        keywords: unique([
            ...nameKeywords,
            ...commentKeywords,
        ]),
        description: commentText || undefined,
    };
}

function collectNearbyComments(node: Parser.SyntaxNode): string {
    const comments: string[] = [];

    let current = node.previousSibling;

    while (current) {
        if (current.type === "comment") {
            comments.unshift(cleanComment(current.text));
            current = current.previousSibling;
            continue;
        }

        if (current.type.trim() === "") {
            current = current.previousSibling;
            continue;
        }

        break;
    }

    return comments.join("\n").trim();
}

function splitIdentifier(value: string): string[] {
    return value
        .replace(/::/g, " ")
        .replace(/\$/g, " ")
        .replace(/[_\-./]/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/\s+/)
        .map(v => v.toLowerCase())
        .filter(Boolean);
}

function extractWords(value: string): string[] {
    return value
        .replace(/[^\p{L}\p{N}_\-./]+/gu, " ")
        .split(/\s+/)
        .flatMap(word => splitIdentifier(word))
        .map(word => word.toLowerCase())
        .filter(word => word.length >= 2)
        .filter(word => !STOP_WORDS.has(word));
}

function cleanComment(value: string): string {
    return value
        .replace(/^\/\*\*/, "")
        .replace(/^\/\*/, "")
        .replace(/\*\/$/, "")
        .replace(/^\/\//gm, "")
        .replace(/^\s*\*/gm, "")
        .trim();
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}