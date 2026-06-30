import Database from "better-sqlite3";
import { isIncomingEntryEdgeType } from "../../graph/queries/graphEntryPoints";

type SQLiteDatabase = InstanceType<typeof Database>;

type RelationType =
    | "CALLS"
    | "DEPENDS_ON"
    | "EXTENDS"
    | "IMPLEMENTS"
    | "ROUTES_TO"
    | "BLADE_USES_ACTION";
type Orientation = "incoming" | "outgoing";

export interface ChangeImpactOptions {
    includeDependsOn?: boolean;
    includeInterfaceResolved?: boolean;
    depth?: number;
    limit?: number;
    decay?: number;
    graphIndex?: ImpactGraphIndex;
}

export interface ImpactGraphIndex {
    incomingByNode: Map<string, EdgeRow[]>;
    outgoingByNode: Map<string, EdgeRow[]>;
    getNodeFile: (id: string) => string | null;
}

export interface ImpactNodeScore {
    id: string;
    score: number;
    minDistance: number;
    incomingHits: number;
    outgoingHits: number;
}

export interface ImpactCaller {
    id: string;
    distance: number;
    score: number;
    file: string | null;
    relationType: RelationType;
}

export interface UsedDependency {
    id: string;
    relationType: RelationType;
    score: number;
    file: string | null;
}

export interface ChangeImpactComponents {
    directCallers: number;
    directCallChainCallers: number;
    directEntryPoints: number;
    indirectCallers: number;
    directCallees: number;
    dependencyLinks: number;
    inheritanceLinks: number;
    directCallerScore: number;
    indirectCallerScore: number;
    directCalleeScore: number;
    dependencyScore: number;
    inheritanceScore: number;
}

export interface ChangeImpactResult {
    targetId: string;
    targetType: string;
    depth: number;
    inspectedEdges: number;
    impactedNodes: number;
    affectedCallers: number;
    methodsUsedByTarget: number;
    usedDependencies: number;
    affectedFiles: number;
    affectedFilesList: string[];
    score: number;
    risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    components: ChangeImpactComponents;
    affectedCallersList: ImpactCaller[];
    usedByTargetList: UsedDependency[];
    topImpactedNodes: ImpactNodeScore[];
}

interface EdgeRow {
    from_id: string;
    to_id: string;
    type: RelationType;
    call_type?: string | null;
}

interface TraversalState {
    affectedCallersMap: Map<string, ImpactCaller>;
    usedByTargetMap: Map<string, UsedDependency>;
    components: ChangeImpactComponents;
    visitedDepth: Map<string, number>;
    affectedFileSet: Set<string>;
    impactedNodeSet: Set<string>;
    dependencyEdgeSet: Set<string>;
    inheritanceEdgeSet: Set<string>;
    inspectedEdges: number;
}

const BASE_WEIGHTS: Record<RelationType, Record<Orientation, number>> = {
    CALLS: {
        incoming: 5,
        outgoing: 2,
    },
    DEPENDS_ON: {
        incoming: 4,
        outgoing: 2,
    },
    EXTENDS: {
        incoming: 3,
        outgoing: 3,
    },
    IMPLEMENTS: {
        incoming: 2,
        outgoing: 2,
    },
    ROUTES_TO: {
        incoming: 5,
        outgoing: 0,
    },
    BLADE_USES_ACTION: {
        incoming: 4,
        outgoing: 0,
    },
};

function clampPositiveInt(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value) || value === undefined) {
        return fallback;
    }
    return Math.max(1, Math.floor(value));
}

function computeRisk(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
    if (score >= 40) {
        return "CRITICAL";
    }
    if (score >= 20) {
        return "HIGH";
    }
    if (score >= 8) {
        return "MEDIUM";
    }
    return "LOW";
}

function addContribution(
    state: TraversalState,
    relationType: RelationType,
    edgeKey: string,
    contribution: number,
): void {
    if (relationType === "DEPENDS_ON") {
        state.components.dependencyScore += contribution;
        state.dependencyEdgeSet.add(edgeKey);
    }

    if (relationType === "EXTENDS" || relationType === "IMPLEMENTS") {
        state.components.inheritanceScore += contribution;
        state.inheritanceEdgeSet.add(edgeKey);
    }
}

function traverseUpstream(
    targetId: string,
    incomingByNode: Map<string, EdgeRow[]>,
    depth: number,
    decay: number,
    getNodeFile: (id: string) => string | null,
    state: TraversalState,
): void {
    let frontier = new Set<string>([targetId]);
    state.visitedDepth.set(targetId, 0);

    for (let distance = 1; distance <= depth; distance++) {
        if (frontier.size === 0) {
            break;
        }

        const nextFrontier = new Set<string>();

        for (const current of frontier) {
            const relations = incomingByNode.get(current) ?? [];
            state.inspectedEdges += relations.length;

            for (const relation of relations) {
                const callerId = relation.from_id;
                if (callerId === targetId) {
                    continue;
                }

                const base = BASE_WEIGHTS[relation.type].incoming;
                const contribution = base * Math.pow(decay, distance - 1);

                const existing = state.affectedCallersMap.get(callerId) ?? {
                    id: callerId,
                    distance,
                    score: 0,
                    file: getNodeFile(callerId),
                    relationType: relation.type,
                };
                existing.score += contribution;
                existing.distance = Math.min(existing.distance, distance);
                if (existing.relationType !== relation.type && existing.score === contribution) {
                    existing.relationType = relation.type;
                }
                state.affectedCallersMap.set(callerId, existing);
                state.impactedNodeSet.add(callerId);

                if (existing.file) {
                    state.affectedFileSet.add(existing.file);
                }

                if (distance === 1) {
                    state.components.directCallerScore += contribution;
                } else {
                    state.components.indirectCallerScore += contribution;
                }

                addContribution(state, relation.type, `${relation.from_id}->${relation.to_id}:${relation.type}`, contribution);

                const knownDepth = state.visitedDepth.get(callerId);
                if (knownDepth === undefined || knownDepth > distance) {
                    state.visitedDepth.set(callerId, distance);
                    nextFrontier.add(callerId);
                }
            }
        }

        frontier = nextFrontier;
    }
}

function collectUsedByTarget(
    targetId: string,
    outgoingByNode: Map<string, EdgeRow[]>,
    getNodeFile: (id: string) => string | null,
    state: TraversalState,
): void {
    const outgoing = outgoingByNode.get(targetId) ?? [];
    state.inspectedEdges += outgoing.length;

    for (const relation of outgoing) {
        const calleeId = relation.to_id;
        const contribution = BASE_WEIGHTS[relation.type].outgoing;

        const existing = state.usedByTargetMap.get(calleeId) ?? {
            id: calleeId,
            relationType: relation.type,
            score: 0,
            file: getNodeFile(calleeId),
        };

        existing.score += contribution;
        state.usedByTargetMap.set(calleeId, existing);
        state.impactedNodeSet.add(calleeId);

        if (existing.file) {
            state.affectedFileSet.add(existing.file);
        }

        state.components.directCalleeScore += contribution;
        addContribution(state, relation.type, `${relation.from_id}->${relation.to_id}:${relation.type}`, contribution);
    }
}

export function buildImpactGraphIndex(
    db: SQLiteDatabase,
    options?: Pick<ChangeImpactOptions, "includeDependsOn" | "includeInterfaceResolved">,
): ImpactGraphIndex {
    const includeDependsOn = options?.includeDependsOn ?? false;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;

    const edgeRows = db.prepare(`
        SELECT from_id, to_id, type, call_type
        FROM edges
        WHERE type IN ('CALLS', 'EXTENDS', 'IMPLEMENTS', 'ROUTES_TO', 'BLADE_USES_ACTION')
           OR (? = 1 AND type = 'DEPENDS_ON')
    `).all(includeDependsOn ? 1 : 0) as EdgeRow[];

    const filteredEdges = edgeRows.filter(edge => {
        if (edge.type !== "CALLS" || includeInterfaceResolved) {
            return true;
        }
        return !edge.call_type || edge.call_type !== "INTERFACE_RESOLVED";
    });

    const incomingByNode = new Map<string, EdgeRow[]>();
    const outgoingByNode = new Map<string, EdgeRow[]>();
    for (const edge of filteredEdges) {
        const fromList = outgoingByNode.get(edge.from_id) ?? [];
        fromList.push(edge);
        outgoingByNode.set(edge.from_id, fromList);

        const toList = incomingByNode.get(edge.to_id) ?? [];
        toList.push(edge);
        incomingByNode.set(edge.to_id, toList);
    }

    const getNodeFileStmt = db.prepare(`
        SELECT file
        FROM nodes
        WHERE id = ?
        LIMIT 1
    `);
    const fileCache = new Map<string, string | null>();
    const getNodeFile = (id: string): string | null => {
        if (fileCache.has(id)) {
            return fileCache.get(id) ?? null;
        }
        const row = getNodeFileStmt.get(id) as { file: string | null } | undefined;
        const file = row?.file ?? null;
        fileCache.set(id, file);
        return file;
    };

    return { incomingByNode, outgoingByNode, getNodeFile };
}

export function analyzeChangeImpactWithIndex(
    index: ImpactGraphIndex,
    targetId: string,
    options?: ChangeImpactOptions,
): ChangeImpactResult {
    const depth = clampPositiveInt(options?.depth, 2);
    const limit = clampPositiveInt(options?.limit, 8);
    const decay = Number.isFinite(options?.decay) ? Math.max(0.1, Math.min(1, Number(options?.decay))) : 0.6;

    const state: TraversalState = {
        affectedCallersMap: new Map<string, ImpactCaller>(),
        usedByTargetMap: new Map<string, UsedDependency>(),
        components: {
            directCallers: 0,
            directCallChainCallers: 0,
            directEntryPoints: 0,
            indirectCallers: 0,
            directCallees: 0,
            dependencyLinks: 0,
            inheritanceLinks: 0,
            directCallerScore: 0,
            indirectCallerScore: 0,
            directCalleeScore: 0,
            dependencyScore: 0,
            inheritanceScore: 0,
        },
        visitedDepth: new Map<string, number>(),
        affectedFileSet: new Set<string>(),
        impactedNodeSet: new Set<string>(),
        dependencyEdgeSet: new Set<string>(),
        inheritanceEdgeSet: new Set<string>(),
        inspectedEdges: 0,
    };

    const targetFile = index.getNodeFile(targetId);
    if (targetFile) {
        state.affectedFileSet.add(targetFile);
    }

    traverseUpstream(targetId, index.incomingByNode, depth, decay, index.getNodeFile, state);
    collectUsedByTarget(targetId, index.outgoingByNode, index.getNodeFile, state);

    const affectedCallersList = Array.from(state.affectedCallersMap.values())
        .sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(item => ({ ...item, score: Number(item.score.toFixed(2)) }));

    const usedByTargetList = Array.from(state.usedByTargetMap.values())
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(item => ({ ...item, score: Number(item.score.toFixed(2)) }));

    state.components.directCallers = Array.from(state.affectedCallersMap.values()).filter(item => item.distance === 1).length;
    state.components.directCallChainCallers = Array.from(state.affectedCallersMap.values())
        .filter(item => item.distance === 1 && item.relationType === "CALLS")
        .length;
    state.components.directEntryPoints = Array.from(state.affectedCallersMap.values())
        .filter(item => item.distance === 1 && isIncomingEntryEdgeType(item.relationType))
        .length;
    state.components.indirectCallers = Array.from(state.affectedCallersMap.values()).filter(item => item.distance > 1).length;
    state.components.directCallees = state.usedByTargetMap.size;
    state.components.dependencyLinks = state.dependencyEdgeSet.size;
    state.components.inheritanceLinks = state.inheritanceEdgeSet.size;

    const topImpactedNodes = [
        ...Array.from(state.affectedCallersMap.values()).map(item => ({
            id: item.id,
            score: item.score,
            minDistance: item.distance,
            incomingHits: 1,
            outgoingHits: 0,
        })),
        ...Array.from(state.usedByTargetMap.values()).map(item => ({
            id: item.id,
            score: item.score,
            minDistance: 1,
            incomingHits: 0,
            outgoingHits: 1,
        })),
    ]
        .sort((a, b) => b.score - a.score || a.minDistance - b.minDistance || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(item => ({
            ...item,
            score: Number(item.score.toFixed(2)),
        }));

    const score = Number((state.components.directCallerScore + state.components.indirectCallerScore + state.components.directCalleeScore).toFixed(2));

    return {
        targetId,
        targetType: "unknown",
        depth,
        inspectedEdges: state.inspectedEdges,
        impactedNodes: state.impactedNodeSet.size,
        affectedCallers: state.affectedCallersMap.size,
        methodsUsedByTarget: state.usedByTargetMap.size,
        usedDependencies: state.usedByTargetMap.size,
        affectedFiles: state.affectedFileSet.size,
        affectedFilesList: Array.from(state.affectedFileSet).sort((a, b) => a.localeCompare(b)),
        score,
        risk: computeRisk(score),
        components: {
            directCallers: state.components.directCallers,
            directCallChainCallers: state.components.directCallChainCallers,
            directEntryPoints: state.components.directEntryPoints,
            indirectCallers: state.components.indirectCallers,
            directCallees: state.components.directCallees,
            dependencyLinks: state.components.dependencyLinks,
            inheritanceLinks: state.components.inheritanceLinks,
            directCallerScore: Number(state.components.directCallerScore.toFixed(2)),
            indirectCallerScore: Number(state.components.indirectCallerScore.toFixed(2)),
            directCalleeScore: Number(state.components.directCalleeScore.toFixed(2)),
            dependencyScore: Number(state.components.dependencyScore.toFixed(2)),
            inheritanceScore: Number(state.components.inheritanceScore.toFixed(2)),
        },
        affectedCallersList,
        usedByTargetList,
        topImpactedNodes,
    };
}

export function analyzeChangeImpact(
    db: SQLiteDatabase,
    targetId: string,
    options?: ChangeImpactOptions,
): ChangeImpactResult {
    const index = options?.graphIndex ?? buildImpactGraphIndex(db, options);

    const targetNode = db.prepare(`
        SELECT id, type
        FROM nodes
        WHERE id = ?
    `).get(targetId) as { id: string; type: string } | undefined;

    const result = analyzeChangeImpactWithIndex(index, targetId, options);
    result.targetType = targetNode?.type ?? "unknown";
    return result;
}


