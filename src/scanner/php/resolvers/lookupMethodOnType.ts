import { graph } from "../../../graph/graph";

function traitsUsedByClass(classId: string): string[] {
    const traits: string[] = [];

    for (const edge of graph.edges.values()) {
        if (edge.type === "USES_TRAIT" && edge.from === classId) {
            traits.push(edge.to);
        }
    }

    return traits;
}

export function extendsParentByClass(classId: string): string | undefined {
    for (const edge of graph.edges.values()) {
        if (edge.type === "EXTENDS" && edge.from === classId) {
            return edge.to;
        }
    }

    return undefined;
}

export function lookupMethodTarget(classId: string, methodName: string): string | undefined {
    let currentClassId: string | undefined = classId;
    const visited = new Set<string>();

    while (currentClassId && !visited.has(currentClassId)) {
        visited.add(currentClassId);

        const methodId = `${currentClassId}::${methodName}`;

        if (graph.nodes.has(methodId)) {
            return methodId;
        }

        for (const traitId of traitsUsedByClass(currentClassId)) {
            const traitMethodId = `${traitId}::${methodName}`;

            if (graph.nodes.has(traitMethodId)) {
                return traitMethodId;
            }
        }

        currentClassId = extendsParentByClass(currentClassId);
    }

    return undefined;
}

export function lookupMethodReturnType(classId: string, methodName: string): string | undefined {
    const methodId = lookupMethodTarget(classId, methodName);

    if (!methodId) {
        return undefined;
    }

    return graph.nodes.get(methodId)?.returnType;
}

export function resolveStaticClassName(rawClass: string, context: {
    currentClass?: string;
}): string | undefined {
    if (rawClass === "self") {
        return context.currentClass;
    }

    if (rawClass === "parent") {
        return context.currentClass
            ? extendsParentByClass(context.currentClass)
            : undefined;
    }

    return rawClass;
}
