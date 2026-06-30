import Database from "better-sqlite3";

export interface CycleItem {
    nodes: string[];
    length: number;
    files: string[];
    edgeTypes: string[];
}

export interface CycleResult {
    totalEdges: number;
    cycleCount: number;
    includeDependsOn: boolean;
    includeInterfaceResolved: boolean;
    cycles: CycleItem[];
}

type SQLiteDatabase = InstanceType<typeof Database>;

interface CycleOptions {
    includeDependsOn?: boolean;
    includeInterfaceResolved?: boolean;
}

interface CycleFromNodeOptions extends CycleOptions {
    maxDepth?: number;
    limit?: number;
}

function normalizeCycle(nodes: string[]): string {
    const core = nodes.slice(0, -1);
    if (core.length === 0) {
        return nodes.join(" -> ");
    }

    let best = "";
    for (let index = 0; index < core.length; index++) {
        const rotated = [...core.slice(index), ...core.slice(0, index)];
        const candidate = [...rotated, rotated[0]].join(" -> ");
        if (!best || candidate < best) {
            best = candidate;
        }
    }

    return best;
}

function buildCycleAdjacency(
    db: SQLiteDatabase,
    options: CycleOptions,
): {
    adjacency: Map<string, Array<{ to: string; edgeType: string }>>;
    nodeFiles: Map<string, string>;
} {
    const includeDependsOn = options.includeDependsOn ?? false;
    const includeInterfaceResolved = options.includeInterfaceResolved ?? false;

    const edges = db.prepare(`
        SELECT from_id, to_id, type, call_type
        FROM edges
        WHERE (
            type = 'CALLS'
            AND (
                ? = 1
                OR call_type IS NULL
                OR call_type != 'INTERFACE_RESOLVED'
            )
        )
        OR (
            ? = 1
            AND type = 'DEPENDS_ON'
        )
    `).all(includeInterfaceResolved ? 1 : 0, includeDependsOn ? 1 : 0) as Array<{
        from_id: string;
        to_id: string;
        type: string;
        call_type: string | null;
    }>;

    const nodeRows = db.prepare(`
        SELECT id, file
        FROM nodes
        WHERE file IS NOT NULL
    `).all() as Array<{ id: string; file: string | null }>;

    const nodeFiles = new Map<string, string>();
    for (const row of nodeRows) {
        if (row.file) {
            nodeFiles.set(row.id, row.file);
        }
    }

    const adjacency = new Map<string, Array<{ to: string; edgeType: string }>>();

    for (const edge of edges) {
        const edgeType = edge.type === "CALLS"
            ? (edge.call_type === "INTERFACE_RESOLVED" ? "CALLS:INTERFACE_RESOLVED" : "CALLS")
            : edge.type;

        const existing = adjacency.get(edge.from_id) ?? [];
        existing.push({ to: edge.to_id, edgeType });
        adjacency.set(edge.from_id, existing);
    }

    return { adjacency, nodeFiles };
}

function findCyclesFromStart(
    start: string,
    adjacency: Map<string, Array<{ to: string; edgeType: string }>>,
    nodeFiles: Map<string, string>,
    maxDepth: number,
    seenCycles: Set<string>,
    limit: number,
): CycleItem[] {
    const cycles: CycleItem[] = [];
    const path: string[] = [start];
    const pathEdgeTypes: string[] = [];
    const visited = new Set<string>([start]);

    const dfs = (current: string, depth: number): void => {
        if (depth > maxDepth || cycles.length >= limit) {
            return;
        }

        const neighbors = adjacency.get(current) ?? [];
        for (const neighbor of neighbors) {
            if (neighbor.to === start && path.length > 1) {
                const cycleNodes = [...path, neighbor.to];
                const cycleEdgeTypes = [...pathEdgeTypes, neighbor.edgeType];
                const key = normalizeCycle(cycleNodes);
                if (!seenCycles.has(key)) {
                    seenCycles.add(key);

                    const fileSet = new Set<string>();
                    for (const nodeId of cycleNodes) {
                        const file = nodeFiles.get(nodeId);
                        if (file) {
                            fileSet.add(file);
                        }
                    }

                    cycles.push({
                        nodes: cycleNodes,
                        length: cycleNodes.length - 1,
                        files: Array.from(fileSet).sort((a, b) => a.localeCompare(b)),
                        edgeTypes: cycleEdgeTypes,
                    });
                }
                continue;
            }

            if (visited.has(neighbor.to)) {
                continue;
            }

            visited.add(neighbor.to);
            path.push(neighbor.to);
            pathEdgeTypes.push(neighbor.edgeType);
            dfs(neighbor.to, depth + 1);
            path.pop();
            pathEdgeTypes.pop();
            visited.delete(neighbor.to);
        }
    };

    dfs(start, 1);
    return cycles;
}

/** Detect cycles reachable from one or more start nodes (fast path for single-target analysis). */
export function detectCyclesFromNodes(
    db: SQLiteDatabase,
    startNodeIds: string[],
    options?: CycleFromNodeOptions,
): CycleItem[] {
    const maxDepth = options?.maxDepth ?? 12;
    const limit = options?.limit ?? 20;
    const { adjacency, nodeFiles } = buildCycleAdjacency(db, options ?? {});
    const seenCycles = new Set<string>();
    const cycles: CycleItem[] = [];

    for (const start of startNodeIds) {
        if (!adjacency.has(start)) {
            continue;
        }

        const found = findCyclesFromStart(start, adjacency, nodeFiles, maxDepth, seenCycles, limit);
        cycles.push(...found);

        if (cycles.length >= limit) {
            break;
        }
    }

    cycles.sort((a, b) => a.length - b.length || a.nodes.join(" -> ").localeCompare(b.nodes.join(" -> ")));
    return cycles.slice(0, limit);
}

export function detectCycles(db: SQLiteDatabase, options?: CycleOptions): CycleResult {
    const includeDependsOn = options?.includeDependsOn ?? false;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;

    const { adjacency, nodeFiles } = buildCycleAdjacency(db, options ?? {});

    const seenCycles = new Set<string>();
    const cycles: CycleItem[] = [];
    const sortedNodes = Array.from(adjacency.keys()).sort((a, b) => a.localeCompare(b));

    for (const start of sortedNodes) {
        const found = findCyclesFromStart(start, adjacency, nodeFiles, 12, seenCycles, Number.MAX_SAFE_INTEGER);
        cycles.push(...found);
    }

    cycles.sort((a, b) => a.length - b.length || a.nodes.join(" -> ").localeCompare(b.nodes.join(" -> ")));

    return {
        totalEdges: [...adjacency.values()].reduce((sum, list) => sum + list.length, 0),
        cycleCount: cycles.length,
        includeDependsOn,
        includeInterfaceResolved,
        cycles,
    };
}
