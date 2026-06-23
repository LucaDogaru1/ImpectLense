import Database from "better-sqlite3";
import { detectInfrastructureGaps } from "./ticketClaims";
import {
    getNodesOfTypes,
    loadTicketGraphContext,
    type TicketGraphContext,
} from "./ticketGraphContext";
import {
    calculateDominantWorkflow,
    isTicketTruncated,
    scoreWorkflows,
} from "./ticketWorkflow";
import {
    GraphScope,
    GraphScopeCoverage,
    StructuralCandidate,
    TicketProbeResult,
    TicketSessionResolved,
} from "./ticketSessionTypes";
import { buildTicketAnchorContext } from "./ticketAnchoring";

type SQLiteDatabase = InstanceType<typeof Database>;

interface DbNodeRow {
    id: string;
    type: string;
    name: string;
    file: string | null;
    parent: string | null;
}

function isApiConsumerNode(row: DbNodeRow): boolean {
    const haystack = `${row.id} ${row.parent ?? ""} ${row.file ?? ""}`.toLowerCase();
    return (
        haystack.includes("\\consumer\\") ||
        haystack.includes("/consumer/") ||
        /validateconsumerkey|apikeygenerator|consumerrepository/i.test(haystack)
    );
}

function extractFieldTerms(ticketText: string): string[] {
    const fields = new Set<string>();

    for (const match of ticketText.match(/\b(is[A-Z][a-zA-Z0-9_]+)\b/g) ?? []) {
        fields.add(match.toLowerCase());
    }

    for (const match of ticketText.match(/\b([a-z]+(?:Id|Date|Status|Type))\b/g) ?? []) {
        if (match.length >= 4) {
            fields.add(match.toLowerCase());
        }
    }

    return [...fields];
}

function extractIntentLike(ticketText: string): {
    actions: string[];
    entities: string[];
    fields: string[];
    statuses: string[];
    sources: string[];
} {
    const lower = ticketText.toLowerCase();
    const actions: string[] = [];
    const sources: string[] = [];
    const entities: string[] = [];
    const statuses: string[] = [];

    if (/import|feed|xml|csv|ingest/i.test(lower)) actions.push("import");
    if (/archive|archived/i.test(lower)) actions.push("archive");
    if (/sqs|queue|consumer|listener/i.test(lower)) sources.push("sqs");
    if (/api|endpoint|response|payload/i.test(lower)) sources.push("api");
    if (/cms|editor|display|screen/i.test(lower)) entities.push("cms");
    if (/recording|content|vod/i.test(lower)) entities.push("recording");
    if (/delivered|deleted|archived/i.test(lower)) statuses.push("delivered");

    return {
        actions,
        entities,
        fields: extractFieldTerms(ticketText),
        statuses,
        sources,
    };
}

function tokenize(ticketText: string): string[] {
    return ticketText
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]+/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 3);
}

function inferGraphCoverage(
    rows: DbNodeRow[],
    edges: Array<{ from_id: string; to_id: string }>,
    requestedScopes: GraphScope[]
): GraphScopeCoverage[] {
    const phpNodes = rows.filter(row => !isLikelyJsNode(row)).length;

    const coverage: GraphScopeCoverage[] = [
        {
            scope: "php",
            nodeCount: phpNodes,
            edgeCount: edges.length,
            loaded: requestedScopes.includes("php") && phpNodes > 0,
        },
        {
            scope: "js",
            nodeCount: rows.filter(isLikelyJsNode).length,
            edgeCount: 0,
            loaded: requestedScopes.includes("js") && rows.some(isLikelyJsNode),
        },
    ];

    return coverage;
}

function isLikelyJsNode(row: DbNodeRow): boolean {
    const file = (row.file ?? "").replace(/\\/g, "/").toLowerCase();
    return /\.(tsx?|jsx?|vue|svelte)$/.test(file);
}

function findStructuralCandidates(
    graph: TicketGraphContext,
    workflowType: string,
    ticketText = ""
): StructuralCandidate[] {
    const candidates: StructuralCandidate[] = [];

    if (workflowType === "api" || workflowType === "mixed") {
        const anchorContext = buildTicketAnchorContext(ticketText, graph, 8);

        for (const target of anchorContext.anchoredTargets) {
            candidates.push({
                id: target.id,
                type: target.type,
                file: target.file,
                role: target.type === "api_endpoint" ? "route_anchor" : "symbol_anchor",
                reason: target.reason,
            });
        }

        if (candidates.length > 0) {
            return dedupeCandidates(candidates).slice(0, 8);
        }
    }

    if (workflowType === "queue") {
        for (const row of getNodesOfTypes(graph, ["integration_entrypoint"])) {
            if (row.name !== "sqs_consumer" && row.name !== "queue_listener" && row.name !== "queue_job") {
                continue;
            }
            if (isApiConsumerNode(row)) continue;

            candidates.push({
                id: row.id,
                type: row.type,
                file: row.file,
                role: row.name,
                reason: `Queue ${row.name} entrypoint`,
            });
        }
    }

    if (workflowType === "import") {
        for (const row of getNodesOfTypes(graph, ["integration_entrypoint"])) {
            if (row.name === "import_handler") {
                candidates.push({
                    id: row.id,
                    type: row.type,
                    file: row.file,
                    role: row.name,
                    reason: "Import/parser handler",
                });
            }
        }

        for (const row of getNodesOfTypes(graph, ["method"])) {
            if (/import|parser|transformer|feed|ingest/i.test(`${row.id} ${row.file ?? ""}`)) {
                candidates.push({
                    id: row.id,
                    type: row.type,
                    file: row.file,
                    role: "import_method",
                    reason: "Import-related method",
                });
            }
        }
    }

    if (workflowType === "api") {
        for (const row of getNodesOfTypes(graph, ["integration_entrypoint"])) {
            if (row.name === "api_controller") {
                candidates.push({
                    id: row.id,
                    type: row.type,
                    file: row.file,
                    role: row.name,
                    reason: "API controller entrypoint",
                });
            }
        }
    }

    return dedupeCandidates(candidates).slice(0, 8);
}

function dedupeCandidates(items: StructuralCandidate[]): StructuralCandidate[] {
    const seen = new Set<string>();
    const result: StructuralCandidate[] = [];

    for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
    }

    return result;
}

function autoResolveFromGraph(
    ticketText: string,
    _rows: DbNodeRow[],
    _dominantWorkflow: ReturnType<typeof calculateDominantWorkflow>,
    _structuralCandidates: StructuralCandidate[]
): Partial<TicketSessionResolved> {
    const resolved: Partial<TicketSessionResolved> = {
        scopes: ["php"],
    };

    const lower = ticketText.toLowerCase();
    const mentionsCms = /\bcms\b|editor|dashboard|screen|display in cms/i.test(lower);
    const mentionsFrontend = /\bfrontend\b|react|vue|component|ui\b/i.test(lower);
    const mentionsApi = /\bapi\b|endpoint|payload|response/i.test(lower);

    if (mentionsCms && mentionsApi) {
        resolved.surfaceScope = "full_stack";
    } else if (mentionsCms) {
        resolved.surfaceScope = "cms_ui";
    } else if (mentionsFrontend) {
        resolved.surfaceScope = "public_frontend";
    } else if (mentionsApi) {
        resolved.surfaceScope = "backend_api";
    } else {
        resolved.surfaceScope = "backend_only";
    }

    if (/\.tsx|\.jsx|\.vue|frontend\//i.test(lower) && resolved.scopes?.length === 1) {
        // Ticket hints at UI code but graph is php-only — surface scope stays, scopes unchanged until JS scan exists.
    }

    return resolved;
}

function computeReadiness(
    truncated: boolean,
    dominantWorkflow: ReturnType<typeof calculateDominantWorkflow>,
    structuralCandidates: StructuralCandidate[],
    resolved: Partial<TicketSessionResolved>,
    infrastructureGaps: string[]
): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    if (dominantWorkflow.confidence >= 0.75) {
        score += 0.35;
        reasons.push(`Workflow ${dominantWorkflow.type} confidence ${dominantWorkflow.confidence}`);
    } else if (dominantWorkflow.confidence >= 0.55) {
        score += 0.2;
        reasons.push(`Workflow ${dominantWorkflow.type} moderately confident`);
    } else {
        reasons.push("Workflow uncertain");
    }

    if (structuralCandidates.length > 0) {
        score += 0.25;
        reasons.push(`${structuralCandidates.length} structural candidate(s) in graph`);
    } else if (dominantWorkflow.type !== "unknown") {
        reasons.push("No structural entrypoint matched yet");
    }

    if (resolved.lockedWorkflow) score += 0.1;
    if (resolved.implementationMode) score += 0.15;
    if (resolved.surfaceScope) score += 0.05;

    if (truncated && !resolved.truncatedAcknowledged) {
        score -= 0.25;
        reasons.push("Ticket appears truncated");
    }

    const runnerUp = dominantWorkflow.secondary[0];
    if (
        runnerUp &&
        runnerUp.confidence >= 0.55 &&
        dominantWorkflow.confidence - runnerUp.confidence < 0.12 &&
        !resolved.lockedWorkflow
    ) {
        score -= 0.15;
        reasons.push(`Workflow ambiguity: ${dominantWorkflow.type} vs ${runnerUp.type}`);
    }

    if (
        dominantWorkflow.type === "queue" &&
        infrastructureGaps.some(gap => /no sqs consumer/i.test(gap)) &&
        !resolved.implementationMode
    ) {
        score -= 0.1;
        reasons.push("Queue infrastructure gap unresolved");
    }

    return {
        score: Math.max(0, Math.min(1, score)),
        reasons,
    };
}

export function probeTicket(
    db: SQLiteDatabase,
    ticketText: string,
    scopes: GraphScope[] = ["php"],
    graph?: TicketGraphContext
): TicketProbeResult {
    const ctx = graph ?? loadTicketGraphContext(db);
    const rows = ctx.nodes;
    const edges = ctx.edges;
    const tokens = tokenize(ticketText);
    const intent = extractIntentLike(ticketText);
    const workflowScores = scoreWorkflows(ticketText, tokens);
    const dominantWorkflow = calculateDominantWorkflow(workflowScores);
    const truncated = isTicketTruncated(ticketText);
    const structuralCandidates = findStructuralCandidates(ctx, dominantWorkflow.type, ticketText);
    const infrastructureGaps = detectInfrastructureGaps(rows, intent, ticketText, ctx);
    const graphCoverage = inferGraphCoverage(rows, edges, scopes);
    const autoResolved = autoResolveFromGraph(
        ticketText,
        rows,
        dominantWorkflow,
        structuralCandidates
    );

    const { score, reasons } = computeReadiness(
        truncated,
        dominantWorkflow,
        structuralCandidates,
        autoResolved,
        infrastructureGaps
    );

    return {
        dominantWorkflow,
        truncated,
        structuralCandidates,
        infrastructureGaps,
        fieldStatuses: [],
        graphCoverage,
        autoResolved,
        readinessScore: score,
        readinessReasons: reasons,
    };
}
