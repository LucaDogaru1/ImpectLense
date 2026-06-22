import {graph} from "../../../graph/graph";

export function resolveInterfaceCalls() {
    const callEdges = Array.from(graph.edges.values()).filter(
        edge => edge.type === "CALLS"
    );

    for (const callEdge of callEdges) {
        const target = callEdge.to;

        if (!target.includes("::")) {
            continue;
        }

        const [interfaceId, methodName] = target.split("::");

        const targetNode = graph.nodes.get(interfaceId);

        if (!targetNode || targetNode.type !== "interface") {
            continue;
        }

        const implementations = Array.from(graph.edges.values()).filter(
            edge =>
                edge.type === "IMPLEMENTS" &&
                edge.to === interfaceId
        );

        for(const implementation of implementations){
            const implementingClass = implementation.from;

            const resolvedMethod = implementingClass + "::" + methodName;

            if (!graph.nodes.has(resolvedMethod)) {
                continue;
            }

            graph.edges.set(callEdge.from + "->" + resolvedMethod + ":INTERFACE_RESOLVED", {
                from: callEdge.from,
                to: resolvedMethod,
                type: "CALLS",
                callType: "INTERFACE_RESOLVED",
                via: callEdge.to,
            });

     }
    }
}