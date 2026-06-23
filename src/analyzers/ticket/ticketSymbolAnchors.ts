import { DbNodeRow, TicketGraphContext } from "./ticketGraphContext";
import { TicketMatchedNode } from "./ticketAnalyzerV3";

const GENERIC_ANCHORS = new Set([
    "config",
    "contents",
    "content",
    "baseconfig",
    "update",
    "create",
    "delete",
    "index",
    "show",
    "store",
    "public",
    "backend",
    "frontend",
    "module",
    "modules",
    "client",
    "management",
    "feature",
    "scenario",
    "given",
    "when",
    "then",
    "verticalpromotion",
    "livestream",
    "collection",
]);

export function compactAnchor(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractSymbolAnchors(ticketText: string): string[] {
    const anchors = new Set<string>();

    for (const match of ticketText.matchAll(/`([^`]+)`/g)) {
        addAnchor(anchors, match[1]);
    }

    for (const match of ticketText.matchAll(/Modules\\[A-Za-z0-9\\]+/g)) {
        addAnchor(anchors, match[0]);
        const tail = match[0].split("\\").pop();
        if (tail) {
            addAnchor(anchors, tail);
        }
    }

    for (const match of ticketText.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)) {
        addAnchor(anchors, match[1]);
    }

    for (const match of ticketText.matchAll(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,3})\b/g)) {
        addAnchor(anchors, match[1].replace(/\s+/g, ""));
    }

    for (const match of ticketText.matchAll(/\b([a-z][a-z0-9]*):[a-z][a-z0-9]+\b/g)) {
        addAnchor(anchors, match[1]);
    }

    for (const line of ticketText.split("\n")) {
        const routeLine = /(?:GET|POST|PUT|PATCH|DELETE)\s+/i.test(line) || /\bapi\/v\d+\//i.test(line);
        if (!routeLine) {
            continue;
        }

        for (const match of line.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi)) {
            addAnchor(anchors, match[0]);
        }
    }

    for (const match of ticketText.matchAll(
        /(?:GET|POST|PUT|PATCH|DELETE)\s+(?:api\/v\d+\/)?([a-z0-9][a-z0-9./_{}-]*)/gi
    )) {
        for (const segment of match[1].split(/[/\\]/)) {
            addAnchor(anchors, segment.replace(/\{[^}]+\}/g, ""));
        }
    }

    return [...anchors].sort((left, right) => right.length - left.length);
}

function addAnchor(anchors: Set<string>, raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
        return;
    }

    const compact = compactAnchor(trimmed);
    if (compact.length < 6 || GENERIC_ANCHORS.has(compact)) {
        return;
    }

    anchors.add(trimmed);
    anchors.add(compact);
}

export function nodeMatchesSymbolAnchor(
    nodeId: string,
    file: string | null,
    anchor: string
): boolean {
    const haystack = compactAnchor(`${nodeId} ${file ?? ""}`);
    const needle = compactAnchor(anchor);

    if (needle.length < 6) {
        return false;
    }

    return haystack.includes(needle);
}

export function scoreSymbolAnchorMatch(
    nodeId: string,
    file: string | null,
    anchors: string[]
): number {
    let best = 0;

    for (const anchor of anchors) {
        if (!nodeMatchesSymbolAnchor(nodeId, file, anchor)) {
            continue;
        }

        const compact = compactAnchor(anchor);
        const idCompact = compactAnchor(nodeId);

        if (idCompact.includes(compact) && compact.length >= 10) {
            best = Math.max(best, 1200);
        } else if (compact.length >= 8) {
            best = Math.max(best, 900);
        } else {
            best = Math.max(best, 600);
        }
    }

    return best;
}

export function findSymbolAnchoredNodes(
    graph: TicketGraphContext,
    anchors: string[],
    limit = 8
): TicketMatchedNode[] {
    if (anchors.length === 0) {
        return [];
    }

    const preferredTypes = new Set([
        "api_endpoint",
        "method",
        "class",
        "integration_entrypoint",
    ]);

    const matches: TicketMatchedNode[] = [];

    for (const row of graph.nodes) {
        if (!preferredTypes.has(row.type)) {
            continue;
        }

        const boost = scoreSymbolAnchorMatch(row.id, row.file, anchors);
        if (boost <= 0) {
            continue;
        }

        matches.push({
            id: row.id,
            type: row.type,
            name: row.name,
            file: row.file,
            score: boost,
            reason: `Symbol anchor match (${anchors.slice(0, 2).join(", ")})`,
        });
    }

    return matches
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}

export function findUnmatchedSymbolAnchors(
    graph: TicketGraphContext,
    anchors: string[]
): string[] {
    const distinctive = [...new Set(anchors.map(anchor => compactAnchor(anchor)))]
        .filter(anchor => anchor.length >= 8 && !GENERIC_ANCHORS.has(anchor));

    return distinctive.filter(anchor =>
        !graph.nodes.some(row => nodeMatchesSymbolAnchor(row.id, row.file, anchor))
    );
}

export function shouldPenalizeGenericBaseConfigMatch(
    nodeId: string,
    file: string | null,
    anchors: string[]
): boolean {
    if (anchors.length === 0) {
        return false;
    }

    const haystack = `${nodeId} ${file ?? ""}`.toLowerCase();
    const hasBaseConfigNoise =
        /baseconfig/i.test(haystack) &&
        !/uitranslation|ui-translation|ui_translations/i.test(haystack);

    if (!hasBaseConfigNoise) {
        return false;
    }

    return anchors.some(anchor => nodeMatchesSymbolAnchor(nodeId, file, anchor) === false);
}

export function isGenericBaseConfigWithoutAnchor(
    nodeId: string,
    file: string | null,
    anchors: string[]
): boolean {
    if (anchors.length === 0) {
        return false;
    }

    const haystack = `${nodeId} ${file ?? ""}`.toLowerCase();
    if (!/baseconfig/i.test(haystack)) {
        return false;
    }

    if (/uitranslation|ui-translation|ui_translations/i.test(haystack)) {
        return false;
    }

    return !anchors.some(anchor => nodeMatchesSymbolAnchor(nodeId, file, anchor));
}

export function rowIsPreferredApiAnchor(row: DbNodeRow, anchors: string[]): boolean {
    return scoreSymbolAnchorMatch(row.id, row.file, anchors) > 0;
}
