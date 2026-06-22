import Database from "better-sqlite3";

export interface HotspotItem {
    id: string;
    type: string;
    name: string;
    file: string | null;
    incoming: number;
    outgoing: number;
    score: number;
}

export interface HotspotResult {
    inspectedNodes: number;
    includeInterfaceResolved: boolean;
    includeDependsOn: boolean;
    limit: number;
    methodHotspots: HotspotItem[];
    classHotspots: HotspotItem[];
    dependencyHotspots: HotspotItem[];
    fanOutHotspots: HotspotItem[];
}

type SQLiteDatabase = InstanceType<typeof Database>;

interface HotspotOptions {
    includeDependsOn?: boolean;
    includeInterfaceResolved?: boolean;
    limit?: number;
}

export function analyzeHotspots(db: SQLiteDatabase, options?: HotspotOptions): HotspotResult {
    const includeDependsOn = options?.includeDependsOn ?? false;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const limit = options?.limit ?? 10;

    const nodes = db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        ORDER BY id ASC
    `).all() as Array<{ id: string; type: string; name: string; file: string | null }>;

    const incomingCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();

    const incomingRows = db.prepare(`
        SELECT to_id AS id, COUNT(*) AS count
        FROM edges
        WHERE (
            type = 'CALLS'
            AND (
                ? = 1
                OR call_type IS NULL
                OR call_type != 'INTERFACE_RESOLVED'
            )
        )
           OR (? = 1 AND type = 'DEPENDS_ON')
        GROUP BY to_id
    `).all(includeInterfaceResolved ? 1 : 0, includeDependsOn ? 1 : 0) as Array<{ id: string; count: number }>;

    const outgoingRows = db.prepare(`
        SELECT from_id AS id, COUNT(*) AS count
        FROM edges
        WHERE (
            type = 'CALLS'
            AND (
                ? = 1
                OR call_type IS NULL
                OR call_type != 'INTERFACE_RESOLVED'
            )
        )
           OR (? = 1 AND type = 'DEPENDS_ON')
        GROUP BY from_id
    `).all(includeInterfaceResolved ? 1 : 0, includeDependsOn ? 1 : 0) as Array<{ id: string; count: number }>;

    const dependencyIncomingRows = db.prepare(`
        SELECT to_id AS id, COUNT(*) AS count
        FROM edges
        WHERE type = 'DEPENDS_ON'
        GROUP BY to_id
    `).all() as Array<{ id: string; count: number }>;

    const dependencyOutgoingRows = db.prepare(`
        SELECT from_id AS id, COUNT(*) AS count
        FROM edges
        WHERE type = 'DEPENDS_ON'
        GROUP BY from_id
    `).all() as Array<{ id: string; count: number }>;

    for (const row of incomingRows) {
        incomingCounts.set(row.id, Number(row.count ?? 0));
    }

    for (const row of outgoingRows) {
        outgoingCounts.set(row.id, Number(row.count ?? 0));
    }

    const dependencyIncomingCounts = new Map<string, number>();
    const dependencyOutgoingCounts = new Map<string, number>();

    for (const row of dependencyIncomingRows) {
        dependencyIncomingCounts.set(row.id, Number(row.count ?? 0));
    }

    for (const row of dependencyOutgoingRows) {
        dependencyOutgoingCounts.set(row.id, Number(row.count ?? 0));
    }

    const scoredItems: HotspotItem[] = nodes
        .map(node => {
            const incoming = incomingCounts.get(node.id) ?? 0;
            const outgoing = outgoingCounts.get(node.id) ?? 0;
            const score = incoming + outgoing;

            return {
                id: node.id,
                type: node.type,
                name: node.name,
                file: node.file,
                incoming,
                outgoing,
                score,
            };
        })
        .filter(item => item.score > 0);

    const sortByScore = (a: HotspotItem, b: HotspotItem): number => b.score - a.score || a.id.localeCompare(b.id);

    const methodHotspots = scoredItems
        .filter(item => item.type === "method")
        .sort(sortByScore)
        .slice(0, limit);

    const classHotspots = scoredItems
        .filter(item => item.type === "class")
        .sort(sortByScore)
        .slice(0, limit);

    const dependencyHotspots = nodes
        .filter(node => node.type === "class")
        .map(node => {
            const incoming = dependencyIncomingCounts.get(node.id) ?? 0;
            const outgoing = dependencyOutgoingCounts.get(node.id) ?? 0;
            const score = incoming + outgoing;

            return {
                id: node.id,
                type: node.type,
                name: node.name,
                file: node.file,
                incoming,
                outgoing,
                score,
            };
        })
        .filter(item => item.score > 0)
        .sort(sortByScore)
        .slice(0, limit);

    const fanOutHotspots = scoredItems
        .filter(item => item.outgoing > 0)
        .sort((a, b) => b.outgoing - a.outgoing || a.id.localeCompare(b.id))
        .slice(0, limit);

    return {
        inspectedNodes: nodes.length,
        includeInterfaceResolved,
        includeDependsOn,
        limit,
        methodHotspots,
        classHotspots,
        dependencyHotspots,
        fanOutHotspots,
    };
}

