import { fieldNamesMatch } from "../../shared/fieldNameMatching";
import { TicketMatchedNode } from "./ticketAnalyzerV3";
import { TicketGraphContext } from "./ticketGraphContext";
import { extractFieldPathTerms } from "./ticketTextTokens";

const FIELD_ANCHOR_TYPES = new Set(["request_field", "response_field"]);

export function extractFieldAnchorTerms(ticketText: string): string[] {
    const terms = new Set<string>(extractFieldPathTerms(ticketText));
    const ticketLower = ticketText.toLowerCase();

    for (const match of ticketText.matchAll(/"([\d]+x[\d]+)"\s*:/gi)) {
        terms.add(match[1]!.toLowerCase());
    }

    for (const match of ticketText.matchAll(/\b(\d+x\d+)\b/gi)) {
        terms.add(match[1]!.toLowerCase());
    }

    for (const match of ticketText.matchAll(/`(\d+x\d+)`/gi)) {
        terms.add(match[1]!.toLowerCase());
    }

    if (ticketLower.includes("editorial.images") || ticketLower.includes("editorial.images.")) {
        terms.add("editorial.images");
    }

    for (const dimension of ["1x1", "16x9"]) {
        if (!terms.has(dimension)) {
            continue;
        }

        terms.add(`editorial.images.${dimension}`);
    }

    return [...terms].sort((left, right) => right.length - left.length);
}

function scoreFieldAnchorMatch(rowName: string, term: string, rowType: string): number {
    let score = 2400 + Math.min(term.length * 12, 120);

    if (rowType === "request_field") {
        score += 120;
    }

    if (rowName.toLowerCase() === term.toLowerCase()) {
        score += 200;
    }

    if (term.includes(".") && rowName.toLowerCase().includes(term.toLowerCase())) {
        score += 150;
    }

    return score;
}

export function findFieldAnchoredNodes(
    graph: TicketGraphContext,
    fieldTerms: string[],
    limit = 8
): TicketMatchedNode[] {
    if (fieldTerms.length === 0) {
        return [];
    }

    const matches: TicketMatchedNode[] = [];

    for (const row of graph.nodes) {
        if (!FIELD_ANCHOR_TYPES.has(row.type)) {
            continue;
        }

        for (const term of fieldTerms) {
            if (!fieldNamesMatch(row.name, term)) {
                continue;
            }

            matches.push({
                id: row.id,
                type: row.type,
                name: row.name,
                file: row.file,
                score: scoreFieldAnchorMatch(row.name, term, row.type),
                reason: `Field anchor: ${term}`,
            });
            break;
        }
    }

    const seen = new Set<string>();
    return matches
        .filter(item => {
            if (seen.has(item.id)) {
                return false;
            }

            seen.add(item.id);
            return true;
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}
