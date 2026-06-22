import { Graph } from "./GraphTypes";

export const graph: Graph = {
    nodes: new Map(),
    edges: new Map(),
};

export function resetGraph(): void {
    graph.nodes.clear();
    graph.edges.clear();
}