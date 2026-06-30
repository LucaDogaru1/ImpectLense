import { graph } from "../../../graph/graph";

export function extendingClassesByParent(): Map<string, string[]> {
    const childrenByParent = new Map<string, string[]>();

    for (const edge of graph.edges.values()) {
        if (edge.type !== "EXTENDS") {
            continue;
        }

        const children = childrenByParent.get(edge.to) ?? [];
        children.push(edge.from);
        childrenByParent.set(edge.to, children);
    }

    return childrenByParent;
}

export function collectDescendantClasses(
    baseClassId: string,
    childrenByParent: Map<string, string[]>
): string[] {
    const descendants: string[] = [];
    const stack = [...(childrenByParent.get(baseClassId) ?? [])];
    const visited = new Set<string>();

    while (stack.length > 0) {
        const childClassId = stack.pop()!;

        if (visited.has(childClassId)) {
            continue;
        }

        visited.add(childClassId);
        descendants.push(childClassId);
        stack.push(...(childrenByParent.get(childClassId) ?? []));
    }

    return descendants;
}

export function resolveExtendsCalls(): void {
    const childrenByParent = extendingClassesByParent();
    const callEdges = Array.from(graph.edges.values()).filter(edge => edge.type === "CALLS");

    for (const callEdge of callEdges) {
        const target = callEdge.to;

        if (!target.includes("::")) {
            continue;
        }

        const separatorIndex = target.lastIndexOf("::");
        const classId = target.slice(0, separatorIndex);
        const methodName = target.slice(separatorIndex + 2);
        const classNode = graph.nodes.get(classId);
        const methodNode = graph.nodes.get(target);

        if (!classNode || classNode.type !== "class" || !methodNode?.isAbstract) {
            continue;
        }

        for (const implementingClass of collectDescendantClasses(classId, childrenByParent)) {
            const resolvedMethod = `${implementingClass}::${methodName}`;
            const resolvedNode = graph.nodes.get(resolvedMethod);

            if (!resolvedNode || resolvedNode.isAbstract) {
                continue;
            }

            graph.edges.set(
                `${callEdge.from}->${resolvedMethod}:EXTENDS_RESOLVED`,
                {
                    from: callEdge.from,
                    to: resolvedMethod,
                    type: "CALLS",
                    callType: "EXTENDS_RESOLVED",
                    via: target,
                }
            );
        }
    }
}
