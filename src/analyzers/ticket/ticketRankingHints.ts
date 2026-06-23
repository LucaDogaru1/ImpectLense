import type { TicketMatchedNode } from "./ticketAnalyzerV3";
import type { TicketGraphContext } from "./ticketGraphContext";

export interface TicketRankingHints {
    boost: string[];
    suppress: string[];
}

const BOOST_SCORE_PER_TERM = 180;
const SUPPRESS_PENALTY_PER_TERM = 250;
const DISCOVER_BOOST_BASE_SCORE = 160;
const MIN_SCORE_AFTER_SUPPRESS = 1;

const DISCOVER_TYPES = new Set([
    "method",
    "vue_component",
    "vue_prop",
    "api_endpoint",
    "integration_entrypoint",
    "job",
    "listener",
    "js_module",
]);

export function parseRankingHintTerms(value?: string): string[] {
    if (!value?.trim()) {
        return [];
    }

    return [
        ...new Set(
            value
                .split(",")
                .map(term => term.trim())
                .filter(term => term.length >= 2)
        ),
    ];
}

export function buildRankingHints(
    boost?: string,
    suppress?: string
): TicketRankingHints {
    return {
        boost: parseRankingHintTerms(boost),
        suppress: parseRankingHintTerms(suppress),
    };
}

export function hasRankingHints(hints?: TicketRankingHints): boolean {
    return Boolean(hints && (hints.boost.length > 0 || hints.suppress.length > 0));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rankingHintMatchesHaystack(haystack: string, term: string): boolean {
    const lowerHaystack = haystack.toLowerCase();
    const lowerTerm = term.toLowerCase();
    if (lowerTerm.length < 2) {
        return false;
    }

    const variants = [
        lowerTerm,
        lowerTerm.replace(/-/g, ""),
        lowerTerm.replace(/-/g, "_"),
        lowerTerm.replace(/_/g, ""),
    ];

    for (const variant of new Set(variants)) {
        if (variant.length < 2) {
            continue;
        }

        if (variant.length >= 4 && lowerHaystack.includes(variant)) {
            return true;
        }

        const escaped = escapeRegExp(variant);
        if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(lowerHaystack)) {
            return true;
        }
    }

    return false;
}

function nodeHaystack(item: Pick<TicketMatchedNode, "id" | "file" | "name">): string {
    return `${item.id} ${item.file ?? ""} ${item.name}`.toLowerCase();
}

function matchedHintTerms(haystack: string, terms: string[]): string[] {
    return terms.filter(term => rankingHintMatchesHaystack(haystack, term));
}

export function applyRankingHintsToMatches(
    items: TicketMatchedNode[],
    hints?: TicketRankingHints
): TicketMatchedNode[] {
    if (!hasRankingHints(hints)) {
        return items;
    }

    const activeHints = hints!;

    return items
        .map(item => {
            const haystack = nodeHaystack(item);
            const boosted = matchedHintTerms(haystack, activeHints.boost);
            const suppressed = matchedHintTerms(haystack, activeHints.suppress);
            let score = item.score;
            const reasons: string[] = [];

            if (boosted.length > 0) {
                score += boosted.length * BOOST_SCORE_PER_TERM;
                reasons.push(`Agent boost: ${boosted.join(", ")}`);
            }

            if (suppressed.length > 0) {
                score -= suppressed.length * SUPPRESS_PENALTY_PER_TERM;
                reasons.push(`Agent suppress: ${suppressed.join(", ")}`);
            }

            if (reasons.length === 0) {
                return item;
            }

            return {
                ...item,
                score: Math.round(score),
                reason: [item.reason, ...reasons].filter(Boolean).join(" | "),
            };
        })
        .filter(item => {
            const haystack = nodeHaystack(item);
            const suppressed = matchedHintTerms(haystack, activeHints.suppress);
            if (suppressed.length === 0) {
                return item.score > 0;
            }

            return item.score >= MIN_SCORE_AFTER_SUPPRESS;
        })
        .sort((a, b) => b.score - a.score);
}

export function discoverBoostedNodes(
    graph: TicketGraphContext,
    hints: TicketRankingHints,
    existingIds: Set<string>,
    limit: number
): TicketMatchedNode[] {
    if (hints.boost.length === 0) {
        return [];
    }

    const discovered: TicketMatchedNode[] = [];

    for (const row of graph.nodes) {
        if (!DISCOVER_TYPES.has(row.type)) {
            continue;
        }

        if (existingIds.has(row.id)) {
            continue;
        }

        const haystack = graph.haystackById.get(row.id) ?? "";
        const boosted = matchedHintTerms(haystack, hints.boost);
        if (boosted.length === 0) {
            continue;
        }

        discovered.push({
            id: row.id,
            type: row.type,
            name: row.name,
            file: row.file,
            score: DISCOVER_BOOST_BASE_SCORE + boosted.length * BOOST_SCORE_PER_TERM,
            reason: `Agent boost discovered: ${boosted.join(", ")}`,
        });
        existingIds.add(row.id);
    }

    return discovered
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

export function applyRankingHintsToInvestigationTargets(
    targets: TicketMatchedNode[],
    graph: TicketGraphContext,
    hints?: TicketRankingHints,
    limit = 10
): TicketMatchedNode[] {
    if (!hasRankingHints(hints)) {
        return targets;
    }

    const activeHints = hints!;
    const existingIds = new Set(targets.map(target => target.id));
    const discovered = discoverBoostedNodes(graph, activeHints, existingIds, limit);
    const merged = applyRankingHintsToMatches([...targets, ...discovered], activeHints);

    return merged.slice(0, limit);
}
