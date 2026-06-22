import { DominantWorkflow } from "./ticketWorkflow";
import { fieldNamesMatch, haystackContainsField } from "../../shared/fieldNameMatching";
import { getNodesOfTypes, type DbEdgeRow, type DbNodeRow } from "./ticketGraphContext";

export interface FieldLayerIndexes {
    nodeById: Map<string, DbNodeRow>;
    nodesByType: Map<string, DbNodeRow[]>;
    haystackById: Map<string, string>;
    persistEdges: DbEdgeRow[];
    serializesEdges: DbEdgeRow[];
}

interface TicketIntentLike {
    actions: string[];
    entities: string[];
    fields: string[];
    statuses: string[];
    sources: string[];
}

export type FieldLayer = "request_input" | "data_flow" | "persistence" | "model_property" | "api_output";

export interface FieldLayerStatus {
    field: string;
    layers: Partial<Record<FieldLayer, string[]>>;
    missingLayers: FieldLayer[];
    ticketRequiresPersistence: boolean;
    summary: string;
}

export interface TicketClaims {
    fromTicket: string[];
    codeHints: Array<{ id: string; file: string | null; reason: string }>;
    notFoundInGraph: string[];
    doNotStartHere: Array<{ id: string; reason: string }>;
    fieldStatuses: FieldLayerStatus[];
    infrastructureGaps: string[];
    warnings: string[];
}

const FIELD_LAYER_NODE_TYPES = [
    "request_field",
    "variable_field",
    "model_field",
    "property",
    "response_field",
    "method",
] as const;

const PERSISTENCE_LAYERS: FieldLayer[] = ["persistence", "model_property"];
const API_OUTPUT_LAYERS: FieldLayer[] = ["api_output"];
const FULL_FIELD_LAYERS: FieldLayer[] = [
    "request_input",
    "data_flow",
    "persistence",
    "model_property",
    "api_output",
];

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

function normalizeKeywords(value: string | null): string {
    if (!value) return "";

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.join(" ") : String(parsed);
    } catch {
        return value;
    }
}

function haystackContainsToken(haystack: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function ticketRequiresNewField(ticketText: string, field: string): boolean {
    const lower = ticketText.toLowerCase();
    const fieldLower = field.toLowerCase();

    return (
        new RegExp(`new\\s+(?:flag|field|property)[^\\n]{0,80}${fieldLower}`, "i").test(lower) ||
        new RegExp(`${fieldLower}[^\\n]{0,40}(?:shall be added|should be added|must be added)`, "i").test(lower) ||
        new RegExp(`add(?:ed)?[^\\n]{0,60}${fieldLower}`, "i").test(lower)
    );
}

function ticketRequiresApiOutput(ticketText: string, field: string): boolean {
    const lower = ticketText.toLowerCase();
    const fieldLower = field.toLowerCase();

    return (
        (
            /api returns|content api|api response|returns the applied|expose|serialization|flag in .* api|in content api|api called/i.test(
                lower
            ) && haystackContainsField(lower, field)
        ) ||
        ticketRequiresNewField(ticketText, field)
    );
}

function rowMatchesField(
    row: DbNodeRow,
    field: string,
    haystack?: string
): boolean {
    if (fieldNamesMatch(row.name, field)) {
        return true;
    }

    return haystackContainsField(haystack ?? buildHaystack(row), field);
}

function collectFieldLayerRows(
    rows: DbNodeRow[],
    indexes?: FieldLayerIndexes
): DbNodeRow[] {
    if (indexes) {
        return getNodesOfTypes(
            {
                nodes: rows,
                edges: [],
                nodeById: indexes.nodeById,
                nodesByType: indexes.nodesByType,
                haystackById: indexes.haystackById,
                persistEdges: indexes.persistEdges,
                serializesEdges: indexes.serializesEdges,
            },
            [...FIELD_LAYER_NODE_TYPES]
        );
    }

    const allowed = new Set<string>(FIELD_LAYER_NODE_TYPES);
    return rows.filter(row => allowed.has(row.type));
}

function ticketRequiresPersistence(ticketText: string, field: string): boolean {
    const lower = ticketText.toLowerCase();
    const fieldLower = field.toLowerCase();

    return (
        /persist|stored|database|migration|column|save/i.test(lower) &&
        lower.includes(fieldLower)
    ) || ticketRequiresNewField(ticketText, field);
}

export function analyzeFieldLayers(
    rows: DbNodeRow[],
    edges: DbEdgeRow[],
    fieldTerms: string[],
    ticketText: string,
    indexes?: FieldLayerIndexes
): FieldLayerStatus[] {
    const fieldRows = collectFieldLayerRows(rows, indexes);
    const persistEdges = indexes?.persistEdges ?? edges.filter(edge => edge.type === "PERSISTS");
    const serializesEdges = indexes?.serializesEdges ?? edges.filter(edge => edge.type === "SERIALIZES");

    return fieldTerms.map(field => {
        const layers: Partial<Record<FieldLayer, string[]>> = {};

        for (const row of fieldRows) {
            const haystack = indexes?.haystackById.get(row.id) ?? buildHaystack(row);

            if (row.type === "request_field" && rowMatchesField(row, field, haystack)) {
                pushLayer(layers, "request_input", row.id);
                continue;
            }

            if (row.type === "variable_field" && haystackContainsField(haystack, field)) {
                pushLayer(layers, "data_flow", row.id);
                continue;
            }

            if (row.type === "model_field" && rowMatchesField(row, field, haystack)) {
                pushLayer(layers, "model_property", row.id);
                continue;
            }

            if (row.type === "property" && rowMatchesField(row, field, haystack)) {
                pushLayer(layers, "model_property", row.id);
                continue;
            }

            if (row.type === "response_field" && rowMatchesField(row, field, haystack)) {
                pushLayer(layers, "api_output", row.id);
                continue;
            }

            if (
                row.type === "method" &&
                /toarray|serialize|resource|transform|response/i.test(row.id) &&
                haystackContainsField(haystack, field)
            ) {
                pushLayer(layers, "api_output", row.id);
            }
        }

        for (const edge of persistEdges) {
            const target = indexes?.nodeById.get(edge.to_id) ?? rows.find(row => row.id === edge.to_id);
            if (!target || !rowMatchesField(target, field, indexes?.haystackById.get(target.id))) {
                continue;
            }

            pushLayer(layers, "persistence", edge.from_id);
        }

        for (const edge of serializesEdges) {
            const target = indexes?.nodeById.get(edge.to_id) ?? rows.find(row => row.id === edge.to_id);
            if (!target || !rowMatchesField(target, field, indexes?.haystackById.get(target.id))) {
                continue;
            }

            pushLayer(layers, "api_output", edge.to_id);
            pushLayer(layers, "api_output", edge.from_id);
        }

        const requiresPersistence = ticketRequiresPersistence(ticketText, field);
        const requiresApiOutput = ticketRequiresApiOutput(ticketText, field);
        const missingLayers: FieldLayer[] = [];

        if (requiresPersistence) {
            for (const layer of PERSISTENCE_LAYERS) {
                if (!layers[layer]?.length) missingLayers.push(layer);
            }
        }

        if (requiresApiOutput) {
            for (const layer of API_OUTPUT_LAYERS) {
                if (!layers[layer]?.length) missingLayers.push(layer);
            }
        }

        if (ticketRequiresNewField(ticketText, field) && !layers.persistence?.length && !layers.model_property?.length) {
            if (!missingLayers.includes("persistence")) missingLayers.push("persistence");
        }

        const presentLayers = FULL_FIELD_LAYERS.filter(layer => (layers[layer]?.length ?? 0) > 0);
        let summary: string;

        if (presentLayers.length === 0) {
            summary = "not found in graph";
        } else if (missingLayers.length > 0) {
            summary = `partial — found in ${presentLayers.join(", ")}, missing ${[...new Set(missingLayers)].join(", ")}`;
        } else if (layers.request_input?.length && !layers.persistence?.length && !layers.model_property?.length) {
            summary = "request/data-flow only — verify persistence and API output in code";
        } else {
            summary = `found in ${presentLayers.join(", ")}`;
        }

        return {
            field,
            layers,
            missingLayers: [...new Set(missingLayers)],
            ticketRequiresPersistence: requiresPersistence || requiresApiOutput,
            summary,
        };
    });
}

function pushLayer(
    layers: Partial<Record<FieldLayer, string[]>>,
    layer: FieldLayer,
    nodeId: string
): void {
    if (!layers[layer]) {
        layers[layer] = [];
    }
    if (!layers[layer]!.includes(nodeId)) {
        layers[layer]!.push(nodeId);
    }
}

function isApiConsumerIntegrationRow(row: DbNodeRow): boolean {
    const haystack = `${row.id} ${row.parent ?? ""} ${row.file ?? ""}`.toLowerCase();

    return (
        haystack.includes("\\consumer\\") ||
        haystack.includes("/consumer/") ||
        /validateconsumerkey|apikeygenerator|consumerrepository/i.test(haystack)
    );
}

export function detectInfrastructureGaps(
    rows: DbNodeRow[],
    intent: TicketIntentLike,
    ticketText: string,
    indexes?: Pick<FieldLayerIndexes, "nodesByType" | "haystackById">
): string[] {
    const gaps: string[] = [];
    const lower = ticketText.toLowerCase();
    const integrationNodes = indexes
        ? getNodesOfTypes(
            {
                nodes: rows,
                edges: [],
                nodeById: new Map(),
                nodesByType: indexes.nodesByType,
                haystackById: indexes.haystackById,
                persistEdges: [],
                serializesEdges: [],
            },
            ["integration_entrypoint"]
        )
        : rows.filter(row => row.type === "integration_entrypoint");
    const methodNodes = indexes
        ? getNodesOfTypes(
            {
                nodes: rows,
                edges: [],
                nodeById: new Map(),
                nodesByType: indexes.nodesByType,
                haystackById: indexes.haystackById,
                persistEdges: [],
                serializesEdges: [],
            },
            ["method"]
        )
        : rows.filter(row => row.type === "method");
    const configLiterals = indexes
        ? getNodesOfTypes(
            {
                nodes: rows,
                edges: [],
                nodeById: new Map(),
                nodesByType: indexes.nodesByType,
                haystackById: indexes.haystackById,
                persistEdges: [],
                serializesEdges: [],
            },
            ["config_literal"]
        )
        : rows.filter(row => row.type === "config_literal");

    const hasQueueSource =
        intent.sources.includes("sqs") ||
        intent.sources.includes("queue") ||
        /arn:aws:sqs/i.test(lower);

    if (hasQueueSource) {
        const queueConsumers = integrationNodes.filter(row =>
            (row.name === "sqs_consumer" || row.name === "queue_listener") &&
            !isApiConsumerIntegrationRow(row)
        );

        const legacyQueueInfra = methodNodes.filter(row => {
            const haystack = indexes?.haystackById.get(row.id) ?? buildHaystack(row);
            return /consumer|listener|receivemessage|sqsclient|queue::|processqueue/i.test(haystack);
        });

        if (queueConsumers.length === 0 && legacyQueueInfra.length === 0) {
            gaps.push("No SQS consumer/listener/handler found in graph — likely net-new infrastructure");
        }

        const queueNames = [
            ...(lower.match(/arn:aws:sqs:[^\s)]+/gi) ?? []).map(arn => arn.split(":").pop() ?? ""),
            ...(lower.match(/\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/gi) ?? []),
        ]
            .filter(Boolean)
            .filter(name => !/^(eu|us|ap|sa|ca|me|af)-[a-z]+-\d+$/i.test(name));

        for (const queueName of [...new Set(queueNames)]) {
            const queueLower = queueName.toLowerCase();
            const matched =
                configLiterals.some(row => row.name.toLowerCase() === queueLower) ||
                (indexes
                    ? [...indexes.haystackById.values()].some(haystack =>
                        haystackContainsToken(haystack, queueLower)
                    )
                    : rows.some(row => haystackContainsToken(buildHaystack(row), queueLower)));

            if (!matched) {
                gaps.push(`Queue name '${queueName}' not referenced in graph`);
            }
        }
    }

    if (intent.actions.includes("import") || intent.sources.includes("feed") || intent.sources.includes("xml")) {
        const importHandlers = integrationNodes.filter(row => row.name === "import_handler");

        const legacyImportHandlers = methodNodes.filter(row =>
            /import|transformer|parser|feed|ingest/i.test(`${row.id} ${row.file ?? ""}`)
        );

        if (importHandlers.length === 0 && legacyImportHandlers.length === 0) {
            gaps.push("No import/parser handler found in graph");
        }
    }

    return [...new Set(gaps)];
}

export function extractFromTicketClaims(ticketText: string, intent: TicketIntentLike): string[] {
    const claims: string[] = [];
    const lines = ticketText
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0 && !/^summary:|^details:|^acceptance|^requirements?:?$/i.test(line));

    for (const line of lines.slice(0, 12)) {
        if (line.length >= 20 && line.length <= 220) {
            claims.push(line.replace(/^[-*]\s*/, ""));
        }
    }

    if (intent.entities.length > 0) {
        claims.push(`Entities mentioned: ${intent.entities.join(", ")}`);
    }

    if (intent.statuses.length > 0) {
        claims.push(`Statuses mentioned: ${intent.statuses.join(", ")}`);
    }

    return [...new Set(claims)].slice(0, 10);
}

export function buildTicketClaims(input: {
    ticketText: string;
    intent: TicketIntentLike;
    workflow: DominantWorkflow;
    rows: DbNodeRow[];
    edges: DbEdgeRow[];
    investigationTargets: Array<{ id: string; file: string | null; score: number; reason: string; penaltyReasons?: string[] }>;
    excludedTargets: Array<{ id: string; reason: string }>;
    truncated: boolean;
    indexes?: FieldLayerIndexes;
}): TicketClaims {
    const fieldStatuses = analyzeFieldLayers(
        input.rows,
        input.edges,
        input.intent.fields,
        input.ticketText,
        input.indexes
    );
    const infrastructureGaps = detectInfrastructureGaps(
        input.rows,
        input.intent,
        input.ticketText,
        input.indexes
    );
    const warnings: string[] = [];

    if (input.truncated) {
        warnings.push("Ticket text appears truncated — requirements may be incomplete");
    }

    if (input.workflow.confidence < 0.65) {
        warnings.push(`Primary workflow '${input.workflow.type}' is uncertain — verify entrypoint manually`);
    }

    const notFoundInGraph: string[] = [...infrastructureGaps];

    for (const status of fieldStatuses) {
        if (status.summary === "not found in graph") {
            notFoundInGraph.push(`Field '${status.field}' — not found in graph`);
        } else if (status.missingLayers.length > 0) {
            notFoundInGraph.push(
                `Field '${status.field}' — missing layers: ${status.missingLayers.join(", ")}`
            );
        }
    }

    const codeHints = input.investigationTargets
        .filter(target => !input.excludedTargets.some(excluded => excluded.id === target.id))
        .slice(0, 5)
        .map(target => ({
            id: target.id,
            file: target.file,
            reason: `${target.reason} (unverified — open in code)`,
        }));

    return {
        fromTicket: extractFromTicketClaims(input.ticketText, input.intent),
        codeHints,
        notFoundInGraph: [...new Set(notFoundInGraph)],
        doNotStartHere: input.excludedTargets.slice(0, 5),
        fieldStatuses,
        infrastructureGaps,
        warnings,
    };
}

export { loadAllEdges, loadAllNodes } from "./ticketGraphContext";
