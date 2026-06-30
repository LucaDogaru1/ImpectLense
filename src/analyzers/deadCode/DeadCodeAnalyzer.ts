import Database from "better-sqlite3";

export interface DeadCodeItem {
    id: string;
    name: string;
    file: string | null;
    visibility: string | null;
    incomingCalls: number;
    incomingRoutes: number;
    incomingBladeRefs: number;
    category: "dead_candidate" | "unrouted_controller_action";
    risk: "low" | "medium" | "high";
}

export interface DeadCodeResult {
    scannedMethods: number;
    deadMethods: number;
    items: DeadCodeItem[];
    debug?: {
        methodId: string;
        found: boolean;
        skippedReason?: string;
        directIncomingCalls: number;
        incomingRoutes: number;
        incomingBladeRefs: number;
        resolvedIncomingCalls: number;
        effectiveIncomingCalls: number;
        consideredDead: boolean;
    };
}

export interface DeadCodeOptions {
    includeInterfaceResolved?: boolean;
    includeRoutes?: boolean;
    includeBladeReferences?: boolean;
    ignoreConstructors?: boolean;
    ignoreControllerActions?: boolean;
    ignoreMagicMethods?: boolean;
    ignoreTests?: boolean;
    ignoreInterfaceMethods?: boolean;
    ignoreFrameworkMethods?: boolean;
    ignoreAccessors?: boolean;
    ignoreAbstractImplementations?: boolean;
    includeExtendsResolved?: boolean;
    debugMethodId?: string;
    ignoreBaseClasses?: boolean;
}

type SQLiteDatabase = InstanceType<typeof Database>;

function buildCountMap(rows: Array<{ to_id: string; count: number }>): Map<string, number> {
    const map = new Map<string, number>();

    for (const row of rows) {
        map.set(row.to_id, Number(row.count));
    }

    return map;
}

function isFrameworkMethod(parentId: string, filePath: string, methodName: string): boolean {
    const lowerFilePath = filePath.toLowerCase();
    const lowerMethodName = methodName.toLowerCase();

    if (
        (parentId.endsWith("Request") || lowerFilePath.includes("/requests/")) &&
        ["rules", "messages", "attributes", "authorize"].includes(lowerMethodName)
    ) {
        return true;
    }

    if (parentId.endsWith("ServiceProvider") && ["boot", "register"].includes(lowerMethodName)) {
        return true;
    }

    if (
        (parentId.endsWith("Command") ||
            parentId.endsWith("Job") ||
            parentId.endsWith("Listener") ||
            parentId.endsWith("Middleware") ||
            lowerFilePath.includes("/commands/") ||
            lowerFilePath.includes("/jobs/") ||
            lowerFilePath.includes("/listeners/") ||
            lowerFilePath.includes("/middleware/")) &&
        lowerMethodName === "handle"
    ) {
        return true;
    }

    return false;
}

function isAccessor(methodName: string): boolean {
    return /^(get|set|is|has)[A-Z]/.test(methodName);
}

function isEntityLikeFile(filePath: string): boolean {
    const lowerFilePath = filePath.toLowerCase();

    return (
        lowerFilePath.includes("/entity/") ||
        lowerFilePath.includes("/entities/") ||
        lowerFilePath.includes("/dto/") ||
        lowerFilePath.includes("/dtos/") ||
        lowerFilePath.includes("/model/") ||
        lowerFilePath.includes("/models/")
    );
}

function isLikelyBaseClass(parentId: string, filePath: string): boolean {
    const shortName = parentId.split("\\").pop() ?? parentId;

    if (/^(Base|Abstract)[A-Za-z0-9_]/.test(shortName) || /Base$/.test(shortName)) {
        return true;
    }

    const lowerFilePath = filePath.toLowerCase();

    return (
        lowerFilePath.includes("/base/") ||
        lowerFilePath.includes("/abstract/") ||
        /\/base[a-z0-9_]*\.php$/i.test(lowerFilePath)
    );
}

function loadAbstractMethodIds(db: SQLiteDatabase): Set<string> {
    const abstractMethodIds = new Set<string>();
    const rows = db.prepare(`
        SELECT id, raw_json
        FROM nodes
        WHERE type = 'method'
    `).all() as Array<{ id: string; raw_json: string }>;

    for (const row of rows) {
        try {
            const node = JSON.parse(row.raw_json) as { isAbstract?: boolean };

            if (node.isAbstract === true) {
                abstractMethodIds.add(row.id);
            }
        } catch {
            continue;
        }
    }

    return abstractMethodIds;
}

function buildExtendsParentMap(db: SQLiteDatabase): Map<string, string> {
    const extendsParentByClass = new Map<string, string>();
    const rows = db.prepare(`
        SELECT from_id, to_id
        FROM edges
        WHERE type = 'EXTENDS'
    `).all() as Array<{ from_id: string; to_id: string }>;

    for (const row of rows) {
        extendsParentByClass.set(row.from_id, row.to_id);
    }

    return extendsParentByClass;
}

function implementsAbstractMethod(
    classId: string,
    methodName: string,
    extendsParentByClass: Map<string, string>,
    abstractMethodIds: Set<string>
): boolean {
    let currentClassId: string | undefined = classId;

    while (currentClassId) {
        if (abstractMethodIds.has(`${currentClassId}::${methodName}`)) {
            return true;
        }

        currentClassId = extendsParentByClass.get(currentClassId);
    }

    return false;
}

export function findDeadCode(db: SQLiteDatabase, options?: DeadCodeOptions): DeadCodeResult {
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const includeRoutes = options?.includeRoutes ?? true;
    const includeBladeReferences = options?.includeBladeReferences ?? true;
    const ignoreConstructors = options?.ignoreConstructors ?? true;
    const ignoreControllerActions = options?.ignoreControllerActions ?? true;
    const ignoreMagicMethods = options?.ignoreMagicMethods ?? true;
    const ignoreTests = options?.ignoreTests ?? true;
    const ignoreInterfaceMethods = options?.ignoreInterfaceMethods ?? true;
    const ignoreFrameworkMethods = options?.ignoreFrameworkMethods ?? true;
    const ignoreAccessors = options?.ignoreAccessors ?? false;
    const ignoreAbstractImplementations = options?.ignoreAbstractImplementations ?? true;
    const includeExtendsResolved = options?.includeExtendsResolved ?? true;
    const debugMethodId = options?.debugMethodId;
    const ignoreBaseClasses = options?.ignoreBaseClasses ?? true;

    let debug: DeadCodeResult["debug"] = undefined;

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

    const directIncomingByMethod = buildCountMap(
        db.prepare(`
            SELECT to_id, COUNT(*) AS count
            FROM edges
            WHERE type = 'CALLS'
            GROUP BY to_id
        `).all() as Array<{ to_id: string; count: number }>
    );

    const incomingRoutesByMethod = includeRoutes
        ? buildCountMap(
            db.prepare(`
                SELECT to_id, COUNT(*) AS count
                FROM edges
                WHERE type = 'ROUTES_TO'
                GROUP BY to_id
            `).all() as Array<{ to_id: string; count: number }>
        )
        : new Map<string, number>();

    const incomingBladeRefsByMethod = includeBladeReferences
        ? buildCountMap(
            db.prepare(`
                SELECT to_id, COUNT(*) AS count
                FROM edges
                WHERE type IN ('BLADE_USES_ACTION', 'BLADE_REFERENCES_SYMBOL', 'BLADE_CALLS')
                GROUP BY to_id
            `).all() as Array<{ to_id: string; count: number }>
        )
        : new Map<string, number>();

    const abstractMethodIds = ignoreAbstractImplementations
        ? loadAbstractMethodIds(db)
        : new Set<string>();
    const extendsParentByClass = ignoreAbstractImplementations || includeExtendsResolved
        ? buildExtendsParentMap(db)
        : new Map<string, string>();

    const resolvedIncomingByMethod = includeInterfaceResolved
        ? buildCountMap(
            db.prepare(`
                SELECT to_id, COUNT(*) AS count
                FROM edges
                WHERE type = 'CALLS'
                  AND call_type = 'INTERFACE_RESOLVED'
                GROUP BY to_id
            `).all() as Array<{ to_id: string; count: number }>
        )
        : new Map<string, number>();

    const extendsResolvedIncomingByMethod = includeExtendsResolved
        ? buildCountMap(
            db.prepare(`
                SELECT to_id, COUNT(*) AS count
                FROM edges
                WHERE type = 'CALLS'
                  AND call_type IN ('EXTENDS_RESOLVED', 'OVERRIDE_RESOLVED')
                GROUP BY to_id
            `).all() as Array<{ to_id: string; count: number }>
        )
        : new Map<string, number>();

    const items: DeadCodeItem[] = [];

    for (const method of methods) {
        const parentId = method.parent ?? "";
        const isDebugTarget = debugMethodId === method.id;
        const filePath = method.file ?? "";
        const lowerFilePath = filePath.toLowerCase();
        const lowerMethodName = method.name.toLowerCase();

        const directIncomingCalls = directIncomingByMethod.get(method.id) ?? 0;
        const incomingRoutes = incomingRoutesByMethod.get(method.id) ?? 0;
        const incomingBladeRefs = incomingBladeRefsByMethod.get(method.id) ?? 0;
        const resolvedIncomingCalls = resolvedIncomingByMethod.get(method.id) ?? 0;
        const extendsResolvedIncomingCalls = extendsResolvedIncomingByMethod.get(method.id) ?? 0;
        const effectiveIncomingCalls =
            directIncomingCalls +
            incomingRoutes +
            incomingBladeRefs +
            resolvedIncomingCalls +
            extendsResolvedIncomingCalls;

        const setSkippedDebug = (skippedReason: string): void => {
            if (!isDebugTarget) {
                return;
            }

            debug = {
                methodId: method.id,
                found: true,
                skippedReason,
                directIncomingCalls,
                incomingRoutes,
                incomingBladeRefs,
                resolvedIncomingCalls,
                effectiveIncomingCalls,
                consideredDead: false,
            };
        };

        if (ignoreConstructors && method.name === "__construct") {
            setSkippedDebug("constructor");
            continue;
        }

        if (ignoreBaseClasses && isLikelyBaseClass(parentId, filePath)) {
            setSkippedDebug("base_class");
            continue;
        }

        if (ignoreMagicMethods && lowerMethodName.startsWith("__")) {
            setSkippedDebug("magic_method");
            continue;
        }

        if (
            ignoreTests &&
            (lowerFilePath.includes("/test/") || lowerFilePath.includes("/tests/"))
        ) {
            setSkippedDebug("test_file");
            continue;
        }

        if (ignoreInterfaceMethods && method.parent_type === "interface") {
            setSkippedDebug("interface_method");
            continue;
        }

        const isLikelyController =
            parentId.includes("Controller") ||
            filePath.includes("/Controllers/") ||
            filePath.includes("/Controller/");

        const isControllerAction = [
            "index",
            "show",
            "store",
            "create",
            "edit",
            "update",
            "destroy",
            "handle",
        ].includes(lowerMethodName);

        if (ignoreControllerActions && isLikelyController && isControllerAction) {
            setSkippedDebug("controller_action");
            continue;
        }

        if (
            ignoreFrameworkMethods &&
            isFrameworkMethod(parentId, filePath, method.name)
        ) {
            setSkippedDebug("framework_method");
            continue;
        }

        if (
            ignoreAccessors &&
            isAccessor(method.name) &&
            isEntityLikeFile(filePath)
        ) {
            setSkippedDebug("entity_accessor");
            continue;
        }

        if (
            ignoreAbstractImplementations &&
            parentId &&
            implementsAbstractMethod(
                parentId,
                method.name,
                extendsParentByClass,
                abstractMethodIds
            )
        ) {
            setSkippedDebug("abstract_implementation");
            continue;
        }

        if (isDebugTarget) {
            debug = {
                methodId: method.id,
                found: true,
                directIncomingCalls,
                incomingRoutes,
                incomingBladeRefs,
                resolvedIncomingCalls,
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
                incomingRoutes,
                incomingBladeRefs,
                category: isLikelyController ? "unrouted_controller_action" : "dead_candidate",
                risk: isLikelyController ? "medium" : "high",
            });
        }
    }

    return {
        scannedMethods: methods.length,
        deadMethods: items.length,
        items,
        debug: debugMethodId
            ? debug ?? {
                methodId: debugMethodId,
                found: false,
                directIncomingCalls: 0,
                incomingRoutes: 0,
                incomingBladeRefs: 0,
                resolvedIncomingCalls: 0,
                effectiveIncomingCalls: 0,
                consideredDead: false,
            }
            : undefined,
    };
}
