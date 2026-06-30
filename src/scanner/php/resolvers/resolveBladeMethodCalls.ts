import { graph } from "../../../graph/graph";

function normalizeMethodName(methodName: string): string {
    return methodName.toLowerCase();
}

export function resolveBladeMethodCalls(): void {
    const methodRefs = [...graph.nodes.values()].filter(node => node.type === "blade_method_ref");
    const methodsByName = new Map<string, string[]>();

    for (const node of graph.nodes.values()) {
        if (node.type !== "method" || node.visibility !== "public") {
            continue;
        }

        const normalizedName = normalizeMethodName(node.name);
        const matches = methodsByName.get(normalizedName) ?? [];
        matches.push(node.id);
        methodsByName.set(normalizedName, matches);
    }

    for (const methodRef of methodRefs) {
        const matchingMethods = methodsByName.get(normalizeMethodName(methodRef.name)) ?? [];

        if (matchingMethods.length === 0) {
            continue;
        }

        const bladeCallEdges = [...graph.edges.values()].filter(
            edge => edge.type === "BLADE_METHOD_CALL" && edge.to === methodRef.id
        );

        for (const bladeCallEdge of bladeCallEdges) {
            for (const methodId of matchingMethods) {
                graph.edges.set(`${bladeCallEdge.from}->${methodId}:BLADE_CALLS`, {
                    from: bladeCallEdge.from,
                    to: methodId,
                    type: "BLADE_CALLS",
                    via: methodRef.id,
                });
            }
        }
    }
}
