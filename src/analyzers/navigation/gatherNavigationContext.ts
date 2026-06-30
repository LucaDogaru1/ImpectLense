import Database from "better-sqlite3";
import { GraphNodeRow, findMethodsByParent } from "../../graph/queries/GraphQueries";
import {
    NavigationEdgeRow,
    RouteEntryRow,
    HttpUpstreamRow,
    BladeEntryRow,
    buildNavigationWarnings,
    buildSuggestedNextSteps,
    countGraphEntries,
    filterFieldIntakeEdges,
    filterFieldFlowEdges,
    findHttpClientsForEndpoint,
    findHttpUpstream,
    findIncomingBladeActions,
    findIncomingGraphEntries,
    findIncomingRoutes,
    findMethodScopedEdges,
    findOutgoingEdgesByType,
    findRouteScopedGraphEntries,
} from "../../graph/queries/navigationQueries";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface NavigationContext {
    routeEntries: RouteEntryRow[];
    bladeEntries: BladeEntryRow[];
    graphEntries: ReturnType<typeof findIncomingGraphEntries>;
    httpUpstream: HttpUpstreamRow[];
    fieldAssignments: NavigationEdgeRow[];
    fieldFlowsOut: NavigationEdgeRow[];
    validates: NavigationEdgeRow[];
    persists: NavigationEdgeRow[];
    configRefs: NavigationEdgeRow[];
    warnings: string[];
    suggestedNext: string[];
}

export interface GatherNavigationOptions {
    limit?: number;
    callersCount?: number;
    callees?: string[];
    includeInterfaceResolved?: boolean;
}

function gatherForMethod(
    db: SQLiteDatabase,
    methodId: string,
    limit: number,
    includeInterfaceResolved: boolean,
): Omit<NavigationContext, "warnings" | "suggestedNext"> {
    return {
        routeEntries: findIncomingRoutes(db, methodId, limit),
        bladeEntries: findIncomingBladeActions(db, methodId, limit),
        graphEntries: findIncomingGraphEntries(db, methodId, { limit, includeInterfaceResolved }),
        httpUpstream: findHttpUpstream(db, methodId, limit),
        fieldAssignments: filterFieldIntakeEdges(
            findMethodScopedEdges(db, methodId, ["ASSIGNS", "READS_FIELD"], limit),
        ),
        fieldFlowsOut: filterFieldFlowEdges(
            findMethodScopedEdges(db, methodId, ["FLOWS_TO", "ARGUMENT_TO"], limit),
        ),
        validates: findOutgoingEdgesByType(db, methodId, ["VALIDATES", "VALIDATES_FIELD"], limit),
        persists: findOutgoingEdgesByType(db, methodId, ["PERSISTS"], limit),
        configRefs: findOutgoingEdgesByType(db, methodId, ["REFERENCES"], limit),
    };
}

export function gatherNavigationContext(
    db: SQLiteDatabase,
    target: GraphNodeRow,
    options?: GatherNavigationOptions,
): NavigationContext {
    const limit = options?.limit ?? 20;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    let partial: Omit<NavigationContext, "warnings" | "suggestedNext">;

    if (target.type === "method") {
        partial = gatherForMethod(db, target.id, limit, includeInterfaceResolved);
    } else if (target.type === "class") {
        const methodIds = findMethodsByParent(db, target.id).slice(0, 8);
        partial = {
            routeEntries: [],
            bladeEntries: [],
            graphEntries: [],
            httpUpstream: [],
            fieldAssignments: [],
            fieldFlowsOut: [],
            validates: [],
            persists: [],
            configRefs: [],
        };

        for (const methodId of methodIds) {
            const methodNav = gatherForMethod(
                db,
                methodId,
                Math.max(5, Math.floor(limit / 2)),
                includeInterfaceResolved,
            );
            partial.routeEntries.push(...methodNav.routeEntries);
            partial.bladeEntries.push(...methodNav.bladeEntries);
            partial.graphEntries.push(...methodNav.graphEntries);
            partial.httpUpstream.push(...methodNav.httpUpstream);
            partial.fieldAssignments.push(...methodNav.fieldAssignments);
            partial.fieldFlowsOut.push(...methodNav.fieldFlowsOut);
            partial.validates.push(...methodNav.validates);
            partial.persists.push(...methodNav.persists);
            partial.configRefs.push(...methodNav.configRefs);
        }

        partial.routeEntries = dedupeRoutes(partial.routeEntries).slice(0, limit);
        partial.bladeEntries = dedupeBlade(partial.bladeEntries).slice(0, limit);
        partial.graphEntries = dedupeGraphEntries(partial.graphEntries).slice(0, limit);
        partial.fieldAssignments = dedupeEdges(partial.fieldAssignments).slice(0, limit);
        partial.fieldFlowsOut = dedupeEdges(partial.fieldFlowsOut).slice(0, limit);
        partial.validates = dedupeEdges(partial.validates).slice(0, limit);
        partial.persists = dedupeEdges(partial.persists).slice(0, limit);
        partial.configRefs = dedupeEdges(partial.configRefs).slice(0, limit);
    } else if (target.type === "api_endpoint") {
        const routeTarget = db.prepare(`
            SELECT to_id FROM edges WHERE type = 'ROUTES_TO' AND from_id = ? LIMIT 1
        `).get(target.id) as { to_id?: string } | undefined;

        partial = {
            routeEntries: routeTarget?.to_id
                ? [{ endpointId: target.id, controllerMethod: routeTarget.to_id }]
                : [],
            bladeEntries: [],
            graphEntries: routeTarget?.to_id
                ? findRouteScopedGraphEntries(db, target.id, routeTarget.to_id, {
                    limit,
                    includeInterfaceResolved,
                })
                : [],
            httpUpstream: findHttpClientsForEndpoint(db, target.id, limit),
            fieldAssignments: [],
            fieldFlowsOut: [],
            validates: [],
            persists: [],
            configRefs: [],
        };

        if (routeTarget?.to_id) {
            const methodNav = gatherForMethod(db, routeTarget.to_id, limit, includeInterfaceResolved);
            partial.fieldAssignments = methodNav.fieldAssignments;
            partial.fieldFlowsOut = methodNav.fieldFlowsOut;
            partial.validates = methodNav.validates;
            partial.persists = methodNav.persists;
            partial.configRefs = methodNav.configRefs;
        }
    } else {
        partial = {
            routeEntries: [],
            bladeEntries: [],
            graphEntries: [],
            httpUpstream: [],
            fieldAssignments: findOutgoingEdgesByType(db, target.id, ["ASSIGNS"], limit),
            fieldFlowsOut: filterFieldFlowEdges(
                findOutgoingEdgesByType(db, target.id, ["FLOWS_TO", "ARGUMENT_TO"], limit),
            ),
            validates: [],
            persists: [],
            configRefs: [],
        };
        partial.fieldAssignments = filterFieldIntakeEdges(partial.fieldAssignments);
    }

    const warnings = buildNavigationWarnings({
        target,
        routeEntries: partial.routeEntries,
        bladeEntries: partial.bladeEntries,
        graphEntriesCount: countGraphEntries(partial.graphEntries),
        callersCount: options?.callersCount ?? 0,
        fieldAssignments: partial.fieldAssignments,
        fieldFlowsOut: partial.fieldFlowsOut,
        calleesCount: options?.callees?.length ?? 0,
    });

    const suggestedNext = buildSuggestedNextSteps({
        routeEntries: partial.routeEntries,
        bladeEntries: partial.bladeEntries,
        callees: options?.callees ?? [],
        fieldAssignments: partial.fieldAssignments,
        fieldFlowsOut: partial.fieldFlowsOut,
        persists: partial.persists,
    });

    return { ...partial, warnings, suggestedNext };
}

function dedupeEdges(edges: NavigationEdgeRow[]): NavigationEdgeRow[] {
    const seen = new Set<string>();
    const result: NavigationEdgeRow[] = [];
    for (const edge of edges) {
        const key = `${edge.type}|${edge.from}|${edge.to}|${edge.via ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(edge);
    }
    return result;
}

function dedupeRoutes(routes: RouteEntryRow[]): RouteEntryRow[] {
    const seen = new Set<string>();
    const result: RouteEntryRow[] = [];
    for (const route of routes) {
        const key = `${route.endpointId}|${route.controllerMethod}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(route);
    }
    return result;
}

function dedupeBlade(entries: BladeEntryRow[]): BladeEntryRow[] {
    const seen = new Set<string>();
    const result: BladeEntryRow[] = [];
    for (const entry of entries) {
        const key = `${entry.bladeViewId}|${entry.controllerMethod}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(entry);
    }
    return result;
}

function dedupeGraphEntries(
    entries: ReturnType<typeof findIncomingGraphEntries>,
): ReturnType<typeof findIncomingGraphEntries> {
    const seen = new Set<string>();
    const result: ReturnType<typeof findIncomingGraphEntries> = [];
    for (const entry of entries) {
        const key = `${entry.kind}|${entry.from}|${entry.to}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(entry);
    }
    return result;
}
