import { graph } from "../../../graph/graph";
import { GraphEdge, GraphNode } from "../../../graph/GraphTypes";
import {
    canonicalEndpointId,
    canonicalKeyFromEndpointId,
    parseApiEndpointId,
} from "../resolvers/endpointNormalizer";

export interface CrossLanguageLinkStats {
    canonicalized: number;
    merged: number;
    backendLinked: number;
}

function hasRoutesTo(endpointId: string): boolean {
    for (const edge of graph.edges.values()) {
        if (edge.from === endpointId && edge.type === "ROUTES_TO") {
            return true;
        }
    }
    return false;
}

function isJsDiscoveredEndpoint(endpointId: string): boolean {
    for (const edge of graph.edges.values()) {
        if (edge.to === endpointId && edge.type === "HTTP_REQUEST") {
            return true;
        }
    }
    return false;
}

function pickCanonicalEndpointId(ids: string[]): string {
    const withBackendRoute = ids.find(hasRoutesTo);
    if (withBackendRoute) {
        return withBackendRoute;
    }

    const canonicalMatch = ids.find(id => {
        const parsed = parseApiEndpointId(id);
        return parsed && id === canonicalEndpointId(parsed.method, parsed.path);
    });
    if (canonicalMatch) {
        return canonicalMatch;
    }

    return [...ids].sort()[0];
}

function mergeNodeMetadata(target: GraphNode, source: GraphNode): void {
    const keywords = new Set([...(target.keywords ?? []), ...(source.keywords ?? [])]);
    target.keywords = [...keywords];

    if (!target.description && source.description) {
        target.description = source.description;
    }

    if (!target.file && source.file) {
        target.file = source.file;
    }
}

function rebuildEdgeMap(edges: GraphEdge[]): void {
    graph.edges.clear();

    for (const edge of edges) {
        const key = `${edge.from}->${edge.to}:${edge.type}:${edge.via ?? ""}`;
        graph.edges.set(key, edge);
    }
}

function retargetEndpointId(oldId: string, newId: string, recordAlias = true): void {
    if (oldId === newId) {
        return;
    }

    const oldNode = graph.nodes.get(oldId);
    if (!oldNode) {
        return;
    }

    const targetNode = graph.nodes.get(newId);
    if (targetNode) {
        mergeNodeMetadata(targetNode, oldNode);
        graph.nodes.delete(oldId);
    } else {
        graph.nodes.delete(oldId);
        oldNode.id = newId;
        graph.nodes.set(newId, oldNode);
    }

    const updatedEdges = [...graph.edges.values()].map(edge => ({
        ...edge,
        from: edge.from === oldId ? newId : edge.from,
        to: edge.to === oldId ? newId : edge.to,
    }));

    if (recordAlias) {
        updatedEdges.push({
            from: oldId,
            to: newId,
            type: "RESOLVES_TO",
            reason: "Cross-language endpoint alias merged to canonical route node",
            confidence: 1,
        });
    }

    rebuildEdgeMap(updatedEdges);
}

function canonicalizeEndpointIds(): number {
    let canonicalized = 0;

    for (const [id, node] of [...graph.nodes.entries()]) {
        if (node.type !== "api_endpoint") {
            continue;
        }

        const parsed = parseApiEndpointId(id);
        if (!parsed) {
            continue;
        }

        const nextId = canonicalEndpointId(parsed.method, parsed.path);
        if (nextId === id) {
            continue;
        }

        retargetEndpointId(id, nextId);
        canonicalized += 1;
    }

    return canonicalized;
}

function mergeDuplicateEndpoints(): number {
    const groups = new Map<string, string[]>();

    for (const [id, node] of graph.nodes) {
        if (node.type !== "api_endpoint") {
            continue;
        }

        const key = canonicalKeyFromEndpointId(id);
        if (!key) {
            continue;
        }

        const bucket = groups.get(key) ?? [];
        bucket.push(id);
        groups.set(key, bucket);
    }

    let merged = 0;

    for (const ids of groups.values()) {
        if (ids.length <= 1) {
            continue;
        }

        const canonicalId = pickCanonicalEndpointId(ids);

        for (const aliasId of ids) {
            if (aliasId === canonicalId) {
                continue;
            }

            retargetEndpointId(aliasId, canonicalId);
            merged += 1;
        }
    }

    return merged;
}

function countBackendLinkedEndpoints(): number {
    let count = 0;

    for (const [id, node] of graph.nodes) {
        if (node.type !== "api_endpoint") {
            continue;
        }

        if (hasRoutesTo(id) && isJsDiscoveredEndpoint(id)) {
            count += 1;
        }
    }

    return count;
}

/**
 * Unify JS fetch() endpoints with PHP Route::… nodes already in the graph.
 * Runs after the JS walk when scan.ts processes PHP first, then JS.
 */
export function linkCrossLanguageEndpoints(): CrossLanguageLinkStats {
    const canonicalized = canonicalizeEndpointIds();
    const merged = mergeDuplicateEndpoints();
    const backendLinked = countBackendLinkedEndpoints();

    return { canonicalized, merged, backendLinked };
}
