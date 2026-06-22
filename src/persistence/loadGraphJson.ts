import fs from "node:fs";
import path from "node:path";
import { Graph, GraphNode } from "../graph/GraphTypes";

export interface GraphJsonFormat {
    nodes: Array<GraphNode & { id: string }>;
    edges: Array<{
        id?: string;
        from: string;
        to: string;
        type: string;
        callType?: string;
        via?: string;
    }>;
}

export function loadGraphJson(graphPath: string = "Graph.json"): Partial<Graph> {
    if (!fs.existsSync(graphPath)) {
        console.warn(`Graph file not found: ${graphPath}`);
        return { nodes: new Map(), edges: new Map() };
    }

    try {
        const raw = fs.readFileSync(graphPath, "utf8");
        const data = JSON.parse(raw) as GraphJsonFormat;

        const nodes = new Map<string, GraphNode>();
        const edges = new Map<string, { from: string; to: string; type: string; callType?: string; via?: string }>();

        if (data.nodes && Array.isArray(data.nodes)) {
            for (const node of data.nodes) {
                if (node.id) {
                    nodes.set(node.id, {
                        id: node.id,
                        parent: node.parent,
                        type: node.type,
                        name: node.name,
                        file: node.file,
                        isStatic: node.isStatic,
                        visibility: node.visibility,
                        startPosition: node.startPosition,
                        endPosition: node.endPosition,
                    });
                }
            }
        }

        if (data.edges && Array.isArray(data.edges)) {
            for (const edge of data.edges) {
                const edgeId = edge.id ?? `${edge.from}-${edge.to}-${edge.type}`;
                edges.set(edgeId, {
                    from: edge.from,
                    to: edge.to,
                    type: edge.type,
                    callType: edge.callType,
                    via: edge.via,
                });
            }
        }

        console.log(`Loaded ${nodes.size} nodes and ${edges.size} edges from ${graphPath}`);
        return { nodes, edges };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load Graph.json: ${message}`);
        return { nodes: new Map(), edges: new Map() };
    }
}

export function mergeGraphs(target: Graph, source: Partial<Graph>): void {
    if (source.nodes) {
        for (const [id, node] of source.nodes) {
            if (!target.nodes.has(id)) {
                target.nodes.set(id, node);
            }
        }
    }

    if (source.edges) {
        for (const [id, edge] of source.edges) {
            if (!target.edges.has(id)) {
                target.edges.set(id, edge);
            }
        }
    }
}

