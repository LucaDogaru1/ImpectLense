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
const CONTENT_WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const ACCESS_PATH_SEGMENT = /^(access|check-access|drm-license|drm-token)$/i;

export function extractTicketRoutes(ticketText: string): TicketRouteRef[] {
    const routes = new Map<string, TicketRouteRef>();

    for (const match of ticketText.matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE)\s+(?:api\/v\d+\/)?([a-z0-9][a-z0-9./_{}<>\-]*)/gi
    )) {
        addRoute(routes, match[1], match[2]);
    }

    for (const match of ticketText.matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE)\s+…\/([a-z0-9][a-z0-9./_{}<>\-]*)/gi
    )) {
        addRoute(routes, match[1], match[2]);
    }

    return [...routes.values()];
}

export function normalizeRoutePlaceholderPath(rawPath: string): string {
    return rawPath
        .replace(/<[^>]+>/g, "{param}")
        .replace(/\{[^}]+\}/g, "{param}")
        .replace(/\/+/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
}

export function routeMentionsAccess(route: TicketRouteRef): boolean {
    return ACCESS_PATH_SEGMENT.test(route.path) || /\/access\b/i.test(route.path);
}

export function isAccessSubpathEndpoint(path: string): boolean {
    const segments = normalizeTicketRoutePath(path)
        .split("/")
        .filter(Boolean)
        .map(segment => segment.replace(/^\{param\}$/i, "{param}"));

    return segments.some(segment => ACCESS_PATH_SEGMENT.test(segment.replace(/[{}]/g, "")));
}

function addRoute(routes: Map<string, TicketRouteRef>, method: string, rawPath: string): void {
    const cleaned = normalizeRoutePlaceholderPath(
        rawPath
            .replace(/…/g, "")
            .replace(/\s+is\b.*$/i, "")
            .replace(/\s+with\b.*$/i, "")
            .replace(/\s+without\b.*$/i, "")
            .replace(/\s+/g, "")
            .trim()
    );

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

function normalizeRouteSegment(segment: string): string {
    return segment.replace(/^\{param\}$/i, "{param}").toLowerCase();
}

function segmentsMatch(leftSegment: string, rightSegment: string): boolean {
    const left = normalizeRouteSegment(leftSegment);
    const right = normalizeRouteSegment(rightSegment);

    if (left === right) {
        return true;
    }

    if (left === "{param}" || right === "{param}") {
        return true;
    }

    if (left.endsWith("s") && left.slice(0, -1) === right) {
        return true;
    }

    if (right.endsWith("s") && right.slice(0, -1) === left) {
        return true;
    }

    return false;
}

function routePathSegments(path: string): string[] {
    return normalizeTicketRoutePath(path)
        .split("/")
        .filter(Boolean)
        .map(normalizeRouteSegment);
}

function methodsCompatible(ticketMethod: string, endpointMethod: string, ticketPath: string): boolean {
    if (ticketMethod === endpointMethod) {
        return true;
    }

    if (!CONTENT_WRITE_METHODS.has(ticketMethod) || !CONTENT_WRITE_METHODS.has(endpointMethod)) {
        return false;
    }

    const segments = routePathSegments(ticketPath);
    return segments.length > 0 && /^contents?$/.test(segments[0]!);
}

function pathsMatch(endpointPath: string, ticketPath: string, ticketRoute?: TicketRouteRef): boolean {
    const leftSegments = routePathSegments(endpointPath);
    const rightSegments = routePathSegments(ticketPath);

    if (leftSegments.length === 0 || rightSegments.length === 0) {
        return false;
    }

    const leftKey = leftSegments.join("/");
    const rightKey = rightSegments.join("/");

    if (leftKey === rightKey) {
        return true;
    }

    const shorter = rightSegments.length <= leftSegments.length ? rightSegments : leftSegments;
    const longer = rightSegments.length <= leftSegments.length ? leftSegments : rightSegments;
    const prefixMatches = shorter.every((segment, index) => segmentsMatch(longer[index] ?? "", segment));

    if (!prefixMatches) {
        return false;
    }

    const extraSegments = longer.slice(shorter.length);
    if (
        extraSegments.some(segment => ACCESS_PATH_SEGMENT.test(segment.replace(/[{}]/g, ""))) &&
        !(ticketRoute && routeMentionsAccess(ticketRoute))
    ) {
        return false;
    }

    if (rightSegments.length <= leftSegments.length) {
        return true;
    }

    return leftSegments.every((segment, index) => segmentsMatch(rightSegments[index] ?? "", segment));
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

            if (!methodsCompatible(route.method, parsed.method, route.path)) {
                continue;
            }

            if (isAccessSubpathEndpoint(parsed.path) && !routeMentionsAccess(route)) {
                continue;
            }

            if (!pathsMatch(parsed.path, route.path, route)) {
                continue;
            }

            const routeScore = scoreRouteAnchorMatch(route, parsed.method, parsed.path);

            matches.push({
                id: endpoint.id,
                type: endpoint.type,
                name: endpoint.name,
                file: endpoint.file,
                score: routeScore,
                reason: `Route anchor: ${route.raw}`,
            });

            const handler = resolveRoutesToHandler(endpoint.id, graph.edges, graph.nodeById);
            if (handler) {
                matches.push({
                    ...handler,
                    score: routeScore + 200,
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

function scoreRouteAnchorMatch(route: TicketRouteRef, endpointMethod: string, endpointPath: string): number {
    let score = 2000;

    if (route.method === endpointMethod) {
        score += 100;
    }

    if (isAccessSubpathEndpoint(endpointPath)) {
        score -= 1500;
    }

    const endpointSegments = routePathSegments(endpointPath);
    const ticketSegments = routePathSegments(route.path);
    if (endpointSegments.join("/") === ticketSegments.join("/")) {
        score += 300;
    }

    return score;
}
