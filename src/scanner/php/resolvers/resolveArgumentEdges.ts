import { graph } from "../../../graph/graph";

function argumentToEdgeKey(
    from: string,
    to: string,
    argumentIndex: number,
    via?: string | null,
): string {
    return `${from}->${to}:ARGUMENT_TO:${argumentIndex}:${via ?? ""}`;
}

function removeArgumentToDuplicates(
    from: string,
    to: string,
    argumentIndex: number,
): void {
    for (const [key, edge] of graph.edges.entries()) {
        if (
            edge.type === "ARGUMENT_TO" &&
            edge.from === from &&
            edge.to === to &&
            edge.argumentIndex === argumentIndex
        ) {
            graph.edges.delete(key);
        }
    }
}

export function resolveArgumentEdges(): void {
    for (const flowEdge of graph.edges.values()) {
        if (flowEdge.type !== "FLOWS_TO") continue;
        if (flowEdge.argumentIndex === undefined) continue;

        const targetMethod = flowEdge.to;
        const targetParameterId = findParameterByIndex(
            targetMethod,
            flowEdge.argumentIndex,
        );

        if (!targetParameterId) continue;

        removeArgumentToDuplicates(flowEdge.from, targetParameterId, flowEdge.argumentIndex);

        graph.edges.set(
            argumentToEdgeKey(
                flowEdge.from,
                targetParameterId,
                flowEdge.argumentIndex,
                flowEdge.via,
            ),
            {
                from: flowEdge.from,
                to: targetParameterId,
                type: "ARGUMENT_TO",
                via: flowEdge.via,
                argumentIndex: flowEdge.argumentIndex,
                confidence: flowEdge.confidence ?? 1,
                reason: "Derived from FLOWS_TO edge and target method parameter index",
            },
        );
    }
}

function findParameterByIndex(
    methodId: string,
    argumentIndex: number,
): string | null {
    for (const edge of graph.edges.values()) {
        if (
            edge.from === methodId &&
            edge.type === "HAS_PARAMETER" &&
            edge.argumentIndex === argumentIndex
        ) {
            return edge.to;
        }
    }

    return null;
}
