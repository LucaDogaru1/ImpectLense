import Database from "better-sqlite3";

type SQLiteDatabase = InstanceType<typeof Database>;

export type GraphNodeRow = {
    id: string;
    parent: string | null;
    type: string;
    name: string | null;
    file: string | null;
    start_row: number | null;
    end_row: number | null;
};

export type CallRow = {
    id: string;
    callType: string | null;
    via: string | null;
    file: string | null;
};

export type DependsOnRelationRow = {
    direction: "outgoing" | "incoming";
    id: string;
    file: string | null;
};

interface CallQueryOptions {
    includeInterfaceResolved?: boolean;
    limit?: number;
}

export function findNode(db: SQLiteDatabase, id: string): GraphNodeRow | undefined {
    return db.prepare(`
        SELECT id, parent, type, name, file, start_row, end_row
        FROM nodes
        WHERE id = ?
    `).get(id) as GraphNodeRow | undefined;
}

export function findIncomingCalls(
    db: SQLiteDatabase,
    id: string,
    options?: CallQueryOptions,
): CallRow[] {
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const limit = options?.limit ?? 20;

    const rows = db.prepare(`
        SELECT e.from_id, e.call_type, e.via, n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.from_id
        WHERE e.to_id = ?
          AND e.type = 'CALLS'
          AND (
              ? = 1
              OR e.call_type IS NULL
              OR e.call_type != 'INTERFACE_RESOLVED'
          )
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(id, includeInterfaceResolved ? 1 : 0, limit) as Array<{
        from_id: string;
        call_type: string | null;
        via: string | null;
        file: string | null;
    }>;

    return rows.map(row => ({
        id: row.from_id,
        callType: row.call_type,
        via: row.via,
        file: row.file,
    }));
}

export function findOutgoingCalls(
    db: SQLiteDatabase,
    id: string,
    options?: CallQueryOptions,
): CallRow[] {
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const limit = options?.limit ?? 20;

    const rows = db.prepare(`
        SELECT e.to_id, e.call_type, e.via, n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.to_id
        WHERE e.from_id = ?
          AND e.type = 'CALLS'
          AND (
              ? = 1
              OR e.call_type IS NULL
              OR e.call_type != 'INTERFACE_RESOLVED'
          )
        ORDER BY e.to_id ASC
        LIMIT ?
    `).all(id, includeInterfaceResolved ? 1 : 0, limit) as Array<{
        to_id: string;
        call_type: string | null;
        via: string | null;
        file: string | null;
    }>;

    return rows.map(row => ({
        id: row.to_id,
        callType: row.call_type,
        via: row.via,
        file: row.file,
    }));
}

export function findDependsOnRelations(
    db: SQLiteDatabase,
    classId: string,
    limit: number,
): DependsOnRelationRow[] {
    const outgoingRows = db.prepare(`
        SELECT e.to_id, n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.to_id
        WHERE e.from_id = ?
          AND e.type = 'DEPENDS_ON'
        ORDER BY e.to_id ASC
        LIMIT ?
    `).all(classId, limit) as Array<{ to_id: string; file: string | null }>;

    const incomingRows = db.prepare(`
        SELECT e.from_id, n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.from_id
        WHERE e.to_id = ?
          AND e.type = 'DEPENDS_ON'
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(classId, limit) as Array<{ from_id: string; file: string | null }>;

    return [
        ...outgoingRows.map(row => ({ direction: "outgoing" as const, id: row.to_id, file: row.file })),
        ...incomingRows.map(row => ({ direction: "incoming" as const, id: row.from_id, file: row.file })),
    ];
}

export function findMethodsByParent(db: SQLiteDatabase, classId: string): string[] {
    const rows = db.prepare(`
        SELECT id
        FROM nodes
        WHERE type = 'method'
          AND parent = ?
        ORDER BY id ASC
    `).all(classId) as Array<{ id: string }>;

    return rows.map(row => row.id);
}

export function findInheritanceChain(db: SQLiteDatabase, classId: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = classId;

    while (current && !seen.has(current)) {
        seen.add(current);

        const parent = db.prepare(`
            SELECT to_id
            FROM edges
            WHERE from_id = ?
              AND type = 'EXTENDS'
            LIMIT 1
        `).get(current) as { to_id?: string } | undefined;

        if (!parent?.to_id) {
            break;
        }

        chain.push(parent.to_id);
        current = parent.to_id;
    }

    return chain;
}

export function resolveMethodThroughInheritance(db: SQLiteDatabase, methodId: string): string | null {
    const separator = methodId.lastIndexOf("::");
    if (separator === -1) {
        return null;
    }

    const classId = methodId.slice(0, separator);
    const methodName = methodId.slice(separator + 2);
    const seen = new Set<string>();
    let currentClass: string | null = classId;

    while (currentClass && !seen.has(currentClass)) {
        seen.add(currentClass);

        const candidate = `${currentClass}::${methodName}`;
        const methodNode = db.prepare(`
            SELECT id
            FROM nodes
            WHERE id = ?
              AND type = 'method'
            LIMIT 1
        `).get(candidate) as { id: string } | undefined;

        if (methodNode?.id) {
            return methodNode.id;
        }

        const parent = db.prepare(`
            SELECT to_id
            FROM edges
            WHERE from_id = ?
              AND type = 'EXTENDS'
            LIMIT 1
        `).get(currentClass) as { to_id?: string } | undefined;

        currentClass = parent?.to_id ?? null;
    }

    return null;
}

export function getRelationTargetId(node: Pick<GraphNodeRow, "type" | "parent" | "id">): string {
    if (node.type === "method") {
        return node.parent ?? node.id;
    }
    return node.id;
}

