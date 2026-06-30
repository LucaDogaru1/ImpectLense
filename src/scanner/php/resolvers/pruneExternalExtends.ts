import { graph } from "../../../graph/graph";

export function pruneExternalExtendsEdges(): void {
    for (const [edgeId, edge] of graph.edges.entries()) {
        if (edge.type !== "EXTENDS") {
            continue;
        }

        if (graph.nodes.has(edge.to)) {
            continue;
        }

        graph.edges.delete(edgeId);
    }
}
