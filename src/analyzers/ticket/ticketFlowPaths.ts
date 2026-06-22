import { DbEdgeRow } from "./ticketGraphContext";

export interface TicketFlowPath {
    path: string;
    complete: boolean;
    gap?: string;
}

interface ScoredGraphNode {
    id: string;
    type: string;
    score: number;
    reason: string;
    name?: string;
    file?: string | null;
}

function shortLabel(nodeId: string): string {
    if (nodeId.startsWith("api:")) {
        const parts = nodeId.split(":");
        return `${parts[1] ?? "HTTP"} ${parts.slice(2).join(":")}`;
    }

    const segments = nodeId.split("\\");
    const tail = segments[segments.length - 1] ?? nodeId;
    if (nodeId.includes(".vue::")) {
        return nodeId.split("::").slice(-2).join("::");
    }

    return tail;
}

export function buildTicketFlowPaths(
    topMatches: ScoredGraphNode[],
    edges: DbEdgeRow[],
    limit = 5
): TicketFlowPath[] {
    const paths: TicketFlowPath[] = [];
    const seen = new Set<string>();

    const edgesByFrom = new Map<string, DbEdgeRow[]>();
    for (const edge of edges) {
        const bucket = edgesByFrom.get(edge.from_id) ?? [];
        bucket.push(edge);
        edgesByFrom.set(edge.from_id, bucket);
    }

    const seedNodes = topMatches.filter(node =>
        node.type === "vue_component" ||
        node.type === "method" ||
        node.id.includes(".vue::")
    ).slice(0, 8);

    for (const seed of seedNodes) {
        const httpEdges = (edgesByFrom.get(seed.id) ?? []).filter(edge => edge.type === "HTTP_REQUEST");

        for (const httpEdge of httpEdges) {
            const endpointId = httpEdge.to_id;
            const routeEdge = (edgesByFrom.get(endpointId) ?? []).find(edge => edge.type === "ROUTES_TO");
            const parts = [shortLabel(seed.id), shortLabel(endpointId)];

            if (routeEdge) {
                parts.push(shortLabel(routeEdge.to_id));
                paths.push({
                    path: parts.join(" → "),
                    complete: true,
                });
            } else {
                paths.push({
                    path: parts.join(" → "),
                    complete: false,
                    gap: "No backend ROUTES_TO edge for this endpoint",
                });
            }
        }

        if (httpEdges.length === 0 && seed.type === "vue_component") {
            const key = `${seed.id}:no-http`;
            if (!seen.has(key)) {
                seen.add(key);
                paths.push({
                    path: shortLabel(seed.id),
                    complete: false,
                    gap: "No HTTP_REQUEST edge from this component",
                });
            }
        }
    }

    for (const endpointMatch of topMatches.filter(node => node.type === "api_endpoint").slice(0, 5)) {
        const routeEdge = (edgesByFrom.get(endpointMatch.id) ?? []).find(edge => edge.type === "ROUTES_TO");
        if (!routeEdge) {
            continue;
        }

        const path = `${shortLabel(endpointMatch.id)} → ${shortLabel(routeEdge.to_id)}`;
        if (!seen.has(path)) {
            seen.add(path);
            paths.push({ path, complete: true });
        }
    }

    return paths.slice(0, limit);
}

export function scoreGraphProximityBoost(
    nodeId: string,
    seedNodeIds: Set<string>,
    edges: DbEdgeRow[]
): number {
    if (seedNodeIds.has(nodeId)) {
        return 0;
    }

    const neighbors = new Map<string, number>();

    for (const edge of edges) {
        if (seedNodeIds.has(edge.from_id)) {
            neighbors.set(edge.to_id, 1);
        }
        if (seedNodeIds.has(edge.to_id)) {
            neighbors.set(edge.from_id, 1);
        }
    }

    const distance = neighbors.get(nodeId);
    if (!distance) {
        return 0;
    }

    return Math.max(0, 120 - (distance - 1) * 40);
}

export function applyGraphProximityBoost<T extends ScoredGraphNode>(
    matches: T[],
    seedNodeIds: Set<string>,
    edges: DbEdgeRow[]
): T[] {
    if (seedNodeIds.size === 0) {
        return matches;
    }

    return matches
        .map(match => {
            const boost = scoreGraphProximityBoost(match.id, seedNodeIds, edges);
            if (boost <= 0) {
                return match;
            }

            return {
                ...match,
                score: match.score + boost,
                reason: `${match.reason} | Graph proximity: +${boost}`,
            };
        })
        .sort((a, b) => b.score - a.score);
}
