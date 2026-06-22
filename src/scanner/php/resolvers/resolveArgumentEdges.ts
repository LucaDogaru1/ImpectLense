import { graph } from "../../../graph/graph";

export function resolveArgumentEdges(): void {
    for (const flowEdge of graph.edges.values()) {
        if (flowEdge.type !== "FLOWS_TO") continue;
        if (flowEdge.argumentIndex === undefined) continue;

        const targetMethod = flowEdge.to;
        const targetParameterId = findParameterByIndex(
            targetMethod,
            flowEdge.argumentIndex
        );

        if (!targetParameterId) continue;

        graph.edges.set(
            `${flowEdge.from}->${targetParameterId}:ARGUMENT_TO:${flowEdge.argumentIndex}:${flowEdge.via ?? ""}`,
            {
                from: flowEdge.from,
                to: targetParameterId,
                type: "ARGUMENT_TO",
                via: flowEdge.via,
                argumentIndex: flowEdge.argumentIndex,
                confidence: flowEdge.confidence ?? 1,
                reason: "Derived from FLOWS_TO edge and target method parameter index",
            }
        );
    }
}

function findParameterByIndex(
    methodId: string,
    argumentIndex: number
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