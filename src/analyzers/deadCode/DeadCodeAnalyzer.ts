import Database from "better-sqlite3";

export interface DeadCodeItem {
    id: string;
    name: string;
    file: string | null;
    visibility: string | null;
    incomingCalls: number;
}

export interface DeadCodeResult {
    scannedMethods: number;
    deadMethods: number;
    items: DeadCodeItem[];
    debug?: DeadCodeDebugInfo;
}

export interface DeadCodeDebugInfo {
    methodId: string;
    found: boolean;
    skippedReason?: string;
    directIncomingCalls: number;
    resolvedIncomingCalls: number;
    interfaceIncomingCalls: number;
    inheritanceIncomingCalls: number;
    inheritanceDispatchIncomingCalls: number;
    effectiveIncomingCalls: number;
    consideredDead: boolean;
}

interface DeadCodeOptions {
    debugMethodId?: string;
    includeInterfaceResolved?: boolean;
    ignoreConstructors?: boolean;
    ignoreControllerActions?: boolean;
    ignoreMagicMethods?: boolean;
    ignoreTests?: boolean;
    ignoreInterfaceMethods?: boolean;
}

type SQLiteDatabase = InstanceType<typeof Database>;

export function findDeadCode(db: SQLiteDatabase, options?: DeadCodeOptions): DeadCodeResult {
    const debugMethodId = options?.debugMethodId;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const ignoreConstructors = options?.ignoreConstructors ?? true;
    const ignoreControllerActions = options?.ignoreControllerActions ?? true;
    const ignoreMagicMethods = options?.ignoreMagicMethods ?? true;
    const ignoreTests = options?.ignoreTests ?? true;
    const ignoreInterfaceMethods = options?.ignoreInterfaceMethods ?? true;

    const methods = db.prepare(`
        SELECT m.id, m.parent, m.name, m.file, m.visibility, p.type AS parent_type
        FROM nodes m
        LEFT JOIN nodes p ON p.id = m.parent
        WHERE m.type = 'method'
          AND m.visibility = 'public'
        ORDER BY m.id ASC
    `).all() as Array<{
        id: string;
        parent: string | null;
        name: string;
        file: string | null;
        visibility: string | null;
        parent_type: string | null;
    }>;

    const countIncomingCalls = db.prepare(`
        SELECT COUNT(*) AS count
        FROM edges
        WHERE type = 'CALLS'
          AND to_id = ?
    `);

    const countResolvedIncomingCalls = db.prepare(`
        SELECT COUNT(*) AS count
        FROM edges
        WHERE type = 'CALLS'
          AND call_type = 'INTERFACE_RESOLVED'
          AND to_id = ?
    `);

    const countInterfaceMethodIncomingCalls = db.prepare(`
        SELECT COUNT(*) AS count
        FROM edges calls
        JOIN edges impl
          ON impl.type = 'IMPLEMENTS'
         AND impl.from_id = ?
        WHERE calls.type = 'CALLS'
          AND calls.to_id = impl.to_id || '::' || ?
    `);

    const countInheritanceFamilyIncomingCalls = db.prepare(`
        WITH RECURSIVE family(id) AS (
            SELECT ?
            UNION
            SELECT e.to_id
            FROM edges e
            JOIN family f ON e.type = 'EXTENDS' AND e.from_id = f.id
            UNION
            SELECT e.from_id
            FROM edges e
            JOIN family f ON e.type = 'EXTENDS' AND e.to_id = f.id
        )
        SELECT COUNT(*) AS count
        FROM family f
        JOIN edges calls
          ON calls.type = 'CALLS'
         AND calls.to_id = f.id || '::' || ?
    `);

    const countInheritanceDispatchIncomingCalls = db.prepare(`
        WITH RECURSIVE family(id) AS (
            SELECT ?
            UNION
            SELECT e.to_id
            FROM edges e
            JOIN family f ON e.type = 'EXTENDS' AND e.from_id = f.id
            UNION
            SELECT e.from_id
            FROM edges e
            JOIN family f ON e.type = 'EXTENDS' AND e.to_id = f.id
        )
        SELECT COUNT(DISTINCT calls.id) AS count
        FROM edges calls
        WHERE calls.type = 'CALLS'
          AND calls.to_id LIKE '%::' || ?
          AND substr(calls.to_id, 1, instr(calls.to_id, '::') - 1) IN (SELECT id FROM family)
    `);

    const items: DeadCodeItem[] = [];
    let debug: DeadCodeDebugInfo | undefined;

    for (const method of methods) {
        const isDebugTarget = debugMethodId !== undefined && method.id === debugMethodId;

        const lowerMethodName = method.name.toLowerCase();

        if (ignoreConstructors && method.name === "__construct") {
            if (isDebugTarget) {
                debug = {
                    methodId: method.id,
                    found: true,
                    skippedReason: "constructor",
                    directIncomingCalls: 0,
                    resolvedIncomingCalls: 0,
                    interfaceIncomingCalls: 0,
                    inheritanceIncomingCalls: 0,
                    inheritanceDispatchIncomingCalls: 0,
                    effectiveIncomingCalls: 0,
                    consideredDead: false,
                };
            }
            continue;
        }

        if (ignoreMagicMethods && lowerMethodName.startsWith("__")) {
            if (isDebugTarget) {
                debug = {
                    methodId: method.id,
                    found: true,
                    skippedReason: "magic_method",
                    directIncomingCalls: 0,
                    resolvedIncomingCalls: 0,
                    interfaceIncomingCalls: 0,
                    inheritanceIncomingCalls: 0,
                    inheritanceDispatchIncomingCalls: 0,
                    effectiveIncomingCalls: 0,
                    consideredDead: false,
                };
            }
            continue;
        }

        const parentId = method.parent ?? "";
        const filePath = method.file ?? "";
        const lowerFilePath = filePath.toLowerCase();

        if (
            ignoreTests &&
            (lowerFilePath.includes("/test/") || lowerFilePath.includes("/tests/"))
        ) {
            if (isDebugTarget) {
                debug = {
                    methodId: method.id,
                    found: true,
                    skippedReason: "test_file",
                    directIncomingCalls: 0,
                    resolvedIncomingCalls: 0,
                    interfaceIncomingCalls: 0,
                    inheritanceIncomingCalls: 0,
                    inheritanceDispatchIncomingCalls: 0,
                    effectiveIncomingCalls: 0,
                    consideredDead: false,
                };
            }
            continue;
        }

        if (ignoreInterfaceMethods && method.parent_type === "interface") {
            if (isDebugTarget) {
                debug = {
                    methodId: method.id,
                    found: true,
                    skippedReason: "interface_method",
                    directIncomingCalls: 0,
                    resolvedIncomingCalls: 0,
                    interfaceIncomingCalls: 0,
                    inheritanceIncomingCalls: 0,
                    inheritanceDispatchIncomingCalls: 0,
                    effectiveIncomingCalls: 0,
                    consideredDead: false,
                };
            }
            continue;
        }

        const isLikelyController =
            parentId.includes("Controller") ||
            filePath.includes("/Controllers/") ||
            filePath.includes("/Controller/");

        const isControllerAction = ["index", "show", "store", "create", "edit", "update", "destroy", "handle"].includes(lowerMethodName);

        if (ignoreControllerActions && isLikelyController && isControllerAction) {
            if (isDebugTarget) {
                debug = {
                    methodId: method.id,
                    found: true,
                    skippedReason: "controller_action",
                    directIncomingCalls: 0,
                    resolvedIncomingCalls: 0,
                    interfaceIncomingCalls: 0,
                    inheritanceIncomingCalls: 0,
                    inheritanceDispatchIncomingCalls: 0,
                    effectiveIncomingCalls: 0,
                    consideredDead: false,
                };
            }
            continue;
        }

        const directIncomingRow = countIncomingCalls.get(method.id) as { count?: number } | undefined;
        const directIncomingCalls = Number(directIncomingRow?.count ?? 0);

        const resolvedIncomingCalls = includeInterfaceResolved
            ? Number((countResolvedIncomingCalls.get(method.id) as { count?: number } | undefined)?.count ?? 0)
            : 0;

        const interfaceIncomingRow = countInterfaceMethodIncomingCalls.get(parentId, method.name) as { count?: number } | undefined;
        const interfaceIncomingCalls = Number(interfaceIncomingRow?.count ?? 0);

        const inheritanceIncomingRow = countInheritanceFamilyIncomingCalls.get(parentId, method.name) as { count?: number } | undefined;
        const inheritanceIncomingCalls = Number(inheritanceIncomingRow?.count ?? 0);

        const inheritanceDispatchIncomingRow = countInheritanceDispatchIncomingCalls.get(parentId, method.name) as { count?: number } | undefined;
        const inheritanceDispatchIncomingCalls = Number(inheritanceDispatchIncomingRow?.count ?? 0);

        const effectiveIncomingCalls =
            directIncomingCalls +
            resolvedIncomingCalls +
            interfaceIncomingCalls +
            inheritanceIncomingCalls +
            inheritanceDispatchIncomingCalls;

        if (isDebugTarget) {
            debug = {
                methodId: method.id,
                found: true,
                directIncomingCalls,
                resolvedIncomingCalls,
                interfaceIncomingCalls,
                inheritanceIncomingCalls,
                inheritanceDispatchIncomingCalls,
                effectiveIncomingCalls,
                consideredDead: effectiveIncomingCalls === 0,
            };
        }

        if (effectiveIncomingCalls === 0) {
            items.push({
                id: method.id,
                name: method.name,
                file: method.file,
                visibility: method.visibility,
                incomingCalls: directIncomingCalls,
            });
        }
    }

    return {
        scannedMethods: methods.length,
        deadMethods: items.length,
        items,
        debug: debugMethodId
            ? (debug ?? {
                methodId: debugMethodId,
                found: false,
                directIncomingCalls: 0,
                resolvedIncomingCalls: 0,
                interfaceIncomingCalls: 0,
                inheritanceIncomingCalls: 0,
                inheritanceDispatchIncomingCalls: 0,
                effectiveIncomingCalls: 0,
                consideredDead: false,
            })
            : undefined,
    };
}

