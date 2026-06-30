import { graph } from "../../../graph/graph";
import {
    collectDescendantClasses,
    extendingClassesByParent,
} from "./resolveExtendsCalls";

const RESOLVED_CALL_TYPES = new Set(["EXTENDS_RESOLVED", "OVERRIDE_RESOLVED"]);

export function resolveOverrideCalls(): void {
    const childrenByParent = extendingClassesByParent();
    const callEdges = Array.from(graph.edges.values()).filter(
        edge => edge.type === "CALLS" && !RESOLVED_CALL_TYPES.has(edge.callType ?? "")
    );

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

        if (!classNode || classNode.type !== "class" || methodNode?.isAbstract) {
            continue;
        }

        for (const descendantClass of collectDescendantClasses(classId, childrenByParent)) {
            const resolvedMethod = `${descendantClass}::${methodName}`;
            const resolvedNode = graph.nodes.get(resolvedMethod);

            if (!resolvedNode || resolvedNode.isAbstract) {
                continue;
            }

            graph.edges.set(
                `${callEdge.from}->${resolvedMethod}:OVERRIDE_RESOLVED`,
                {
                    from: callEdge.from,
                    to: resolvedMethod,
                    type: "CALLS",
                    callType: "OVERRIDE_RESOLVED",
                    via: target,
                }
            );
        }
    }
}
