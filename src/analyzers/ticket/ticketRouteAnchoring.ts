import { endpointNodeId, normalizeEndpointPath } from "../../scanner/php/routes/endpointId";
import { TicketMatchedNode } from "./ticketAnalyzerV3";
import { DbEdgeRow, DbNodeRow, TicketGraphContext } from "./ticketGraphContext";
import { compactAnchor } from "./ticketSymbolAnchors";

export interface TicketRouteRef {
    method: string;
    path: string;
    raw: string;
}

const HTTP_METHOD_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE)\b/gi;

export function extractTicketRoutes(ticketText: string): TicketRouteRef[] {
    const routes = new Map<string, TicketRouteRef>();

    for (const match of ticketText.matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE)\s+(?:api\/v\d+\/)?([a-z0-9][a-z0-9./_{}-]*)/gi
    )) {
        addRoute(routes, match[1], match[2]);
    }

    for (const match of ticketText.matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE)\s+…\/([a-z0-9][a-z0-9./_{}-]*)/gi
    )) {
        addRoute(routes, match[1], match[2]);
    }

    return [...routes.values()];
}

function addRoute(routes: Map<string, TicketRouteRef>, method: string, rawPath: string): void {
    const cleaned = rawPath
        .replace(/…/g, "")
        .replace(/\s+is\b.*$/i, "")
        .replace(/\s+with\b.*$/i, "")
        .replace(/\s+without\b.*$/i, "")
        .replace(/\s+/g, "")
        .trim();

    const path = normalizeTicketRoutePath(cleaned);
    if (!path || path.length < 3) {
        return;
    }

    const key = `${method.toUpperCase()}:${path}`;
    routes.set(key, {
        method: method.toUpperCase(),
        path,
        raw: `${method.toUpperCase()} ${cleaned}`,
    });
}

export function normalizeTicketRoutePath(path: string): string {
    return normalizeEndpointPath(
        path
            .replace(/^api\/v\d+\//i, "")
            .replace(/^\/+/, "")
            .replace(/\s+/g, "")
    ).replace(/^\/+/, "");
}

function pathsMatch(endpointPath: string, ticketPath: string): boolean {
    const left = normalizeTicketRoutePath(endpointPath);
    const right = normalizeTicketRoutePath(ticketPath);

    if (!left || !right) {
        return false;
    }

    if (left === right) {
        return true;
    }

    return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function resolveRoutesToHandler(
    endpointId: string,
    edges: DbEdgeRow[],
    nodeById: Map<string, DbNodeRow>
): TicketMatchedNode | null {
    const routeEdge = edges.find(edge => edge.from_id === endpointId && edge.type === "ROUTES_TO");
    if (!routeEdge) {
        return null;
    }

    const handler = nodeById.get(routeEdge.to_id);
    if (!handler) {
        return null;
    }

    return {
        id: handler.id,
        type: handler.type,
        name: handler.name,
        file: handler.file,
        score: 1500,
        reason: `Route anchor: ${endpointId} → handler`,
    };
}

export function matchRouteAnchoredEndpoints(
    routes: TicketRouteRef[],
    graph: TicketGraphContext
): TicketMatchedNode[] {
    if (routes.length === 0) {
        return [];
    }

    const endpoints = graph.nodesByType.get("api_endpoint") ?? [];
    const matches: TicketMatchedNode[] = [];

    for (const route of routes) {
        for (const endpoint of endpoints) {
            const parsed = parseEndpointNode(endpoint.id);
            if (!parsed) {
                continue;
            }

            if (parsed.method !== route.method) {
                continue;
            }

            if (!pathsMatch(parsed.path, route.path)) {
                continue;
            }

            matches.push({
                id: endpoint.id,
                type: endpoint.type,
                name: endpoint.name,
                file: endpoint.file,
                score: 2000,
                reason: `Route anchor: ${route.raw}`,
            });

            const handler = resolveRoutesToHandler(endpoint.id, graph.edges, graph.nodeById);
            if (handler) {
                matches.push({
                    ...handler,
                    score: 2200,
                    reason: `Route anchor handler for ${route.raw}`,
                });
            }
        }
    }

    return dedupeMatches(matches);
}

function parseEndpointNode(endpointId: string): { method: string; path: string } | null {
    const match = endpointId.match(/^api:([^:]+):(.+)$/i);
    if (!match?.[1] || !match[2]) {
        return null;
    }

    return {
        method: match[1].toUpperCase(),
        path: normalizeTicketRoutePath(match[2]),
    };
}

export function endpointNodeIdFromRoute(route: TicketRouteRef): string {
    return endpointNodeId(route.method, `/${route.path}`);
}

export function routeLabelsFromAnchors(routes: TicketRouteRef[]): string[] {
    const labels = new Set<string>();

    for (const route of routes) {
        labels.add(compactAnchor(route.path));

        for (const segment of route.path.split("/")) {
            const compact = compactAnchor(segment);
            if (compact.length >= 5) {
                labels.add(compact);
            }
        }
    }

    return [...labels];
}

function dedupeMatches(items: TicketMatchedNode[]): TicketMatchedNode[] {
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
