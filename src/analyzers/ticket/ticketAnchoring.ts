import { TicketMatchedNode } from "./ticketAnalyzerV3";
import { TicketGraphContext } from "./ticketGraphContext";
import { extractTicketRoutes, matchRouteAnchoredEndpoints, TicketRouteRef } from "./ticketRouteAnchoring";
import { extractFieldAnchorTerms, findFieldAnchoredNodes } from "./ticketFieldAnchoring";
import {
    extractSymbolAnchors,
    findSymbolAnchoredNodes,
    findUnmatchedSymbolAnchors,
    isGenericBaseConfigWithoutAnchor,
} from "./ticketSymbolAnchors";

export interface TicketAnchorContext {
    routes: TicketRouteRef[];
    symbols: string[];
    anchoredTargets: TicketMatchedNode[];
    structuralIds: string[];
    netNewSymbols: string[];
}

export function buildTicketAnchorContext(
    ticketText: string,
    graph: TicketGraphContext,
    limit = 8
): TicketAnchorContext {
    const routes = extractTicketRoutes(ticketText);
    const symbols = extractSymbolAnchors(ticketText);
    const fieldTerms = extractFieldAnchorTerms(ticketText);
    const routeMatches = matchRouteAnchoredEndpoints(routes, graph);
    const fieldMatches = findFieldAnchoredNodes(graph, fieldTerms, limit);
    const symbolMatches = findSymbolAnchoredNodes(graph, symbols, limit);

    const anchoredTargets = dedupeAnchoredTargets([...routeMatches, ...fieldMatches, ...symbolMatches]);
    const structuralIds = anchoredTargets.map(item => item.id);
    const netNewSymbols = findUnmatchedSymbolAnchors(graph, symbols);

    return {
        routes,
        symbols,
        anchoredTargets,
        structuralIds,
        netNewSymbols,
    };
}

export function prependAnchoredTargets(
    targets: TicketMatchedNode[],
    anchors: TicketMatchedNode[],
    limit: number
): TicketMatchedNode[] {
    return dedupeAnchoredTargets([...anchors, ...targets]).slice(0, limit);
}

export function genericBaseConfigPenalty(
    nodeId: string,
    file: string | null,
    symbols: string[]
): number {
    return isGenericBaseConfigWithoutAnchor(nodeId, file, symbols) ? 400 : 0;
}

function dedupeAnchoredTargets(items: TicketMatchedNode[]): TicketMatchedNode[] {
    const seen = new Set<string>();
    const result: TicketMatchedNode[] = [];

    for (const item of items) {
        if (seen.has(item.id)) {
            continue;
        }

        seen.add(item.id);
        result.push(item);
    }

    return result.sort((left, right) => right.score - left.score);
}
