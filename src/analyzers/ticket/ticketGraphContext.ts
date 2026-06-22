import Database from "better-sqlite3";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface DbNodeRow {
    id: string;
    type: string;
    name: string;
    file: string | null;
    parent: string | null;
    description: string | null;
    keywords: string | null;
}

export interface DbEdgeRow {
    from_id: string;
    to_id: string;
    type: string;
    via?: string | null;
    argument_index?: number | null;
    confidence?: number | null;
    reason?: string | null;
}

export interface TicketGraphContext {
    nodes: DbNodeRow[];
    edges: DbEdgeRow[];
    nodeById: Map<string, DbNodeRow>;
    nodesByType: Map<string, DbNodeRow[]>;
    haystackById: Map<string, string>;
    persistEdges: DbEdgeRow[];
    serializesEdges: DbEdgeRow[];
}

function normalizeKeywords(value: string | null): string {
    if (!value) return "";

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.join(" ") : String(parsed);
    } catch {
        return value;
    }
}

function buildHaystack(row: DbNodeRow): string {
    return [
        row.id,
        row.name,
        row.file ?? "",
        row.parent ?? "",
        row.description ?? "",
        normalizeKeywords(row.keywords),
    ].join(" ").toLowerCase();
}

export function loadAllNodes(db: SQLiteDatabase): DbNodeRow[] {
    return db.prepare(`
        SELECT id, type, name, file, parent, description, keywords
        FROM nodes
        ORDER BY id ASC
    `).all() as DbNodeRow[];
}

export function loadAllEdges(db: SQLiteDatabase): DbEdgeRow[] {
    return db.prepare(`
        SELECT from_id, to_id, type, via, argument_index, confidence, reason
        FROM edges
        ORDER BY from_id ASC, to_id ASC
    `).all() as DbEdgeRow[];
}

export function loadTicketGraphContext(db: SQLiteDatabase): TicketGraphContext {
    const nodes = loadAllNodes(db);
    const edges = loadAllEdges(db);
    const nodeById = new Map<string, DbNodeRow>();
    const nodesByType = new Map<string, DbNodeRow[]>();
    const haystackById = new Map<string, string>();
    const persistEdges: DbEdgeRow[] = [];
    const serializesEdges: DbEdgeRow[] = [];

    for (const node of nodes) {
        nodeById.set(node.id, node);
        haystackById.set(node.id, buildHaystack(node));

        const bucket = nodesByType.get(node.type);
        if (bucket) {
            bucket.push(node);
        } else {
            nodesByType.set(node.type, [node]);
        }
    }

    for (const edge of edges) {
        if (edge.type === "PERSISTS") {
            persistEdges.push(edge);
        } else if (edge.type === "SERIALIZES") {
            serializesEdges.push(edge);
        }
    }

    return {
        nodes,
        edges,
        nodeById,
        nodesByType,
        haystackById,
        persistEdges,
        serializesEdges,
    };
}

export function getNodesOfTypes(
    graph: TicketGraphContext,
    types: string[]
): DbNodeRow[] {
    const result: DbNodeRow[] = [];

    for (const type of types) {
        const bucket = graph.nodesByType.get(type);
        if (bucket) {
            result.push(...bucket);
        }
    }

    return result;
}
