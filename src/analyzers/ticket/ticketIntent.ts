import {
    calculateDominantWorkflow,
    isTicketTruncated,
    scoreWorkflows,
    WorkflowType,
} from "./ticketWorkflow";
import { TicketQuestion, TicketQuestionOption, TicketSessionResolved } from "./ticketSessionTypes";

export type TicketChangeArea =
    | "queue_job"
    | "api_field"
    | "persistence"
    | "cms_ui"
    | "import_pipeline"
    | "infra_new"
    | "backend_logic"
    | "mixed"
    | "unsure";

export interface TicketIntentPreview {
    dominantWorkflow: ReturnType<typeof calculateDominantWorkflow>;
    fields: string[];
    entities: string[];
    sources: string[];
    actions: string[];
    truncated: boolean;
}

const WORKFLOW_LABELS: Record<WorkflowType | "mixed" | "unsure", string> = {
    queue: "Queue / async processing",
    api: "API contract / serialization",
    import: "Import / feed ingestion",
    ui: "CMS / UI changes",
    cron: "Scheduled / cron job",
    migration: "Database migration",
    background: "Background job (non-SQS)",
    unknown: "Unclear workflow",
    mixed: "Mixed — multiple workflows",
    unsure: "Not sure — infer from ticket text and graph",
};

const CHANGE_AREA_LABELS: Record<TicketChangeArea, string> = {
    queue_job: "Queue listener or async job",
    api_field: "API request/response field",
    persistence: "Database / model persistence",
    cms_ui: "CMS or admin UI",
    import_pipeline: "Import / parser pipeline",
    infra_new: "Net-new infrastructure",
    backend_logic: "Backend service logic only",
    mixed: "Multiple areas apply — pick this instead of one area",
    unsure: "Not sure — infer from ticket text and graph",
};

/** Shown once at the start of interactive intent gathering. */
export const INTENT_SESSION_INTRO = [
    "Quick intent check before graph scan.",
    "Pick the closest match — you do not need to be exact.",
    "If several areas apply, choose mixed. If you are unsure, choose unsure or press Enter.",
].join(" ");

const INTENT_TOPIC_GUIDANCE =
    "Pick the closest primary workflow. Choose mixed if the ticket spans queue + API + UI. Choose unsure (or press Enter) if you do not know — analysis will infer from the ticket and graph.";

const INTENT_INCLUDES_GUIDANCE =
    "Pick the main change surface. Choose mixed if queue, API, persistence, and/or CMS all apply. Choose unsure (or press Enter) if you do not know — all detected signals will still be used.";

function tokenize(ticketText: string): string[] {
    return ticketText
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]+/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 3);
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

export function previewTicketIntent(ticketText: string): TicketIntentPreview {
    const lower = ticketText.toLowerCase();
    const tokens = tokenize(ticketText);
    const workflowScores = scoreWorkflows(ticketText, tokens);
    const dominantWorkflow = calculateDominantWorkflow(workflowScores);

    const actions: string[] = [];
    const sources: string[] = [];
    const entities: string[] = [];

    if (/import|feed|xml|csv|ingest/i.test(lower)) actions.push("import");
    if (/archive|archived/i.test(lower)) actions.push("archive");
    if (/sqs|queue|consumer|listener/i.test(lower)) sources.push("sqs");
    if (/api|endpoint|response|payload/i.test(lower)) sources.push("api");
    if (/cms|editor|display|screen/i.test(lower)) entities.push("cms");
    if (/recording|content|vod/i.test(lower)) entities.push("recording");

    return {
        dominantWorkflow,
        fields: extractFieldTerms(ticketText),
        entities,
        sources,
        actions,
        truncated: isTicketTruncated(ticketText),
    };
}

function finalizeIntentOptions(
    options: TicketQuestionOption[],
    max: number,
    pinIds: string[] = ["mixed", "unsure"]
): TicketQuestionOption[] {
    const deduped = dedupeOptions(options);
    const pinned = pinIds
        .map(id => deduped.find(option => option.id === id))
        .filter((option): option is TicketQuestionOption => Boolean(option));
    const rest = deduped.filter(option => !pinIds.includes(option.id));
    const room = Math.max(0, max - pinned.length);

    return [...rest.slice(0, room), ...pinned];
}

function dedupeOptions(options: TicketQuestionOption[]): TicketQuestionOption[] {
    const seen = new Set<string>();
    const result: TicketQuestionOption[] = [];

    for (const option of options) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        result.push(option);
    }

    return result;
}

function buildTopicOptions(preview: TicketIntentPreview): TicketQuestionOption[] {
    const options: TicketQuestionOption[] = [];
    const dominant = preview.dominantWorkflow;

    const dominantHint = dominant.reasons[0] ?? "strongest signal in ticket text";
    options.push({
        id: dominant.type,
        label: `${WORKFLOW_LABELS[dominant.type]} — ${dominantHint} (${dominant.confidence})`,
    });

    for (const secondary of dominant.secondary.slice(0, 2)) {
        if (secondary.confidence < 0.35 || secondary.type === dominant.type) {
            continue;
        }

        const hint = secondary.reasons[0] ?? "secondary signal";
        options.push({
            id: secondary.type,
            label: `${WORKFLOW_LABELS[secondary.type]} — ${hint} (${secondary.confidence})`,
        });
    }

    if (preview.sources.includes("sqs") && preview.fields.length > 0) {
        options.push({
            id: "mixed",
            label: "Mixed — queue/async plus API field or status changes",
        });
    } else if (dominant.secondary.some(item => item.confidence >= 0.35)) {
        options.push({
            id: "mixed",
            label: WORKFLOW_LABELS.mixed,
        });
    }

    options.push({ id: "unsure", label: WORKFLOW_LABELS.unsure });

    return finalizeIntentOptions(options, 6, ["mixed", "unsure"]);
}

function buildIncludeOptions(preview: TicketIntentPreview, ticketText: string): TicketQuestionOption[] {
    const lower = ticketText.toLowerCase();
    const options: TicketQuestionOption[] = [];

    if (preview.sources.includes("sqs") || preview.dominantWorkflow.type === "queue") {
        options.push({
            id: "queue_job",
            label: "Queue listener/job — consume SQS and update state",
        });
    }

    if (
        preview.fields.length > 0 ||
        preview.sources.includes("api") ||
        /api returns|response field|serialization|expose/i.test(lower)
    ) {
        const fieldHint = preview.fields.length > 0 ? preview.fields.slice(0, 2).join(", ") : "response changes";
        options.push({
            id: "api_field",
            label: `API field — ${fieldHint}`,
        });
    }

    if (/status|delivered|persist|database|migration|column|model/i.test(lower)) {
        options.push({
            id: "persistence",
            label: "Database/model — status or field persistence",
        });
    }

    if (preview.entities.includes("cms") || /cms|editor|dashboard|display in cms|screen/i.test(lower)) {
        options.push({
            id: "cms_ui",
            label: "CMS/admin UI — display or editor changes",
        });
    }

    if (preview.actions.includes("import") || /feed|xml|csv|import|ingest/i.test(lower)) {
        options.push({
            id: "import_pipeline",
            label: "Import/parser pipeline",
        });
    }

    if (/\bnew sqs|net-new|from scratch|greenfield|brand new\b/i.test(lower)) {
        options.push({
            id: "infra_new",
            label: "Net-new infrastructure (queue, config, wiring)",
        });
    }

    options.push({
        id: "backend_logic",
        label: "Backend service logic only (no UI/API surface)",
    });

    if (options.length >= 3) {
        options.push({
            id: "mixed",
            label: CHANGE_AREA_LABELS.mixed,
        });
    }

    options.push({ id: "unsure", label: CHANGE_AREA_LABELS.unsure });

    return finalizeIntentOptions(options, 7, ["mixed", "unsure"]);
}

export function buildIntentQuestions(ticketText: string): TicketQuestion[] {
    const preview = previewTicketIntent(ticketText);
    const questions: TicketQuestion[] = [];

    questions.push({
        id: "ticket_topic",
        prompt: "What is this ticket mainly about?",
        options: buildTopicOptions(preview),
        reason: "Confirms the primary workflow before scanning the codebase graph.",
        guidance: INTENT_TOPIC_GUIDANCE,
        required: true,
    });

    questions.push({
        id: "change_includes",
        prompt: "What does this change include?",
        options: buildIncludeOptions(preview, ticketText),
        reason: "Routes field-layer checks, surface scope, and ranking during graph scan.",
        guidance: INTENT_INCLUDES_GUIDANCE,
        required: true,
    });

    return questions;
}

export function hasIntentAnswers(answers: Record<string, string>): boolean {
    return Boolean(answers.ticket_topic && answers.change_includes);
}

export function inferIntentAnswers(ticketText: string): Record<string, string> {
    const preview = previewTicketIntent(ticketText);
    const topicOptions = buildTopicOptions(preview);
    const includeOptions = buildIncludeOptions(preview, ticketText);

    const topic = topicOptions[0]?.id ?? preview.dominantWorkflow.type;

    let changeIncludes = includeOptions[0]?.id ?? "unsure";
    if (preview.dominantWorkflow.type === "ui") {
        changeIncludes =
            includeOptions.find(option => option.id === "cms_ui")?.id ??
            includeOptions.find(option => option.id === "mixed")?.id ??
            changeIncludes;
    } else if (preview.dominantWorkflow.type === "queue") {
        changeIncludes =
            includeOptions.find(option => option.id === "queue_job")?.id ??
            includeOptions.find(option => option.id === "mixed")?.id ??
            changeIncludes;
    }

    return {
        ticket_topic: topic,
        change_includes: changeIncludes,
    };
}

export function formatIntentForEnrichment(resolved: TicketSessionResolved): string[] {
    const lines: string[] = [];

    if (resolved.confirmedTopic) {
        const label =
            resolved.confirmedTopic === "mixed" || resolved.confirmedTopic === "unsure"
                ? WORKFLOW_LABELS[resolved.confirmedTopic]
                : WORKFLOW_LABELS[resolved.confirmedTopic];
        lines.push(`User confirmed primary topic: ${label}.`);
        if (resolved.confirmedTopic === "unsure") {
            lines.push("Primary topic left open — no workflow boost applied.");
        }
    }

    if (resolved.changeIncludes) {
        lines.push(`Change includes: ${CHANGE_AREA_LABELS[resolved.changeIncludes]}.`);
        if (resolved.changeIncludes === "unsure") {
            lines.push("Change scope left open — no scope boost applied.");
        }
    }

    return lines;
}

export function formatIntentLabel(resolved: TicketSessionResolved): string | undefined {
    if (!resolved.confirmedTopic && !resolved.changeIncludes) {
        return undefined;
    }

    const parts: string[] = [];

    if (resolved.confirmedTopic) {
        parts.push(
            resolved.confirmedTopic === "mixed" || resolved.confirmedTopic === "unsure"
                ? WORKFLOW_LABELS[resolved.confirmedTopic]
                : WORKFLOW_LABELS[resolved.confirmedTopic]
        );
    }

    if (resolved.changeIncludes) {
        parts.push(CHANGE_AREA_LABELS[resolved.changeIncludes]);
    }

    return parts.join(" · ");
}
