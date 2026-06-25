import Database from "better-sqlite3";
import {
    buildTicketClaims,
    TicketClaims,
} from "./ticketClaims";
import {
    getNodesOfTypes,
    loadTicketGraphContext,
    type TicketGraphContext,
} from "./ticketGraphContext";
import {
    applyFalsePositivePenalties,
    calculateDominantWorkflow,
    DominantWorkflow,
    isTicketTruncated,
    isWorkflowAlignedEntrypoint,
    scoreWorkflows,
    workflowAlignmentBoost,
} from "./ticketWorkflow";
import {
    applyGraphProximityBoost,
    buildTicketFlowPaths,
    type TicketFlowPath,
} from "./ticketFlowPaths";
import {
    applyWorkflowTargetRerank,
    buildRelatedSymbols,
    calculateEntrypointConfidence,
    calculateGraphCoverageConfidence,
} from "./ticketTargetRerank";
import {
    assessTicketDomainInformation,
    extractDistinctiveTicketTokens,
    LOW_INFORMATION_WARNINGS,
    pathSegmentTokenOverlap,
    ticketHasConcreteAnchors,
    type TicketDomainAssessment,
} from "./ticketTextTokens";
import {
    buildTicketAnchorContext,
    genericBaseConfigPenalty,
    prependAnchoredTargets,
    type TicketAnchorContext,
} from "./ticketAnchoring";
import { extractFieldAnchorTerms } from "./ticketFieldAnchoring";
import { isGenericBaseConfigWithoutAnchor, scoreSymbolAnchorMatch } from "./ticketSymbolAnchors";
import {
    applyRankingHintsToInvestigationTargets,
    applyRankingHintsToMatches,
    hasRankingHints,
    type TicketRankingHints,
} from "./ticketRankingHints";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface TicketAnalyzerOptions {
    limit?: number;
    includeDebug?: boolean;
    graph?: TicketGraphContext;
    rankingHints?: TicketRankingHints;
}

export interface TicketAnalyzerResult {
    query: string;
    tokens: string[];
    fieldTerms: string[];
    missingFieldTerms: string[];
    intent: TicketIntent;
    workflow: DominantWorkflow;
    matchedEndpoints: TicketMatchedNode[];
    matchedMethods: TicketMatchedNode[];
    matchedRequestFields: TicketMatchedNode[];
    matchedFrontend: TicketMatchedNode[];
    relatedFlows: TicketFlow[];
    flowRoles: TicketFlowRole[];
    flowPaths: TicketFlowPath[];
    suggestedFiles: TicketFileHit[];
    confidence: number;
    navigationConfidence: number;
    implementationConfidence: number;
    entrypointConfidence: number;
    graphCoverageConfidence: number;
    relatedSymbols: Array<{ id: string; file: string | null; reason: string }>;
    claims: TicketClaims;
    investigationTargets: TicketMatchedNode[];
    anchorContext?: TicketAnchorContext;
    rankingHints?: TicketRankingHints;
    implementationHints: string[];
    debug?: TicketAnalyzerDebug;
    /** Ticket text lacked domain terms — graph ranking was skipped. */
    lowInformation?: boolean;
}

export type TicketAction =
    | "create"
    | "update"
    | "delete"
    | "import"
    | "archive"
    | "playback"
    | "validate"
    | "sync"
    | "notify"
    | "unknown";

export interface TicketIntent {
    actions: TicketAction[];
    entities: string[];
    fields: string[];
    statuses: string[];
    sources: string[];
}

export interface TicketMatchedNode {
    id: string;
    type: string;
    name: string;
    file: string | null;
    score: number;
    reason: string;
}

export interface TicketFlow {
    from: string;
    to: string;
    type: string;
    via: string | null;
    argumentIndex: number | null;
    confidence: number | null;
    reason: string | null;
}

export interface TicketFlowRole {
    id: string;
    role: "ENTRYPOINT" | "ASYNC_ENTRYPOINT" | "IMPLEMENTATION" | "DEPENDENCY" | "RELATED";
    reason: string;
}

export interface TicketFileHit {
    file: string;
    score: number;
    reasons: string[];
}

export interface TicketAnalyzerDebug {
    endpointMatches: number;
    methodMatches: number;
    fieldMatches: number;
    flowEdges: number;
    tokenDocumentFrequency: Record<string, number>;
}

interface DbNodeRow {
    id: string;
    type: string;
    name: string;
    file: string | null;
    parent: string | null;
    description: string | null;
    keywords: string | null;
}

interface DbEdgeRow {
    from_id: string;
    to_id: string;
    type: string;
    via: string | null;
    argument_index: number | null;
    confidence: number | null;
    reason: string | null;
}

const STOP_WORDS = new Set([
    "der", "die", "das", "ein", "eine", "und", "oder", "mit", "bei", "von",
    "für", "im", "in", "am", "an", "zu", "auf", "ist", "sind", "nicht",
    "wird", "werden", "wenn", "dann", "beim", "vom", "zum", "zur",

    "the", "a", "an", "and", "or", "with", "for", "to", "from", "is", "are",
    "not", "as", "of", "on", "so", "that", "were", "be", "we", "our", "this",
    "they", "then", "all", "do", "no", "if", "via", "using", "based", "shall",
    "want", "need", "should", "must", "can", "will", "also",

    "summary", "details", "todo", "meeting", "notes", "requirement",
    "requirements", "acceptance", "criteria", "platform", "team",
]);

const NOISE_TOKENS = new Set([
    "ott",
    "available",
    "availalble",
    "currently",
    "during",
    "their",
    "more",
    "reliably",
    "each",
    "only",
    "when",
    "works",
    "still",
    "apply",
    "behavior",
    "new",
    "true",
    "false",
    "red",
    "bucket",
    "arn",
    "aws",
    "eu-central-1",
    "form",
    "once",
    "completed",
    "added",
    "called",
    "indicates",
    "after",
    "than",
    "longer",
    "older",
    "executed",
    "notification",
    "notifications",
    "sent",
    "minutes",
    "ago",
    "was",
    "keep",
    "remain",
    "indefinitely",
    "historical",
    "intact",
    "including",
]);

const LOW_VALUE_TOKENS = new Set([
    "content",
    "contents",
    "status",
    "file",
    "files",
    "path",
    "query",
    "get",
    "set",
    "type",
    "api",
    "event",
    "events",
    "data",
    "title",
    "show",
    "display",
    "displays",
    "add",
    "job",
    "page",
    "view",
    "item",
    "cms",
    "check",
    "flag",
    "url",
    "string",
    "example",
    "https",
    "accepts",
    "existing",
    "which",
    "used",
    "session",
    "user",
    "name",
    "names",
    "returns",
    "stored",
    "baseconfig",
    "baseconfigid",
    "authorization",
    "required",
    "update",
    "patch",
    "delete",
    "given",
    "when",
    "then",
    "feature",
    "scenario",
    "merge",
    "layer",
    "filters",
    "filter",
    "locale",
    "device",
    "category",
    "skeleton",
    "preview",
    "values",
    "forbidden",
    "subject",
    "permission",
    "permissions",
    "route",
    "routes",
    "jwt",
    "redis",
    "cache",
    "invalidation",
    "tests",
    "scribe",
    "operators",
    "deploy",
    "structure",
    "fragments",
    "object",
    "inventory",
    "overlay",
    "emergency",
    "hotfix",
]);

const ACTION_TOKENS = new Set([
    "import",
    "imported",
    "parse",
    "store",
    "persist",
    "mapping",
    "map",
    "overwrite",
    "edited",
    "manual",
    "manually",
    "missing",
    "external",
    "xml",
    "feed",
    "provider",
    "category",
    "categories",
    "detail",
    "tests",
    "test",
    "sync",
    "webhook",
    "queue",
    "message",
    "notify",
    "notification",
    "archive",
    "archived",
    "validate",
    "deleted",
    "delivered",
    "recording",
    "filepath",
    "playback",
    "contentids",
]);

function buildLowInformationTicketResult(
    ticketText: string,
    intent: TicketIntent,
    fieldTerms: string[],
    truncated: boolean,
    domainAssessment: TicketDomainAssessment,
    options?: TicketAnalyzerOptions
): TicketAnalyzerResult {
    const workflow: DominantWorkflow = {
        type: "unknown",
        confidence: 0,
        score: 0,
        reasons: ["unknown workflow with no structural ticket signals and insufficient strong tokens"],
        secondary: [],
    };

    const claims: TicketClaims = {
        fromTicket: [],
        codeHints: [],
        notFoundInGraph: [],
        doNotStartHere: [],
        fieldStatuses: [],
        infrastructureGaps: [],
        warnings: [...LOW_INFORMATION_WARNINGS],
    };

    return {
        query: ticketText,
        tokens: domainAssessment.meaningfulTokens,
        fieldTerms,
        missingFieldTerms: [],
        intent,
        workflow,
        matchedEndpoints: [],
        matchedMethods: [],
        matchedRequestFields: [],
        matchedFrontend: [],
        relatedFlows: [],
        flowRoles: [],
        flowPaths: [],
        suggestedFiles: [],
        confidence: 0,
        navigationConfidence: 0,
        implementationConfidence: 0,
        entrypointConfidence: 0,
        graphCoverageConfidence: 0,
        relatedSymbols: [],
        claims,
        investigationTargets: [],
        rankingHints: hasRankingHints(options?.rankingHints) ? options?.rankingHints : undefined,
        implementationHints: [],
        lowInformation: true,
        debug: options?.includeDebug
            ? {
                endpointMatches: 0,
                methodMatches: 0,
                fieldMatches: 0,
                flowEdges: 0,
                tokenDocumentFrequency: {},
            }
            : undefined,
    };
}

export function analyzeTicket(
    db: SQLiteDatabase,
    ticketText: string,
    options?: TicketAnalyzerOptions
): TicketAnalyzerResult {
    const limit = options?.limit ?? 20;
    const rankingHints = options?.rankingHints;
    const explicitBoostTerms = rankingHints?.boost ?? [];

    const fieldTerms = [
        ...new Set([...extractFieldLikeTerms(ticketText), ...extractFieldAnchorTerms(ticketText)]),
    ];
    const intent = extractTicketIntent(ticketText);
    const truncated = isTicketTruncated(ticketText);

    const preliminaryTokens = [...new Set([
        ...tokenize(ticketText),
        ...extractDistinctiveTicketTokens(ticketText),
        ...fieldTerms,
        ...intent.fields,
        ...intent.entities,
        ...intent.statuses,
        ...intent.sources,
        ...explicitBoostTerms,
    ])].filter(token =>
        explicitBoostTerms.includes(token) ||
        !NOISE_TOKENS.has(token.toLowerCase())
    );

    const preliminaryWorkflow = calculateDominantWorkflow(
        scoreWorkflows(ticketText, preliminaryTokens)
    );

    const domainAssessment = assessTicketDomainInformation({
        ticketText,
        workflowType: preliminaryWorkflow.type,
        boostTerms: explicitBoostTerms,
        entities: intent.entities,
        fields: intent.fields,
        fieldTerms,
        sources: intent.sources,
        actions: intent.actions,
        statuses: intent.statuses,
        strongMatchedTokens: strongMatchedTokens(preliminaryTokens),
    });

    if (domainAssessment.rejected) {
        return buildLowInformationTicketResult(
            ticketText,
            intent,
            fieldTerms,
            truncated,
            domainAssessment,
            options
        );
    }

    const tokens = preliminaryTokens;

    const graph = options?.graph ?? loadTicketGraphContext(db);
    const anchorContext = buildTicketAnchorContext(ticketText, graph, limit);
    const anchorSymbols = anchorContext.symbols;

    const tokensWithAnchors = [...new Set([
        ...tokens,
        ...anchorSymbols.filter(symbol => symbol.length >= 6),
        ...anchorContext.routes.flatMap(route => route.path.split("/").filter(segment => segment.length >= 4)),
    ])].filter(token =>
        explicitBoostTerms.includes(token) ||
        !NOISE_TOKENS.has(token.toLowerCase())
    );

    const workflowScores = scoreWorkflows(ticketText, tokensWithAnchors);
    const workflow = calculateDominantWorkflow(workflowScores);

    const allSearchableNodes = graph.nodes;
    const allNodes = graph.nodes;
    const allEdges = graph.edges;
    const tokenDocumentFrequency = buildTokenDocumentFrequency(
        allSearchableNodes,
        tokensWithAnchors,
        graph.haystackById
    );
    const missingFieldTerms = findMissingFieldTerms(graph.haystackById, fieldTerms);
    const queueInfrastructure = buildQueueInfrastructureContext(
        graph,
        allEdges,
        ticketText
    );
    const integrationLimit = workflow.type === "queue" ? limit * 4 : limit;

    const matchedEndpoints = findMatchingNodes(
        getNodesOfTypes(graph, ["api_endpoint"]),
        graph.haystackById,
        tokensWithAnchors,
        fieldTerms,
        intent,
        workflow,
        limit * 2,
        tokenDocumentFrequency,
        ticketText,
        undefined,
        anchorSymbols
    );

    const matchedMethods = findMatchingNodes(
        getNodesOfTypes(graph, ["method"]),
        graph.haystackById,
        tokensWithAnchors,
        fieldTerms,
        intent,
        workflow,
        limit * 2,
        tokenDocumentFrequency,
        ticketText,
        undefined,
        anchorSymbols
    );

    const matchedRequestFields = findMatchingNodes(
        getNodesOfTypes(graph, ["request_field", "validation_rule", "variable_field"]),
        graph.haystackById,
        tokensWithAnchors,
        fieldTerms,
        intent,
        workflow,
        limit * 2,
        tokenDocumentFrequency,
        ticketText,
        undefined,
        anchorSymbols
    );

    const matchedIntegrations = findMatchingNodes(
        getNodesOfTypes(graph, ["integration_entrypoint", "config_literal", "model_field", "response_field"]),
        graph.haystackById,
        tokensWithAnchors,
        fieldTerms,
        intent,
        workflow,
        integrationLimit,
        tokenDocumentFrequency,
        ticketText,
        queueInfrastructure,
        anchorSymbols
    );

    const matchedFrontend = findMatchingNodes(
        getNodesOfTypes(graph, ["vue_component", "vue_prop"]),
        graph.haystackById,
        tokensWithAnchors,
        fieldTerms,
        intent,
        workflow,
        limit * 2,
        tokenDocumentFrequency,
        ticketText,
        undefined,
        anchorSymbols
    );

    const proximitySeeds = buildProximitySeedIds(
        tokensWithAnchors,
        matchedEndpoints,
        matchedMethods,
        matchedFrontend,
        workflow
    );

    const boostedEndpoints = applyGraphProximityBoost(matchedEndpoints, proximitySeeds, allEdges);
    const boostedMethods = applyGraphProximityBoost(matchedMethods, proximitySeeds, allEdges);
    const boostedRequestFields = applyGraphProximityBoost(matchedRequestFields, proximitySeeds, allEdges);
    const boostedFrontend = applyGraphProximityBoost(matchedFrontend, proximitySeeds, allEdges);

    const seedNodeIds = [
        ...boostedEndpoints.map(item => item.id),
        ...boostedMethods.map(item => item.id),
        ...boostedRequestFields.map(item => item.id),
        ...matchedIntegrations.map(item => item.id),
        ...boostedFrontend.map(item => item.id),
    ];

    const relatedFlows = filterRelevantFlows(
        findRelatedFlows(db, seedNodeIds, limit * 4),
        [
            ...matchedMethods,
            ...matchedEndpoints,
            ...matchedRequestFields,
        ].map(item => item.id)
    );

    const rerankedEndpoints = dedupeMatchedNodes([
        ...anchorContext.anchoredTargets.filter(item => item.type === "api_endpoint"),
        ...rerankMatchesWithFlows(boostedEndpoints, relatedFlows),
    ]).slice(0, limit);

    const rerankedMethods =
        rerankMatchesWithFlows(boostedMethods, relatedFlows).slice(0, limit);

    const rerankedRequestFields =
        rerankMatchesWithFlows(boostedRequestFields, relatedFlows).slice(0, limit);

    const rerankedIntegrations =
        rerankMatchesWithFlows(matchedIntegrations, relatedFlows).slice(0, limit);

    const rerankedFrontend =
        rerankMatchesWithFlows(boostedFrontend, relatedFlows).slice(0, limit);

    const excludedTargets = buildExcludedTargets(
        [...matchedMethods, ...matchedEndpoints, ...matchedRequestFields, ...rerankedIntegrations],
        workflow.type,
        ticketText
    );

    const investigationTargets = applyRankingHintsToInvestigationTargets(
        prependAnchoredTargets(
            applyWorkflowTargetRerank(
                buildInvestigationTargets(
                    mergeInvestigationCandidates(
                        workflow.type,
                        rerankedMethods,
                        rerankedIntegrations,
                        rerankedFrontend,
                        ticketText,
                        anchorSymbols
                    ),
                    rerankedRequestFields,
                    rerankedEndpoints,
                    excludedTargets,
                    limit,
                    workflow.type
                ),
                workflow,
                ticketText,
                fieldTerms
            ),
            anchorContext.anchoredTargets,
            limit * 2
        ),
        graph,
        rankingHints,
        limit * 2
    );

    const rerankedEndpointsWithHints = hasRankingHints(rankingHints)
        ? applyRankingHintsToMatches(rerankedEndpoints, rankingHints)
        : rerankedEndpoints;
    const rerankedMethodsWithHints = hasRankingHints(rankingHints)
        ? applyRankingHintsToMatches(rerankedMethods, rankingHints)
        : rerankedMethods;
    const rerankedFrontendWithHints = hasRankingHints(rankingHints)
        ? applyRankingHintsToMatches(rerankedFrontend, rankingHints)
        : rerankedFrontend;

    const allMatches = [
        ...rerankedEndpointsWithHints,
        ...rerankedMethodsWithHints,
        ...rerankedRequestFields,
        ...rerankedFrontendWithHints,
    ];

    const flowPaths = buildTicketFlowPaths(
        [...investigationTargets, ...rerankedFrontendWithHints, ...rerankedEndpointsWithHints],
        allEdges
    );

    const flowRoles = buildFlowRoles(allMatches, relatedFlows, workflow.type);

    const suggestedFiles = buildSuggestedFiles(allMatches);

    const claims = buildTicketClaims({
        ticketText,
        intent,
        workflow,
        rows: allNodes,
        edges: allEdges,
        investigationTargets: investigationTargets.map(item => ({
            id: item.id,
            file: item.file,
            score: item.score,
            reason: item.reason,
        })),
        excludedTargets,
        truncated,
        indexes: graph,
    });

    const navigationConfidence = calculateNavigationConfidence(
        rerankedEndpoints,
        rerankedMethods,
        rerankedRequestFields,
        relatedFlows,
        workflow
    );

    const entrypointConfidence = calculateEntrypointConfidence(investigationTargets, workflow);
    const graphCoverageConfidence = calculateGraphCoverageConfidence(claims.fieldStatuses);

    const implementationConfidence = calculateImplementationConfidence(
        navigationConfidence,
        claims,
        workflow,
        truncated,
        rerankedMethods,
        entrypointConfidence,
        ticketText
    );

    const relatedSymbols = buildRelatedSymbols(
        investigationTargets.slice(0, 3).map(item => item.id),
        claims.fieldStatuses,
        allEdges,
        5
    );

    const implementationHints = buildImplementationHints(
        intent,
        workflow,
        claims,
        rerankedMethods,
        rerankedRequestFields,
        rerankedEndpoints,
        flowRoles,
        excludedTargets
    );

    if (anchorContext.netNewSymbols.length > 0) {
        implementationHints.push(
            `Net-new symbols not found in graph: ${anchorContext.netNewSymbols.slice(0, 5).join(", ")}`
        );
    }

    return {
        query: ticketText,
        tokens: tokensWithAnchors,
        fieldTerms,
        missingFieldTerms,
        intent,
        workflow,
        matchedEndpoints: rerankedEndpoints,
        matchedMethods: rerankedMethods,
        matchedRequestFields: rerankedRequestFields,
        matchedFrontend: rerankedFrontend,
        relatedFlows,
        flowRoles,
        flowPaths,
        suggestedFiles,
        confidence: navigationConfidence,
        navigationConfidence,
        implementationConfidence,
        entrypointConfidence,
        graphCoverageConfidence,
        relatedSymbols,
        claims,
        investigationTargets,
        anchorContext,
        rankingHints: hasRankingHints(rankingHints) ? rankingHints : undefined,
        implementationHints,
        debug: options?.includeDebug
            ? {
                endpointMatches: rerankedEndpoints.length,
                methodMatches: rerankedMethods.length,
                fieldMatches: rerankedRequestFields.length,
                flowEdges: relatedFlows.length,
                tokenDocumentFrequency: Object.fromEntries(tokenDocumentFrequency.entries()),
            }
            : undefined,
    };
}

function mergeInvestigationCandidates(
    workflowType: DominantWorkflow["type"],
    methods: TicketMatchedNode[],
    integrations: TicketMatchedNode[],
    frontend: TicketMatchedNode[] = [],
    ticketText = "",
    anchorSymbols: string[] = []
): TicketMatchedNode[] {
    if (workflowType === "queue") {
        const integrationEntrypoints = pickBestIntegrationPerClass(
            integrations.filter(item =>
                item.type === "integration_entrypoint" &&
                (item.name === "sqs_consumer" || item.name === "queue_listener")
            )
        );

        const queueJobs = pickBestIntegrationPerClass(
            integrations.filter(item =>
                item.type === "integration_entrypoint" &&
                item.name === "queue_job" &&
                /expired|archive|vod|sqs/i.test(item.id)
            )
        );

        const queueConfigLiterals = integrations.filter(item =>
            item.type === "config_literal" &&
            /^config_key:/i.test(item.id)
        );

        const archiveMethods = methods.filter(item =>
            /expiredvod|archiverecording|archivecontent|archivecontentpath/i.test(item.id.toLowerCase())
        );

        const handleMethods: TicketMatchedNode[] = [];
        for (const integration of integrationEntrypoints) {
            const classId = integration.id.split(":")[1];
            if (!classId) continue;

            const handle = methods.find(item => item.id === `${classId}::handle`);
            if (handle) {
                handleMethods.push(handle);
            }
        }

        for (const job of queueJobs) {
            const classId = job.id.split(":")[1];
            if (!classId) continue;

            const handle = methods.find(item => item.id === `${classId}::handle`);
            if (handle) {
                handleMethods.push(handle);
            }
        }

        return dedupeMatchedNodes([
            ...integrationEntrypoints,
            ...queueJobs,
            ...queueConfigLiterals,
            ...archiveMethods,
            ...handleMethods,
            ...methods,
        ]);
    }

    if (workflowType === "import") {
        const ticketLower = ticketText.toLowerCase();
        const cmsUiImport = /\b(cms|detail page|display in|show in the cms|detail view)\b/i.test(ticketLower);

        const importHandlers = integrations.filter(item =>
            item.type === "integration_entrypoint" && item.name === "import_handler"
        );

        const pipelineMethods = methods.filter(item => {
            const haystack = `${item.id} ${item.file ?? ""}`.toLowerCase();
            const looksLikePipeline = /import|parser|feed|externalmatch|transform|xml|providercategory/i.test(haystack);
            const looksLikeCmsImportUi = /\/views\/.*\/import/i.test(haystack);
            return looksLikePipeline && (!looksLikeCmsImportUi || cmsUiImport);
        });

        const cmsImportViews = frontend.filter(item =>
            /\/views\/.*\/import/i.test(`${item.id} ${item.file ?? ""}`)
        );

        if (cmsUiImport) {
            return dedupeMatchedNodes([...importHandlers, ...pipelineMethods, ...cmsImportViews, ...methods]);
        }

        return dedupeMatchedNodes([...importHandlers, ...pipelineMethods, ...methods]);
    }

    if (workflowType === "ui") {
        const vueComponents = frontend.filter(item => item.type === "vue_component");
        return dedupeMatchedNodes([...vueComponents, ...methods, ...frontend]);
    }

    if (workflowType === "api") {
        const filteredMethods = methods.filter(item =>
            !isGenericBaseConfigWithoutAnchor(item.id, item.file, anchorSymbols)
        );

        const domainMethods = filteredMethods.filter(item =>
            /controller|service|resource|request|resolver|provider/i.test(`${item.id} ${item.file ?? ""}`)
        );

        const filteredFrontend = frontend.filter(item =>
            scoreSymbolAnchorMatch(item.id, item.file, anchorSymbols) > 0
        );

        return dedupeMatchedNodes([...domainMethods, ...filteredMethods, ...filteredFrontend]);
    }

    return methods;
}

function buildProximitySeedIds(
    tokens: string[],
    endpoints: TicketMatchedNode[],
    methods: TicketMatchedNode[],
    frontend: TicketMatchedNode[],
    workflow: DominantWorkflow
): Set<string> {
    const seeds = new Set<string>();
    const entityTokens = entityMatchedTokens(tokens).map(token => token.toLowerCase());

    for (const match of [...endpoints, ...methods, ...frontend]) {
        const lowerId = match.id.toLowerCase();
        const lowerFile = (match.file ?? "").toLowerCase();

        if (entityTokens.some(token => lowerId.includes(token) || lowerFile.includes(token))) {
            seeds.add(match.id);
        }
    }

    if (workflow.type === "ui") {
        for (const match of frontend.filter(item => item.type === "vue_component").slice(0, 6)) {
            seeds.add(match.id);
        }
    }

    return seeds;
}

function dedupeMatchedNodes(items: TicketMatchedNode[]): TicketMatchedNode[] {
    const seen = new Set<string>();
    const result: TicketMatchedNode[] = [];

    for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
    }

    return result;
}

const INTEGRATION_ROLE_PRIORITY: Record<string, number> = {
    sqs_consumer: 3,
    queue_listener: 2,
    queue_job: 1,
    artisan_command: 0,
};

function pickBestIntegrationPerClass(items: TicketMatchedNode[]): TicketMatchedNode[] {
    const byClass = new Map<string, TicketMatchedNode>();

    for (const item of items) {
        if (!item.id.startsWith("integration:")) {
            continue;
        }

        const classId = item.id.split(":")[1];
        if (!classId) {
            continue;
        }

        const existing = byClass.get(classId);
        const itemPriority = INTEGRATION_ROLE_PRIORITY[item.name] ?? 0;
        const existingPriority = existing
            ? INTEGRATION_ROLE_PRIORITY[existing.name] ?? 0
            : -1;

        if (!existing || itemPriority > existingPriority || item.score > existing.score) {
            byClass.set(classId, item);
        }
    }

    return [...byClass.values()];
}

function buildInvestigationTargets(
    methods: TicketMatchedNode[],
    fields: TicketMatchedNode[],
    endpoints: TicketMatchedNode[],
    excludedTargets: Array<{ id: string; reason: string }>,
    limit: number,
    workflowType: DominantWorkflow["type"] = "unknown"
): TicketMatchedNode[] {
    const excludedIds = new Set(excludedTargets.map(item => item.id));

    return [...methods, ...fields, ...endpoints]
        .filter(item => !excludedIds.has(item.id))
        .filter(item => !isPenalizedMatch(item))
        .filter(item => !isJunkMatchedNode(item))
        .filter(item => !shouldDeprioritizeInvestigationTarget(item, workflowType))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function shouldDeprioritizeInvestigationTarget(
    item: TicketMatchedNode,
    workflowType: DominantWorkflow["type"]
): boolean {
    if (workflowType !== "queue" || item.type !== "config_literal") {
        return false;
    }

    if (/your-|example|placeholder|changeme/i.test(item.id)) {
        return true;
    }

    // Queue name literals are supporting evidence — start from listeners/jobs/services.
    return !/^config_key:/i.test(item.id);
}

function isPenalizedMatch(item: TicketMatchedNode): boolean {
    return /Penalty:/i.test(item.reason);
}

function isJunkMatchedNode(item: TicketMatchedNode): boolean {
    if (item.type === "parameter") {
        return true;
    }

    const lowerId = item.id.toLowerCase();
    const lowerFile = (item.file ?? "").toLowerCase();

    if (item.score < 80 && /\$[a-z]+$/i.test(item.id)) {
        return true;
    }

    if (item.type === "method" && isFrameworkPlumbingNode(lowerId, lowerFile)) {
        const tokenMatch = item.reason.match(/Matched token\(s\): ([^|]+)/i);
        const tokens = (tokenMatch?.[1] ?? "")
            .split(",")
            .map(token => token.trim().toLowerCase())
            .filter(Boolean);

        if (tokens.length <= 1 && tokens.every(token => AMBIGUOUS_SINGLE_MATCH_TOKENS.has(token))) {
            return true;
        }

        if (strongMatchedTokens(tokens).length === 0) {
            return true;
        }
    }

    if (
        item.type === "request_field" ||
        item.type === "variable_field" ||
        item.type === "validation_rule"
    ) {
        if (item.score < 100 && /Penalty:/i.test(item.reason)) {
            return true;
        }
    }

    if (/\$attributes$|\$request$|\$params$|\$id$/i.test(lowerId) && item.score < 120) {
        return true;
    }

    if (/^route::/i.test(lowerId) && item.score < 400) {
        return true;
    }

    return false;
}

function isFrameworkPlumbingNode(nodeId: string, file: string): boolean {
    return (
        /^(request|route|router)::/i.test(nodeId) ||
        /\/core\//i.test(file) ||
        /\\core\\/i.test(file)
    );
}

function buildExcludedTargets(
    matches: TicketMatchedNode[],
    workflowType: DominantWorkflow["type"],
    ticketText: string
): Array<{ id: string; reason: string }> {
    const excluded: Array<{ id: string; reason: string }> = [];

    for (const match of matches) {
        const { penalty, reasons } = applyFalsePositivePenalties(
            match.id,
            match.file,
            ticketText,
            workflowType
        );

        const looksLikeEntrypoint = looksLikeEntrypointCandidate(match);
        const workflowAligned = isWorkflowAlignedEntrypoint(
            match.id,
            match.file,
            workflowType
        );

        if (penalty >= 120) {
            excluded.push({
                id: match.id,
                reason: reasons[0] ?? "High false-positive penalty",
            });
            continue;
        }

        if (looksLikeEntrypoint && !workflowAligned) {
            excluded.push({
                id: match.id,
                reason: reasons[0] ?? "Matched tokens but not workflow-aligned entrypoint",
            });
        }
    }

    return excluded
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((item, index, array) => array.findIndex(other => other.id === item.id) === index);
}

function looksLikeEntrypointCandidate(match: TicketMatchedNode): boolean {
    const lower = `${match.id} ${match.file ?? ""}`.toLowerCase();

    return (
        lower.includes("/jobs/") ||
        lower.includes("\\jobs\\") ||
        lower.includes("controller") ||
        lower.includes("/commands/") ||
        lower.includes("\\commands\\") ||
        lower.includes("::handle")
    );
}

function filterRelevantFlows(flows: TicketFlow[], importantNodeIds: string[]): TicketFlow[] {
    const important = new Set(importantNodeIds);
    const noisePattern = /log::|illuminate\\|psr\\log|facade/i;

    return flows.filter(flow => {
        if (noisePattern.test(`${flow.from} ${flow.to}`)) {
            return false;
        }

        return important.has(flow.from) || important.has(flow.to);
    });
}
function shouldSuppressEndpoint(row: DbNodeRow, intent: TicketIntent, matchedTokens: string[]): boolean {
    if (row.type !== "api_endpoint") return false;

    const hasExternalEventSource =
        intent.sources.includes("sqs") ||
        intent.sources.includes("queue") ||
        intent.sources.includes("s3") ||
        intent.sources.includes("webhook");

    const hasOnlyWeakEndpointTokens = matchedTokens.every(token =>
        LOW_VALUE_TOKENS.has(token.toLowerCase()) ||
        token.toLowerCase() === "api" ||
        token.toLowerCase() === "check" ||
        token.toLowerCase() === "get" ||
        token.toLowerCase() === "set"
    );

    return hasExternalEventSource && hasOnlyWeakEndpointTokens;
}

function extractTicketIntent(input: string): TicketIntent {
    const lower = input.toLowerCase();

    const actions: TicketAction[] = [];

    if (/\b(add|create|insert|persist|store|save)\b/.test(lower)) actions.push("create");
    if (/\b(update|set|change|mark|become|overwrite|edit|edited)\b/.test(lower)) actions.push("update");
    if (/\b(delete|deleted|remove|expire|expired|cleanup)\b/.test(lower)) actions.push("delete");
    if (/\b(import|imported|feed|xml|csv|mapping|map|parse|parser)\b/.test(lower)) actions.push("import");
    if (/\b(archive|archived|isarchived|isarchive)\b/.test(lower)) actions.push("archive");
    if (/\b(playback|playable|access|accessible|availability|permission)\b/.test(lower)) actions.push("playback");
    if (/\b(validate|validation|required|missing|fallback)\b/.test(lower)) actions.push("validate");
    if (/\b(sync|synchronise|synchronize|webhook)\b/.test(lower)) actions.push("sync");
    if (/\b(notify|notification)\b/.test(lower)) actions.push("notify");

    return {
        actions: [...new Set(actions.length > 0 ? actions : ["unknown" as TicketAction])],
        entities: extractUppercaseTerms(input),
        fields: extractFieldLikeTerms(input),
        statuses: extractStatusLikeTerms(input),
        sources: extractSourceLikeTerms(input),
    };
}

function endpointPenalty(row: DbNodeRow, intent: TicketIntent): number {
    if (row.type !== "api_endpoint") return 0;

    const id = row.id.toLowerCase();

    let penalty = 0;

    if (
        id.includes("delete") &&
        !intent.sources.includes("api") &&
        (intent.sources.includes("sqs") || intent.sources.includes("queue") || intent.sources.includes("s3"))
    ) {
        penalty -= 180;
    }

    if (
        id.includes("delete") &&
        (intent.sources.includes("sqs") || intent.sources.includes("queue") || intent.sources.includes("s3"))
    ) {
        penalty -= 120;
    }

    return penalty;
}

function rerankMatchesWithFlows(
    matches: TicketMatchedNode[],
    flows: TicketFlow[]
): TicketMatchedNode[] {
    return matches
        .map(match => ({
            ...match,
            score: match.score + scoreGraphConnectivity(match.id, flows),
        }))
        .sort((a, b) => b.score - a.score);
}

function extractUppercaseTerms(input: string): string[] {
    return [...new Set(input.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])]
        .map(term => term.toLowerCase())
        .filter(term => !NOISE_TOKENS.has(term));
}

function extractStatusLikeTerms(input: string): string[] {
    const knownStatusWords = new Set([
        "draft",
        "published",
        "delivered",
        "archived",
        "deleted",
        "failed",
        "done",
        "pending",
        "active",
        "inactive",
        "enabled",
        "disabled",
        "ready",
        "processing",
        "completed",
        "cancelled",
        "canceled",
    ]);

    const candidates = [
        ...extractUppercaseTerms(input),
        ...tokenize(input),
    ];

    return [...new Set(
        candidates.filter(candidate => knownStatusWords.has(candidate.toLowerCase()))
    )];
}

const WEAK_STRONG_TOKENS = new Set([
    "after",
    "than",
    "executed",
    "notification",
    "playback",
    "database",
    "event",
    "queue",
    "job",
    "full",
    "returns",
    "stored",
    "existing",
    "contains",
    "multiple",
    "process",
]);

const AMBIGUOUS_SINGLE_MATCH_TOKENS = new Set([
    "full",
    "get",
    "set",
    "all",
    "find",
    "has",
    "was",
    "done",
    "like",
    "used",
    "post",
    "put",
    "path",
    "returns",
    "stored",
    "content",
    "contents",
    "url",
    "string",
    "example",
    "name",
    "accepts",
]);
function strongMatchedTokens(tokens: string[]): string[] {
    return tokens.filter(token => {
        const lower = token.toLowerCase();

        return (
            lower.length >= 4 &&
            !LOW_VALUE_TOKENS.has(lower) &&
            !NOISE_TOKENS.has(lower) &&
            !WEAK_STRONG_TOKENS.has(lower)
        );
    });
}

function isEntityToken(token: string): boolean {
    if (/^[A-Z][A-Za-z0-9]+$/.test(token)) {
        return true;
    }

    if (/^[a-z]+([A-Z][A-Za-z0-9]+)+$/.test(token)) {
        return true;
    }

    if (/^[a-z]+[a-z0-9]*(?:_[a-z0-9]+)+$/.test(token)) {
        return true;
    }

    return false;
}

function entityMatchedTokens(tokens: string[]): string[] {
    return tokens.filter(isEntityToken);
}
function extractSourceLikeTerms(input: string): string[] {
    const lower = input.toLowerCase();
    const result: string[] = [];

    const sourcePatterns: Array<[string, RegExp]> = [
        ["api", /\b(api endpoint|endpoint|route|controller|request|response)\b/],
        ["sqs", /\bsqs\b/],
        ["queue", /\bqueue\b/],
        ["webhook", /\bwebhook\b/],
        ["cron", /\bcron\b/],
        ["command", /\bcommand\b/],
        ["job", /\bjob\b/],
        ["xml", /\bxml\b/],
        ["csv", /\bcsv\b/],
        ["feed", /\bfeed\b/],
        ["cms", /\bcms\b/],
        ["s3", /\bs3\b/],
        ["database", /\b(database|db|sql|sqlite|mysql|postgres)\b/],
    ];

    for (const [source, pattern] of sourcePatterns) {
        if (pattern.test(lower)) result.push(source);
    }

    return [...new Set(result)];
}

function buildImplementationHints(
    intent: TicketIntent,
    workflow: DominantWorkflow,
    claims: TicketClaims,
    methods: TicketMatchedNode[],
    fields: TicketMatchedNode[],
    endpoints: TicketMatchedNode[],
    roles: TicketFlowRole[],
    excludedTargets: Array<{ id: string; reason: string }>,
): string[] {
    const hints: string[] = [];

    hints.push(`Primary workflow: ${workflow.type} (confidence ${workflow.confidence})`);

    if (claims.warnings.length > 0) {
        hints.push(...claims.warnings.map(warning => `Warning: ${warning}`));
    }

    if (claims.infrastructureGaps.length > 0) {
        hints.push(...claims.infrastructureGaps.map(gap => `Gap: ${gap}`));
    }

    for (const status of claims.fieldStatuses) {
        if (status.summary === "not found in graph") {
            hints.push(`Field '${status.field}' not found — add DTO, model, persistence and API serialization`);
        } else if (status.missingLayers.length > 0) {
            hints.push(`Field '${status.field}' partial match (${status.summary})`);
        } else if (layersAreRequestOnly(status)) {
            hints.push(`Field '${status.field}' appears in request/data-flow only — verify persistence and API output`);
        }
    }

    const excludedIds = new Set(excludedTargets.map(item => item.id));

    const asyncEntrypoint = roles.find(role =>
        role.role === "ASYNC_ENTRYPOINT" && !excludedIds.has(role.id)
    );

    const normalEntrypoint = roles.find(role =>
        role.role === "ENTRYPOINT" && !excludedIds.has(role.id)
    );

    const hasExternalEventSource =
        intent.sources.includes("sqs") ||
        intent.sources.includes("queue") ||
        intent.sources.includes("s3") ||
        intent.sources.includes("webhook");

    if (hasExternalEventSource && asyncEntrypoint && workflow.type === "queue") {
        hints.push(`Likely async entrypoint (verify): ${asyncEntrypoint.id}`);
    } else if (normalEntrypoint && workflow.type === "api") {
        hints.push(`Likely API entrypoint (verify): ${normalEntrypoint.id}`);
    } else if (asyncEntrypoint && workflow.type === "queue") {
        hints.push(`Possible async handler (verify): ${asyncEntrypoint.id}`);
    }

    const implementations = roles.filter(role =>
        role.role === "IMPLEMENTATION" && !excludedIds.has(role.id)
    );

    if (implementations.length > 0) {
        hints.push(`Check business logic: ${implementations.slice(0, 3).map(role => role.id).join(" | ")}`);
    }

    if (intent.actions.includes("import")) {
        const parser = methods.find(m =>
            !excludedIds.has(m.id) &&
            /parser|mapping|map|import|feed|xml|csv/i.test(`${m.id} ${m.file ?? ""}`)
        );

        if (parser) {
            hints.push(`Check parser/import mapping: ${parser.id}`);
        }
    }

    if (intent.actions.includes("sync") || intent.actions.includes("notify") || workflow.type === "queue") {
        const asyncFlow = methods.find(m =>
            !excludedIds.has(m.id) &&
            /archive|consumer|listener|queue|handler|command/i.test(`${m.id} ${m.file ?? ""}`)
        );

        if (asyncFlow) {
            hints.push(`Check async/integration flow: ${asyncFlow.id}`);
        }
    }

    if (excludedTargets.length > 0) {
        hints.push(`Avoid starting at: ${excludedTargets.slice(0, 3).map(item => item.id).join(" | ")}`);
    }

    const topInvestigationTargets = methods
        .filter(method => !excludedIds.has(method.id))
        .slice(0, 3)
        .map(method => method.id);

    if (topInvestigationTargets.length > 0) {
        hints.push(`Investigate first (unverified): ${topInvestigationTargets.join(" | ")}`);
    }

    if (fields.length > 0 || claims.fieldStatuses.length > 0) {
        hints.push("Add/update tests for parsing, persistence, API output and regression behavior");
    }

    return [...new Set(hints)];
}

function layersAreRequestOnly(status: TicketClaims["fieldStatuses"][number]): boolean {
    const hasRequestLike =
        (status.layers.request_input?.length ?? 0) > 0 ||
        (status.layers.data_flow?.length ?? 0) > 0;

    const hasPersistenceLike =
        (status.layers.persistence?.length ?? 0) > 0 ||
        (status.layers.model_property?.length ?? 0) > 0;

    return hasRequestLike && !hasPersistenceLike;
}

function buildTokenDocumentFrequency(
    rows: DbNodeRow[],
    tokens: string[],
    haystackById?: Map<string, string>
): Map<string, number> {
    const result = new Map<string, number>();
    const activeTokens = tokens.filter(token => !NOISE_TOKENS.has(token.toLowerCase()));

    for (const token of tokens) {
        result.set(token, 0);
    }

    for (const row of rows) {
        const haystack = haystackById?.get(row.id) ?? buildHaystack(row);

        for (const token of activeTokens) {
            if (haystackContainsToken(haystack, token.toLowerCase())) {
                result.set(token, (result.get(token) ?? 0) + 1);
            }
        }
    }

    return result;
}

function tokenWeight(
    token: string,
    documentFrequency: Map<string, number>
): number {
    const lower = token.toLowerCase();

    if (NOISE_TOKENS.has(lower)) return 0;

    const df = documentFrequency.get(token) ?? 0;

    if (df === 0) {
        if (isFieldLikeToken(token)) return 8;
        if (ACTION_TOKENS.has(lower)) return 4;
        return 0;
    }

    let weight: number;

    if (df <= 2) weight = 12;
    else if (df <= 5) weight = 9;
    else if (df <= 15) weight = 6;
    else if (df <= 50) weight = 4;
    else if (df <= 200) weight = 2;
    else if (df <= 1000) weight = 1;
    else weight = 0.1;

    if (isFieldLikeToken(token)) {
        weight = Math.max(weight, 10);
    }

    if (ACTION_TOKENS.has(lower)) {
        weight = Math.max(weight, 4);
    }

    if (LOW_VALUE_TOKENS.has(lower)) {
        weight = Math.min(weight, 0.1);
    }

    return weight;
}

function scoreContextQuality(row: DbNodeRow, matchedTokens: string[]): number {
    const text = `${row.id} ${row.file ?? ""}`.toLowerCase();

    let score = 0;

    const strongTokens = strongMatchedTokens(matchedTokens);

    if (strongTokens.length >= 2) score += 80;
    if (strongTokens.length >= 3) score += 120;

    if (/observer::deleted|observer::created|observer::updated/i.test(text)) {
        score -= 80;
    }

    if (/shared\/search|\\shared\\search|search\\.*query/i.test(text)) {
        score -= 90;
    }

    if (/pushwoosh|teaservideo|metadata|engagementpanel/i.test(text)) {
        score -= 70;
    }

    if (
        strongTokens.length < 2 &&
        /\b(move|files|deletefolder|unassigned)\b/i.test(text)
    ) {
        score -= 80;
    }

    return score;
}

interface QueueInfrastructureContext {
    ticketQueueNames: string[];
    linkedNodeIds: Set<string>;
    linkedClassIds: Set<string>;
}

function extractTicketQueueNames(ticketText: string): string[] {
    const names = new Set<string>();

    for (const arn of ticketText.match(/arn:aws:sqs:[^\s)]+/gi) ?? []) {
        const queueName = arn.split(":").pop();
        if (queueName) {
            names.add(queueName.toLowerCase());
        }
    }

    for (const token of ticketText.match(/\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/gi) ?? []) {
        if (
            !/^(eu|us|ap|sa|ca|me|af)-[a-z]+-\d+$/i.test(token) &&
            /expired|sqs|queue|vod/i.test(token)
        ) {
            names.add(token.toLowerCase());
        }
    }

    return [...names];
}

function buildQueueInfrastructureContext(
    graph: Pick<TicketGraphContext, "nodeById" | "nodesByType">,
    edges: Array<{ from_id: string; to_id: string; type: string }>,
    ticketText: string
): QueueInfrastructureContext {
    const ticketQueueNames = extractTicketQueueNames(ticketText);
    const linkedNodeIds = new Set<string>();
    const linkedClassIds = new Set<string>();

    if (ticketQueueNames.length === 0) {
        return { ticketQueueNames, linkedNodeIds, linkedClassIds };
    }

    const nodesById = graph.nodeById;
    const configLiterals = graph.nodesByType.get("config_literal") ?? [];
    const seedIds: string[] = [];

    for (const row of configLiterals) {
        const name = row.name.toLowerCase();
        const matchesTicketQueue = ticketQueueNames.some(
            queueName => name === queueName || name.includes(queueName) || queueName.includes(name)
        );

        if (matchesTicketQueue || (row.id.startsWith("config_key:") && /expired|vod|queue|sqs/i.test(name))) {
            seedIds.push(row.id);
        }
    }

    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
        if (edge.type !== "REFERENCES" && edge.type !== "HAS_ROLE" && edge.type !== "CALLS") {
            continue;
        }

        for (const [from, to] of [[edge.from_id, edge.to_id], [edge.to_id, edge.from_id]] as const) {
            const next = adjacency.get(from) ?? [];
            next.push(to);
            adjacency.set(from, next);
        }
    }

    const queue = [...seedIds];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const current = queue.pop()!;
        if (visited.has(current)) {
            continue;
        }

        visited.add(current);
        linkedNodeIds.add(current);

        const node = nodesById.get(current);
        if (node?.type === "class") {
            linkedClassIds.add(node.id);
        } else if (node?.parent) {
            linkedClassIds.add(node.parent);
        }

        if (current.startsWith("integration:")) {
            const classId = current.split(":")[1];
            if (classId) {
                linkedClassIds.add(classId);
            }
        }

        for (const next of adjacency.get(current) ?? []) {
            if (!visited.has(next)) {
                queue.push(next);
            }
        }
    }

    return { ticketQueueNames, linkedNodeIds, linkedClassIds };
}

function scoreQueueInfrastructureBoost(
    row: { id: string; type: string; name: string; file: string | null; parent: string | null },
    workflow: DominantWorkflow,
    context: QueueInfrastructureContext | undefined
): number {
    if (!context || workflow.type !== "queue") {
        return 0;
    }

    let boost = 0;
    const lower = `${row.id} ${row.name} ${row.file ?? ""}`.toLowerCase();

    if (row.type === "config_literal") {
        if (context.linkedNodeIds.has(row.id)) {
            boost += 60;
        }
        return boost;
    }

    if (context.linkedNodeIds.has(row.id)) {
        boost += 280;
    }

    const classId = row.type === "class"
        ? row.id
        : row.id.startsWith("integration:")
            ? row.id.split(":")[1]
            : row.parent;

    if (classId && context.linkedClassIds.has(classId)) {
        boost += 220;
    }

    if (
        row.type === "integration_entrypoint" &&
        /sqs_consumer|queue_listener|queue_job/.test(row.name) &&
        /expiredvod|expired_vod|expired-vod/i.test(lower)
    ) {
        boost += 260;
    }

    if (/expiredvod|expired_vod|expired-vod|archiverecording/i.test(lower)) {
        boost += 160;
    }

    for (const queueName of context.ticketQueueNames) {
        if (haystackContainsToken(lower, queueName)) {
            boost += 120;
        }
    }

    return boost;
}

function findMatchingNodes(
    candidateRows: DbNodeRow[],
    haystackById: Map<string, string>,
    tokens: string[],
    fieldTerms: string[],
    intent: TicketIntent,
    workflow: DominantWorkflow,
    limit: number,
    documentFrequency: Map<string, number>,
    ticketText: string,
    queueInfrastructure?: QueueInfrastructureContext,
    anchorSymbols: string[] = []
): TicketMatchedNode[] {
    if (tokens.length === 0) return [];

    const result: TicketMatchedNode[] = [];

    for (const row of candidateRows) {
        const haystack = haystackById.get(row.id) ?? buildHaystack(row);

        const matchedTokens = tokens.filter(token =>
            haystackContainsToken(haystack, token)
        );

        if (matchedTokens.length === 0) continue;

        if (shouldSuppressEndpoint(row, intent, matchedTokens)) {
            continue;
        }

        if (isJunkGraphNode(row, matchedTokens)) {
            continue;
        }

        const strongTokens = strongMatchedTokens(matchedTokens);

        if (row.type === "method" && strongTokens.length === 0) {
            continue;
        }

        if (row.type === "api_endpoint" && strongTokens.length === 0) {
            continue;
        }

        if (
            (row.type === "vue_component" || row.type === "vue_prop") &&
            matchedTokens.length === 0
        ) {
            continue;
        }

        const keywordScore = matchedTokens.reduce(
            (sum, token) => sum + tokenWeight(token, documentFrequency) * 10,
            0
        );

        const workflowBoost = workflowAlignmentBoost(row.id, row.file, workflow.type);
        const falsePositive = applyFalsePositivePenalties(
            row.id,
            row.file,
            ticketText,
            workflow.type
        );

        const score =
            keywordScore +
            scoreSpecialMatches(row, matchedTokens, documentFrequency) +
            scoreIntentMatches(row, intent) +
            scoreTokenCombination(row, matchedTokens, fieldTerms, intent) +
            endpointPenalty(row, intent) +
            scoreContextQuality(row, matchedTokens) +
            pathSegmentTokenOverlap(row.file, extractDistinctiveTicketTokens(ticketText)) * 12 +
            scoreSymbolAnchorMatch(row.id, row.file, anchorSymbols) +
            workflowBoost.boost +
            scoreQueueInfrastructureBoost(row, workflow, queueInfrastructure) -
            falsePositive.penalty -
            genericBaseConfigPenalty(row.id, row.file, anchorSymbols);

        if (score <= 0) continue;

        const reasonParts = [buildMatchReason(matchedTokens, intent, row)];
        if (workflowBoost.reasons.length > 0) {
            reasonParts.push(`Workflow: ${workflowBoost.reasons.join("; ")}`);
        }
        if (falsePositive.reasons.length > 0) {
            reasonParts.push(`Penalty: ${falsePositive.reasons.join("; ")}`);
        }

        result.push({
            id: row.id,
            type: row.type,
            name: row.name,
            file: row.file,
            score: Math.round(score),
            reason: reasonParts.join(" | "),
        });
    }

    return result
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function isJunkGraphNode(row: DbNodeRow, matchedTokens: string[]): boolean {
    if (row.type === "parameter") {
        return true;
    }

    if (row.type !== "method") {
        return false;
    }

    const lowerId = row.id.toLowerCase();
    const lowerFile = (row.file ?? "").toLowerCase();

    if (!isFrameworkPlumbingNode(lowerId, lowerFile)) {
        return false;
    }

    const strongTokens = strongMatchedTokens(matchedTokens);

    if (strongTokens.length >= 2) {
        return false;
    }

    if (
        matchedTokens.length === 1 &&
        AMBIGUOUS_SINGLE_MATCH_TOKENS.has(matchedTokens[0].toLowerCase())
    ) {
        return true;
    }

    return strongTokens.length === 0;
}

function buildMatchReason(
    matchedTokens: string[],
    intent: TicketIntent,
    row: DbNodeRow
): string {
    const parts: string[] = [];

    if (matchedTokens.length > 0) {
        parts.push(`Matched token(s): ${matchedTokens.join(", ")}`);
    }

    const haystack = buildHaystack(row);

    const matchedActions = intent.actions.filter(action =>
        action !== "unknown" && haystackMatchesAction(haystack, action)
    );

    if (matchedActions.length > 0) {
        parts.push(`Matched intent action(s): ${matchedActions.join(", ")}`);
    }

    return parts.join(" | ");
}

function haystackMatchesAction(haystack: string, action: TicketAction): boolean {
    switch (action) {
        case "create":
            return /\b(create|store|save|insert|persist)\b/.test(haystack);
        case "update":
            return /\b(update|set|change|save|persist)\b/.test(haystack);
        case "delete":
            return /\b(delete|deleted|remove|expire|expired|cleanup)\b/.test(haystack);
        case "import":
            return /\b(import|imported|parser|mapping|feed|xml|csv)\b/.test(haystack);
        case "archive":
            return /\b(archive|archived|isarchived|isarchive)\b/.test(haystack);
        case "playback":
            return /\b(playback|access|accessible|permission|availability|check)\b/.test(haystack);
        case "validate":
            return /\b(validate|validation|required|rule)\b/.test(haystack);
        case "sync":
            return /\b(sync|webhook|handler|listener|consumer)\b/.test(haystack);
        case "notify":
            return /\b(notify|notification|message|event|listener)\b/.test(haystack);
        case "unknown":
            return false;
    }
}

function scoreSpecialMatches(
    row: DbNodeRow,
    matchedTokens: string[],
    documentFrequency: Map<string, number>
): number {
    let score = 0;

    const lowerId = row.id.toLowerCase();
    const lowerName = row.name.toLowerCase();
    const lowerFile = row.file?.toLowerCase() ?? "";

    for (const token of matchedTokens) {
        const lowerToken = token.toLowerCase();
        const weighted = tokenWeight(token, documentFrequency);

        if (weighted <= 0) continue;

        if (lowerName === lowerToken) score += weighted * 15;
        if (lowerId.includes(`/${lowerToken}`)) score += weighted * 10;
        if (lowerId.includes(`::${lowerToken}`)) score += weighted * 10;
        if (lowerFile.includes(`/${lowerToken}`)) score += weighted * 6;

        if (row.type === "request_field" && lowerName === lowerToken) {
            score += weighted * 20;
        }

        if (
            (row.type === "integration_entrypoint" || row.type === "config_literal") &&
            haystackContainsToken(lowerId, lowerToken)
        ) {
            score += weighted * 18;
        }

        if (
            (row.type === "model_field" || row.type === "response_field") &&
            lowerName === lowerToken
        ) {
            score += weighted * 22;
        }

        if (row.type === "api_endpoint" && haystackContainsToken(lowerId, lowerToken)) {
            score += weighted * 8;
        }

        if (
            (row.type === "vue_component" || row.type === "vue_prop") &&
            (lowerName === lowerToken || lowerId.includes(lowerToken))
        ) {
            score += weighted * 18;
        }

        if (isEntityToken(token)) {
            if (lowerName === lowerToken || lowerId.includes(lowerToken)) {
                score += weighted * 20;
            }
            if (lowerId.includes(`::${token}`) || lowerId.endsWith(`::${token}`)) {
                score += weighted * 25;
            }
            if (lowerFile.includes(`/${token.toLowerCase()}`)) {
                score += weighted * 12;
            }
        }
    }

    return score;
}

function scoreIntentMatches(
    row: DbNodeRow,
    intent: TicketIntent
): number {
    const haystack = buildHaystack(row);
    let score = 0;

    for (const action of intent.actions) {
        if (action === "unknown") continue;

        if (haystackMatchesAction(haystack, action)) {
            score += 35;
        }
    }

    for (const entity of intent.entities) {
        if (haystackContainsToken(haystack, entity)) {
            score += 20;
        }
    }

    for (const status of intent.statuses) {
        if (haystackContainsToken(haystack, status)) {
            score += 20;
        }
    }

    for (const source of intent.sources) {
        if (haystackContainsToken(haystack, source)) {
            score += 20;
        }
    }

    return score;
}

function scoreGraphConnectivity(nodeId: string, flows: TicketFlow[]): number {
    const incoming = flows.filter(flow => flow.to === nodeId).length;
    const outgoing = flows.filter(flow => flow.from === nodeId).length;

    let score = 0;

    if (incoming > 0) score += 40;
    if (outgoing > 0) score += 40;
    if (incoming > 0 && outgoing > 0) score += 60;

    return score;
}

function scoreTokenCombination(
    row: DbNodeRow,
    matchedTokens: string[],
    fieldTerms: string[],
    intent: TicketIntent
): number {
    const tokenSet = new Set(matchedTokens.map(token => token.toLowerCase()));
    const haystack = buildHaystack(row);

    let score = 0;

    const matchedFieldTerms = fieldTerms.filter(term =>
        haystackContainsToken(haystack, term)
    );

    if (matchedFieldTerms.length > 0) {
        score += matchedFieldTerms.length * 180;
    }

    if (
        intent.actions.includes("import") &&
        /\b(import|parser|mapping|map|feed|xml|csv)\b/.test(haystack)
    ) {
        score += 100;
    }

    if (
        intent.actions.includes("update") &&
        /\b(update|set|save|persist|repository|service)\b/.test(haystack)
    ) {
        score += 80;
    }

    if (
        intent.actions.includes("create") &&
        /\b(create|store|save|persist|repository|service)\b/.test(haystack)
    ) {
        score += 70;
    }

    if (
        intent.actions.includes("delete") &&
        /\b(delete|deleted|remove|expire|expired|cleanup)\b/.test(haystack)
    ) {
        score += 90;
    }

    if (
        intent.actions.includes("archive") &&
        /\b(archive|archived|isarchived|isarchive)\b/.test(haystack)
    ) {
        score += 110;
    }

    if (
        intent.actions.includes("playback") &&
        /\b(access|accessible|playback|permission|availability|check)\b/.test(haystack)
    ) {
        score += 70;
    }

    if (
        intent.actions.includes("sync") &&
        /\b(sync|webhook|handler|listener|consumer|command)\b/.test(haystack)
    ) {
        score += 60;
    }

    if (
        intent.actions.includes("notify") &&
        /\b(notify|notification|message|listener|subscriber|consumer)\b/.test(haystack)
    ) {
        score += 50;
    }

    if (
        intent.actions.includes("validate") &&
        /\b(validate|validation|rule|required|missing)\b/.test(haystack)
    ) {
        score += 70;
    }

    if (
        tokenSet.has("cms") &&
        /\b(controller|content|page|detail|admin|backend)\b/.test(haystack)
    ) {
        score += 30;
    }

    if (
        tokenSet.has("api") &&
        /\b(api|controller|resource|request|response|serializer)\b/.test(haystack)
    ) {
        score += 30;
    }

    if (
        hasAny(tokenSet, ["test", "tests"]) &&
        /\b(test|tests|spec)\b/.test(haystack)
    ) {
        score += 60;
    }

    const strongDomainTokens = [
        "recording",
        "filepath",
        "delivered",
        "isarchived",
        "archived",
        "sqs",
        "s3",
        "playback",
        "deleted",
    ];

    const strongMatches = strongDomainTokens.filter(token =>
        tokenSet.has(token) && haystackContainsToken(haystack, token)
    );

    if (strongMatches.length >= 2) {
        score += strongMatches.length * 60;
    }

    return score;
}

function hasAny(set: Set<string>, values: string[]): boolean {
    return values.some(value => set.has(value));
}

function findRelatedFlows(
    db: SQLiteDatabase,
    seedNodeIds: string[],
    limit: number
): TicketFlow[] {
    if (seedNodeIds.length === 0) return [];

    const uniqueSeedIds = [...new Set(seedNodeIds)];
    const placeholders = uniqueSeedIds.map(() => "?").join(",");

    const rows = db.prepare(`
        SELECT from_id, to_id, type, via, argument_index, confidence, reason
        FROM edges
        WHERE type IN (
            'ROUTES_TO',
            'CALLS',
            'READS_FIELD',
            'VALIDATES',
            'VALIDATES_FIELD',
            'ASSIGNS',
            'FLOWS_TO',
            'ARGUMENT_TO'
        )
        AND (
            from_id IN (${placeholders})
            OR to_id IN (${placeholders})
        )
        ORDER BY
            CASE type
                WHEN 'ROUTES_TO' THEN 1
                WHEN 'READS_FIELD' THEN 2
                WHEN 'VALIDATES' THEN 3
                WHEN 'VALIDATES_FIELD' THEN 4
                WHEN 'ASSIGNS' THEN 5
                WHEN 'FLOWS_TO' THEN 6
                WHEN 'ARGUMENT_TO' THEN 7
                WHEN 'CALLS' THEN 8
                ELSE 99
            END,
            from_id ASC,
            to_id ASC
        LIMIT ?
    `).all(
        ...uniqueSeedIds,
        ...uniqueSeedIds,
        limit
    ) as DbEdgeRow[];

    return rows.map(row => ({
        from: row.from_id,
        to: row.to_id,
        type: row.type,
        via: row.via,
        argumentIndex: row.argument_index,
        confidence: row.confidence,
        reason: row.reason,
    }));
}

function buildFlowRoles(
    nodes: TicketMatchedNode[],
    flows: TicketFlow[],
    workflowType: DominantWorkflow["type"]
): TicketFlowRole[] {
    return nodes.map(node => classifyNodeRole(node, flows, workflowType));
}

function classifyNodeRole(
    node: TicketMatchedNode,
    flows: TicketFlow[],
    workflowType: DominantWorkflow["type"]
): TicketFlowRole {
    const incoming = flows.filter(flow => flow.to === node.id).length;
    const outgoing = flows.filter(flow => flow.from === node.id).length;
    const lower = `${node.id} ${node.name} ${node.file ?? ""}`.toLowerCase();

    if (node.type === "api_endpoint") {
        return {
            id: node.id,
            role: "ENTRYPOINT",
            reason: "API endpoint node",
        };
    }

    if (lower.includes("/console/commands/") || lower.includes("command::") || lower.includes("console\\commands")) {
        return {
            id: node.id,
            role: "ENTRYPOINT",
            reason: "Console command",
        };
    }

    if (lower.includes("/jobs/") || lower.includes("\\jobs\\")) {
        if (workflowType === "queue" && isWorkflowAlignedEntrypoint(node.id, node.file, workflowType)) {
            return {
                id: node.id,
                role: "ASYNC_ENTRYPOINT",
                reason: "Workflow-aligned job/async class",
            };
        }

        return {
            id: node.id,
            role: "IMPLEMENTATION",
            reason: "Job class (verify workflow alignment before using as entrypoint)",
        };
    }

    if (lower.includes("controller")) {
        return {
            id: node.id,
            role: "ENTRYPOINT",
            reason: "Controller-like node",
        };
    }

    if (lower.includes("repository")) {
        return {
            id: node.id,
            role: "DEPENDENCY",
            reason: "Repository-like node",
        };
    }

    if (lower.includes("service")) {
        return {
            id: node.id,
            role: "IMPLEMENTATION",
            reason: "Service-like node",
        };
    }

    if (incoming === 0 && outgoing > 0) {
        return {
            id: node.id,
            role: "ENTRYPOINT",
            reason: "Only outgoing graph edges",
        };
    }

    if (incoming > 0 && outgoing > 0) {
        return {
            id: node.id,
            role: "IMPLEMENTATION",
            reason: "Incoming and outgoing graph edges",
        };
    }

    if (incoming > 0 && outgoing === 0) {
        return {
            id: node.id,
            role: "DEPENDENCY",
            reason: "Only incoming graph edges",
        };
    }

    return {
        id: node.id,
        role: "RELATED",
        reason: "Matched by search but no clear graph role",
    };
}

function buildSuggestedFiles(matches: TicketMatchedNode[]): TicketFileHit[] {
    const fileMap = new Map<string, TicketFileHit>();

    for (const match of matches) {
        if (!match.file) continue;

        const existing = fileMap.get(match.file);

        if (!existing) {
            fileMap.set(match.file, {
                file: match.file,
                score: match.score,
                reasons: [match.reason],
            });
            continue;
        }

        existing.score += match.score;
        existing.reasons.push(match.reason);
    }

    return [...fileMap.values()]
        .sort((a, b) => b.score - a.score);
}

function calculateNavigationConfidence(
    endpoints: TicketMatchedNode[],
    methods: TicketMatchedNode[],
    fields: TicketMatchedNode[],
    flows: TicketFlow[],
    workflow: DominantWorkflow
): number {
    let score = 0;

    if (endpoints.length > 0) score += 0.1;
    if (methods.length > 0) score += 0.25;
    if (fields.length > 0) score += 0.15;
    if (flows.length > 0) score += 0.1;
    score += workflow.confidence * 0.2;

    const allMatches = [...endpoints, ...methods, ...fields];
    const topScore = Math.max(...allMatches.map(item => item.score), 0);

    if (topScore >= 500) score += 0.05;
    if (topScore >= 900) score += 0.05;

    return Number(Math.max(0, Math.min(score, 0.95)).toFixed(2));
}

function calculateImplementationConfidence(
    navigationConfidence: number,
    claims: TicketClaims,
    workflow: DominantWorkflow,
    truncated: boolean,
    methods: TicketMatchedNode[],
    entrypointConfidence = 0,
    ticketText = ""
): number {
    let score = navigationConfidence * 0.35 + entrypointConfidence * 0.35;

    if (workflow.confidence >= 0.8) score += 0.1;
    if (claims.infrastructureGaps.length === 0) score += 0.1;

    const partialFields = claims.fieldStatuses.filter(
        status => status.missingLayers.length > 0 || status.summary.includes("request/data-flow only")
    );

    score -= partialFields.length * 0.08;
    score -= claims.infrastructureGaps.length * 0.1;
    score -= claims.doNotStartHere.length * 0.04;
    if (truncated) score -= 0.12;

    const hasAlignedTopMethod = methods.slice(0, 3).some(method =>
        isWorkflowAlignedEntrypoint(method.id, method.file, workflow.type)
    );

    if (!hasAlignedTopMethod) score -= 0.15;

    if (ticketText && !ticketHasConcreteAnchors(ticketText)) {
        score = Math.min(score, 0.58);
    }

    return Number(Math.max(0, Math.min(score, 0.9)).toFixed(2));
}

function tokenize(input: string): string[] {
    const normalized = input
        .replace(/[{}()[\],.;:!?'"`]/g, " ")
        .replace(/->/g, " ")
        .replace(/::/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    if (!normalized) return [];

    const rawTokens = normalized.split(" ");

    return [...new Set(
        rawTokens
            .map(token => token.trim())
            .filter(token => token.length >= 3)
            .filter(token => !/^\d+$/.test(token))
            .filter(token => !STOP_WORDS.has(token))
            .filter(token => !NOISE_TOKENS.has(token))
    )];
}

function extractFieldLikeTerms(input: string): string[] {
    const camelCaseMatches =
        input.match(/\b[a-z][a-zA-Z0-9]*(?:Id|ID|Time|Type|Category|Status|Name|Code|Flag|Date|Archived|Enabled|Disabled|Visible|Active)\b/g) ?? [];

    const snakeCaseMatches =
        input.match(/\b[a-z][a-z0-9]*(?:_id|_time|_type|_category|_status|_name|_code|_flag|_date|_archived|_enabled|_disabled|_visible|_active)\b/g) ?? [];

    return [...new Set(
        [...camelCaseMatches, ...snakeCaseMatches]
            .map(term => term.trim())
            .filter(Boolean)
            .map(term => term.toLowerCase())
            .filter(term => !NOISE_TOKENS.has(term))
    )];
}

function findMissingFieldTerms(
    haystackById: Map<string, string>,
    fieldTerms: string[]
): string[] {
    if (fieldTerms.length === 0) {
        return [];
    }

    const found = new Set<string>();

    for (const haystack of haystackById.values()) {
        for (const term of fieldTerms) {
            if (haystackContainsToken(haystack, term.toLowerCase())) {
                found.add(term.toLowerCase());
            }
        }
    }

    return fieldTerms.filter(term => !found.has(term.toLowerCase()));
}

function isFieldLikeToken(token: string): boolean {
    return (
        /[a-z][a-z0-9]*(id|time|type|category|status|name|code|flag|date|archived|enabled|disabled|visible|active)$/i.test(token) ||
        /[a-z][a-z0-9]*_(id|time|type|category|status|name|code|flag|date|archived|enabled|disabled|visible|active)$/i.test(token)
    );
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

function buildNodeLikeText(node: TicketMatchedNode): string {
    return [
        node.id,
        node.type,
        node.name,
        node.file ?? "",
        node.reason,
    ].join(" ").toLowerCase();
}

function normalizeKeywords(value: string | null): string {
    if (!value) return "";

    try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
            return parsed.join(" ");
        }

        return String(parsed);
    } catch {
        return value;
    }
}

function haystackContainsToken(haystack: string, token: string): boolean {
    const lowerToken = token.toLowerCase();

    if (lowerToken.length < 3) return false;
    if (NOISE_TOKENS.has(lowerToken)) return false;

    const escaped = escapeRegExp(lowerToken);

    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}