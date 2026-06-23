import { countTokenOverlap, extractDistinctiveTicketTokens } from "./ticketTextTokens";
import { DbEdgeRow } from "./ticketGraphContext";

export interface TicketFlowPath {
    path: string;
    complete: boolean;
    gap?: string;
}

export interface FlowPathFilterContext {
    ticketText: string;
    workflowType: string;
    seedNodeIds: string[];
    seedFiles?: Array<string | null>;
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

function expandFlowPathSeeds(
    seedNodes: ScoredGraphNode[],
    topMatches: ScoredGraphNode[],
    edgesByFrom: Map<string, DbEdgeRow[]>
): ScoredGraphNode[] {
    const expanded = [...seedNodes];
    const seen = new Set(seedNodes.map(node => node.id));

    for (const seed of seedNodes) {
        if (!seed.file) {
            continue;
        }

        for (const match of topMatches) {
            if (!match.file || match.file !== seed.file || seen.has(match.id)) {
                continue;
            }

            const hasHttp = (edgesByFrom.get(match.id) ?? []).some(edge => edge.type === "HTTP_REQUEST");
            if (hasHttp || match.id.includes("::fetch") || match.id.includes("::load")) {
                seen.add(match.id);
                expanded.push(match);
            }
        }
    }

    return expanded;
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

    const seedNodes = expandFlowPathSeeds(
        topMatches.filter(node =>
            node.type === "vue_component" ||
            node.type === "method" ||
            node.id.includes(".vue::")
        ).slice(0, 8),
        topMatches,
        edgesByFrom
    );

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

const GENERIC_FILE_BASENAMES = new Set([
    "index",
    "main",
    "app",
    "setup",
    "component",
    "view",
    "page",
    "layout",
]);

function seedLabelsFromContext(context: FlowPathFilterContext): string[] {
    const labels = new Set<string>();

    for (const seedId of context.seedNodeIds) {
        const componentName = seedId.split("::").pop();
        if (componentName && componentName.length >= 5 && !componentName.includes("@")) {
            labels.add(componentName.toLowerCase());
        }

        if (seedId.includes(".vue")) {
            const pathParts = seedId.split(/[/\\]/);
            const filePart = pathParts.pop()?.split("::")[0]?.toLowerCase().replace(/\.vue$/i, "") ?? "";
            const parentPart = pathParts.pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";

            if (parentPart.length >= 5) {
                labels.add(parentPart);
            }

            if (filePart.length >= 5 && !GENERIC_FILE_BASENAMES.has(filePart)) {
                labels.add(filePart);
            }
        }
    }

    for (const file of context.seedFiles ?? []) {
        if (!file) {
            continue;
        }

        const parts = file.split(/[/\\]/);
        const basename = parts.pop()?.toLowerCase().replace(/\.(vue|tsx?|jsx?)$/i, "") ?? "";
        const parent = parts.pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";

        if (parent.length >= 5) {
            labels.add(parent);
        }

        if (basename.length >= 5 && !GENERIC_FILE_BASENAMES.has(basename)) {
            labels.add(basename);
        }
    }

    return [...labels];
}

function flowPathMatchesSeed(path: TicketFlowPath, seedLabels: string[]): boolean {
    const pathLower = path.path.toLowerCase();
    return seedLabels.some(label => pathLower.includes(label));
}

function scoreFlowPathRelevance(path: TicketFlowPath, context: FlowPathFilterContext, seedLabels: string[]): number {
    if (flowPathMatchesSeed(path, seedLabels)) {
        return 100;
    }

    const tokens = extractDistinctiveTicketTokens(context.ticketText);
    const tokenScore = countTokenOverlap(path.path, tokens);

    if (tokenScore <= 0) {
        return 0;
    }

    if (path.complete && tokenScore < 3) {
        return 0;
    }

    return 20 + tokenScore;
}

export function filterFlowPathsForBriefing(
    paths: TicketFlowPath[],
    context: FlowPathFilterContext,
    limit = 5
): TicketFlowPath[] {
    if (paths.length === 0) {
        return [];
    }

    const seedLabels = seedLabelsFromContext(context);

    const scored = paths
        .map(path => ({
            path,
            score: scoreFlowPathRelevance(path, context, seedLabels),
        }))
        .filter(entry => {
            if (entry.score >= 20) {
                return true;
            }

            if (!entry.path.complete && flowPathMatchesSeed(entry.path, seedLabels)) {
                return true;
            }

            if (context.workflowType === "queue" && entry.path.complete) {
                return false;
            }

            return false;
        })
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            if (left.path.complete !== right.path.complete) {
                return left.path.complete ? 1 : -1;
            }

            return 0;
        });

    const uiPartialFirst =
        context.workflowType === "ui"
            ? [
                ...scored.filter(entry => !entry.path.complete),
                ...scored.filter(entry => entry.path.complete),
            ]
            : scored;

    const seen = new Set<string>();
    const filtered: TicketFlowPath[] = [];

    for (const entry of uiPartialFirst) {
        const key = `${entry.path.complete}:${entry.path.path}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        filtered.push(entry.path);

        if (filtered.length >= limit) {
            break;
        }
    }

    return filtered;
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
