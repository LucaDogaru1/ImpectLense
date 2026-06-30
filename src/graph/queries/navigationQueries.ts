import Database from "better-sqlite3";
import { GraphNodeRow } from "./GraphQueries";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface NavigationEdgeRow {
    type: string;
    from: string;
    to: string;
    via?: string | null;
}

export interface RouteEntryRow {
    endpointId: string;
    controllerMethod: string;
}

export interface HttpUpstreamRow {
    componentId: string;
    endpointId: string;
    controllerMethod: string | null;
}

function methodScopePrefix(methodId: string): string {
    return `${methodId}::`;
}

export interface BladeEntryRow {
    bladeViewId: string;
    controllerMethod: string;
}

export type GraphEntryKind = "call" | "route" | "blade" | "http_client";

export interface GraphEntryRow {
    kind: GraphEntryKind;
    from: string;
    to: string;
    file: string | null;
}

export function findIncomingBladeActions(
    db: SQLiteDatabase,
    methodId: string,
    limit: number,
): BladeEntryRow[] {
    const rows = db.prepare(`
        SELECT e.from_id AS blade_view_id, e.to_id AS controller_method
        FROM edges e
        WHERE e.type = 'BLADE_USES_ACTION'
          AND e.to_id = ?
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(methodId, limit) as Array<{ blade_view_id: string; controller_method: string }>;

    return rows.map(row => ({
        bladeViewId: row.blade_view_id,
        controllerMethod: row.controller_method,
    }));
}

export function findIncomingGraphEntries(
    db: SQLiteDatabase,
    methodId: string,
    options?: { includeInterfaceResolved?: boolean; limit?: number },
): GraphEntryRow[] {
    const limit = options?.limit ?? 20;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;

    const calls = findIncomingCallEntries(db, methodId, { includeInterfaceResolved, limit });

    const routes = findIncomingRoutes(db, methodId, limit);
    const blade = findIncomingBladeActions(db, methodId, limit);

    const entries: GraphEntryRow[] = [
        ...calls,
        ...routes.map(row => ({
            kind: "route" as const,
            from: row.endpointId,
            to: row.controllerMethod,
            file: null,
        })),
        ...blade.map(row => ({
            kind: "blade" as const,
            from: row.bladeViewId,
            to: row.controllerMethod,
            file: null,
        })),
    ];

    return entries.slice(0, limit);
}

/** Framework / vendor nodes that should not dominate navigation output. */
export function isFrameworkNoiseNodeId(nodeId: string): boolean {
    if (/^Illuminate\\/.test(nodeId) || /^Symfony\\/.test(nodeId) || /^Psr\\/.test(nodeId)) {
        return true;
    }

    if (/\\Request::(all|input|get|has|filled|validate|only|except|merge)\b/.test(nodeId)) {
        return true;
    }

    return false;
}

export function filterFrameworkNoise<T extends { id: string }>(items: T[]): T[] {
    return items.filter(item => !isFrameworkNoiseNodeId(item.id));
}

export function filterFieldIntakeEdges(edges: NavigationEdgeRow[]): NavigationEdgeRow[] {
    const assignsFromRequest = new Set(
        edges
            .filter(edge => edge.type === "ASSIGNS" && edge.from.startsWith("request_field:"))
            .map(edge => edge.from),
    );

    return edges.filter(edge => {
        if (edge.type !== "READS_FIELD") {
            return edge.type === "ASSIGNS";
        }

        return !assignsFromRequest.has(edge.to);
    });
}

export function filterFieldFlowEdges(edges: NavigationEdgeRow[]): NavigationEdgeRow[] {
    const argumentFlowKeys = new Set(
        edges
            .filter(edge => edge.type === "ARGUMENT_TO")
            .map(edge => `${edge.from}|${edge.via ?? ""}`),
    );

    return edges.filter(edge => {
        if (edge.type !== "FLOWS_TO") {
            return true;
        }

        return !argumentFlowKeys.has(`${edge.from}|${edge.via ?? ""}`);
    });
}

export function findRouteControllerMethod(
    db: SQLiteDatabase,
    endpointId: string,
): string | null {
    const row = db.prepare(`
        SELECT to_id
        FROM edges
        WHERE type = 'ROUTES_TO'
          AND from_id = ?
        LIMIT 1
    `).get(endpointId) as { to_id?: string } | undefined;

    return row?.to_id ?? null;
}

export function findHttpClientsForEndpoint(
    db: SQLiteDatabase,
    endpointId: string,
    limit: number,
): HttpUpstreamRow[] {
    const rows = db.prepare(`
        SELECT e.from_id AS component_id, e.to_id AS endpoint_id
        FROM edges e
        WHERE e.type = 'HTTP_REQUEST'
          AND e.to_id = ?
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(endpointId, limit) as Array<{ component_id: string; endpoint_id: string }>;

    return rows.map(row => ({
        componentId: row.component_id,
        endpointId: row.endpoint_id,
        controllerMethod: null,
    }));
}

function findIncomingCallEntries(
    db: SQLiteDatabase,
    methodId: string,
    options: { includeInterfaceResolved?: boolean; limit?: number },
): GraphEntryRow[] {
    const limit = options.limit ?? 20;
    const includeInterfaceResolved = options.includeInterfaceResolved ?? false;

    const calls = db.prepare(`
        SELECT e.from_id, n.file
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
    `).all(methodId, includeInterfaceResolved ? 1 : 0, limit) as Array<{ from_id: string; file: string | null }>;

    return calls.map(row => ({
        kind: "call" as const,
        from: row.from_id,
        to: methodId,
        file: row.file,
    }));
}

export function findRouteScopedGraphEntries(
    db: SQLiteDatabase,
    endpointId: string,
    controllerMethodId: string,
    options?: { includeInterfaceResolved?: boolean; limit?: number },
): GraphEntryRow[] {
    const limit = options?.limit ?? 20;

    const httpClients = db.prepare(`
        SELECT e.from_id, n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.from_id
        WHERE e.type = 'HTTP_REQUEST'
          AND e.to_id = ?
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(endpointId, limit) as Array<{ from_id: string; file: string | null }>;

    const entries: GraphEntryRow[] = [
        ...httpClients.map(row => ({
            kind: "http_client" as const,
            from: row.from_id,
            to: endpointId,
            file: row.file,
        })),
        ...findIncomingCallEntries(db, controllerMethodId, options ?? {}),
    ];

    return entries.slice(0, limit);
}

export function countGraphEntries(entries: GraphEntryRow[]): number {
    return entries.length;
}

export function hasGraphEntry(entries: GraphEntryRow[]): boolean {
    return entries.length > 0;
}

export function formatGraphEntryLabel(entry: GraphEntryRow): string {
    switch (entry.kind) {
        case "route":
            return `${shortNavigationLabel(entry.from)} [ROUTES_TO]`;
        case "blade":
            return `${shortNavigationLabel(entry.from)} [BLADE_USES_ACTION]`;
        case "call":
            return shortNavigationLabel(entry.from);
        case "http_client":
            return `${shortNavigationLabel(entry.from)} [HTTP_REQUEST]`;
    }
}

export function findIncomingRoutes(
    db: SQLiteDatabase,
    methodId: string,
    limit: number,
): RouteEntryRow[] {
    const rows = db.prepare(`
        SELECT e.from_id AS endpoint_id, e.to_id AS controller_method
        FROM edges e
        WHERE e.type = 'ROUTES_TO'
          AND e.to_id = ?
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(methodId, limit) as Array<{ endpoint_id: string; controller_method: string }>;

    return rows.map(row => ({
        endpointId: row.endpoint_id,
        controllerMethod: row.controller_method,
    }));
}

export function findHttpUpstream(
    db: SQLiteDatabase,
    methodId: string,
    limit: number,
): HttpUpstreamRow[] {
    const rows = db.prepare(`
        SELECT h.from_id AS component_id, h.to_id AS endpoint_id, r.to_id AS controller_method
        FROM edges h
        LEFT JOIN edges r ON r.from_id = h.to_id AND r.type = 'ROUTES_TO'
        WHERE h.type = 'HTTP_REQUEST'
          AND r.to_id = ?
        ORDER BY h.from_id ASC
        LIMIT ?
    `).all(methodId, limit) as Array<{
        component_id: string;
        endpoint_id: string;
        controller_method: string | null;
    }>;

    return rows.map(row => ({
        componentId: row.component_id,
        endpointId: row.endpoint_id,
        controllerMethod: row.controller_method,
    }));
}

export function findMethodScopedEdges(
    db: SQLiteDatabase,
    methodId: string,
    edgeTypes: string[],
    limit: number,
): NavigationEdgeRow[] {
    if (edgeTypes.length === 0) {
        return [];
    }

    const prefix = methodScopePrefix(methodId);
    const typePlaceholders = edgeTypes.map(() => "?").join(", ");

    const rows = db.prepare(`
        SELECT e.type, e.from_id, e.to_id, e.via
        FROM edges e
        WHERE e.type IN (${typePlaceholders})
          AND (
              e.from_id = ?
              OR e.to_id = ?
              OR e.from_id LIKE ? ESCAPE '\\'
              OR e.to_id LIKE ? ESCAPE '\\'
          )
        ORDER BY e.type ASC, e.from_id ASC, e.to_id ASC
        LIMIT ?
    `).all(
        ...edgeTypes,
        methodId,
        methodId,
        `${prefix.replace(/[%_\\]/g, "\\$&")}%`,
        `${prefix.replace(/[%_\\]/g, "\\$&")}%`,
        limit,
    ) as Array<{ type: string; from_id: string; to_id: string; via: string | null }>;

    return rows.map(row => ({
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        via: row.via,
    }));
}

export function findOutgoingEdgesByType(
    db: SQLiteDatabase,
    fromId: string,
    edgeTypes: string[],
    limit: number,
): NavigationEdgeRow[] {
    if (edgeTypes.length === 0) {
        return [];
    }

    const typePlaceholders = edgeTypes.map(() => "?").join(", ");
    const rows = db.prepare(`
        SELECT e.type, e.from_id, e.to_id, e.via
        FROM edges e
        WHERE e.from_id = ?
          AND e.type IN (${typePlaceholders})
        ORDER BY e.type ASC, e.to_id ASC
        LIMIT ?
    `).all(fromId, ...edgeTypes, limit) as Array<{
        type: string;
        from_id: string;
        to_id: string;
        via: string | null;
    }>;

    return rows.map(row => ({
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        via: row.via,
    }));
}

export function resolveInterfaceMethodImplementation(
    db: SQLiteDatabase,
    interfaceMethodId: string,
): string | null {
    const separator = interfaceMethodId.lastIndexOf("::");
    if (separator === -1) {
        return null;
    }

    const interfaceClassId = interfaceMethodId.slice(0, separator);
    const methodName = interfaceMethodId.slice(separator + 2);

    const implementors = db.prepare(`
        SELECT from_id
        FROM edges
        WHERE type = 'IMPLEMENTS'
          AND to_id = ?
        ORDER BY from_id ASC
    `).all(interfaceClassId) as Array<{ from_id: string }>;

    for (const { from_id: classId } of implementors) {
        const candidate = `${classId}::${methodName}`;
        const exists = db.prepare(`
            SELECT id FROM nodes WHERE id = ? AND type = 'method' LIMIT 1
        `).get(candidate) as { id: string } | undefined;

        if (exists) {
            return candidate;
        }
    }

    return null;
}

export function preferConcreteCallTargets<T extends { id: string }>(calls: T[]): T[] {
    const byMethod = new Map<string, T[]>();

    for (const call of calls) {
        const methodName = call.id.split("::").pop() ?? call.id;
        const bucket = byMethod.get(methodName) ?? [];
        bucket.push(call);
        byMethod.set(methodName, bucket);
    }

    const result: T[] = [];
    for (const group of byMethod.values()) {
        const concrete = group.find(item => !item.id.includes("Interface"));
        result.push(concrete ?? group[0]!);
    }

    return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function shortNavigationLabel(nodeId: string): string {
    if (nodeId.startsWith("api:")) {
        const parts = nodeId.split(":");
        return `${parts[1] ?? "HTTP"} ${parts.slice(2).join(":")}`;
    }
    if (nodeId.startsWith("request_field:")) {
        return `request:${nodeId.slice("request_field:".length)}`;
    }
    if (nodeId.startsWith("model_field:")) {
        const segments = nodeId.split(":");
        return `model:${segments[segments.length - 2]}::${segments[segments.length - 1]}`;
    }
    const tail = nodeId.split("\\").pop() ?? nodeId;
    return tail;
}

export function buildNavigationWarnings(input: {
    target: GraphNodeRow;
    routeEntries: RouteEntryRow[];
    bladeEntries: BladeEntryRow[];
    graphEntriesCount: number;
    callersCount: number;
    fieldAssignments: NavigationEdgeRow[];
    fieldFlowsOut: NavigationEdgeRow[];
    calleesCount: number;
}): string[] {
    const warnings: string[] = [];
    const lower = input.target.id.toLowerCase();
    const isController = lower.includes("controller");
    const hasEntry = input.graphEntriesCount > 0
        || input.callersCount > 0
        || input.routeEntries.length > 0
        || input.bladeEntries.length > 0;

    if (!hasEntry) {
        warnings.push("No CALLS, ROUTES_TO, or BLADE_USES_ACTION entry — symbol may be unreachable, externally invoked, or missing route extraction.");
    }

    if (isController && input.routeEntries.length === 0 && input.bladeEntries.length === 0) {
        warnings.push("No ROUTES_TO or BLADE_USES_ACTION edges — HTTP/view entry for this controller action is unknown in the graph.");
    }

    if (isController && input.fieldAssignments.length === 0) {
        warnings.push("No ASSIGNS/request_field edges — request field intake not traced for this action.");
    }

    if (input.calleesCount > 0 && input.fieldFlowsOut.length === 0 && input.fieldAssignments.length > 0) {
        warnings.push("No FLOWS_TO/ARGUMENT_TO into callees — DTO/field propagation to service calls may be incomplete.");
    }

    return warnings;
}

export function buildSuggestedNextSteps(input: {
    routeEntries: RouteEntryRow[];
    bladeEntries: BladeEntryRow[];
    callees: string[];
    fieldAssignments: NavigationEdgeRow[];
    fieldFlowsOut: NavigationEdgeRow[];
    persists: NavigationEdgeRow[];
}): string[] {
    const steps = new Set<string>();

    for (const route of input.routeEntries) {
        steps.add(shortNavigationLabel(route.endpointId));
    }

    for (const blade of input.bladeEntries) {
        steps.add(shortNavigationLabel(blade.bladeViewId));
    }

    for (const callee of input.callees) {
        steps.add(shortNavigationLabel(callee));
    }

    for (const edge of input.fieldAssignments) {
        steps.add(shortNavigationLabel(edge.from));
        steps.add(shortNavigationLabel(edge.to));
    }

    for (const edge of input.fieldFlowsOut) {
        steps.add(shortNavigationLabel(edge.to));
    }

    for (const edge of input.persists) {
        steps.add(shortNavigationLabel(edge.to));
    }

    return [...steps].slice(0, 12);
}
