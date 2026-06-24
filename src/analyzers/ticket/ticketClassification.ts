import { GraphScope } from "./ticketSessionTypes";
import { TicketChangeArea } from "./ticketIntent";
import { ticketHasConcreteAnchors, tokenizeTicketText } from "./ticketTextTokens";
import { WorkflowType } from "./ticketWorkflow";

export interface TicketClassification {
    summary: string;
    ticket_topic: WorkflowType;
    change_includes: TicketChangeArea;
    scopes: GraphScope[];
    confidence: number;
    reasons: string[];
}

export type SurfaceKey = "ui" | "queue" | "import" | "api" | "export" | "persistence";

export interface SurfaceFeatureMatch {
    surface: SurfaceKey;
    term: string;
    weight: number;
}

export interface SurfaceScores {
    ui: number;
    queue: number;
    import: number;
    api: number;
    export: number;
    persistence: number;
    matches: SurfaceFeatureMatch[];
}

export interface NormalizedTicket {
    raw: string;
    title?: string;
    summary?: string;
    description?: string;
    userStory?: string;
    contentLines: string[];
    tokens: string[];
    nounPhrases: string[];
    lower: string;
}

interface SurfaceVocabulary {
    terms: string[];
    phrases: string[];
}

const SURFACE_VOCAB: Record<SurfaceKey, SurfaceVocabulary> = {
    ui: {
        terms: ["cms", "frontend", "component", "layout", "display", "preview", "editor", "dashboard", "screen", "vue", "teaser", "preset", "hero"],
        phrases: ["display rules", "content list", "hardcoded in the frontend", "desktop and mobile", "display in cms"],
    },
    queue: {
        terms: ["sqs", "queue", "listener", "consumer", "job", "async", "message", "filepath", "bucket", "archive", "expired"],
        phrases: ["queue message", "consume the sqs", "arn:aws:sqs", "storage bucket", "file path"],
    },
    import: {
        terms: ["import", "feed", "xml", "csv", "ingest", "parser", "provider", "sync", "mapping", "transformer", "migrated", "ranking"],
        phrases: ["data sync", "nightly import", "xml feed", "external provider", "link the migrated"],
    },
    api: {
        terms: ["api", "endpoint", "response", "request", "payload", "property", "properties", "field", "serializer", "serialization", "contract"],
        phrases: ["response field", "request body", "api returns", "api payload"],
    },
    export: {
        terms: ["export", "list", "report", "metadata", "dump"],
        phrases: ["export a list", "please export", "provide a list", "we need:", "export all"],
    },
    persistence: {
        terms: ["database", "model", "column", "status", "persist", "migration", "delivered", "archived", "isarchived"],
        phrases: ["set status", "store on"],
    },
};

const SURFACE_REASON_LABELS: Record<SurfaceKey, string> = {
    ui: "CMS/layout surface",
    queue: "queue/async surface",
    import: "import/sync surface",
    api: "API contract surface",
    export: "export/reporting surface",
    persistence: "persistence surface",
};

const STRUCTURAL_LINE =
    /^(overview|field|value|setting|type|default|enabled|source|sources|description|requirements|positions?|layout|display name|usable as|preview key|purpose|ignored sources|maximum tags visible|tag fill up|tag source options|default configuration|title|summary|details)$/i;

const TERM_WEIGHT = 8;
const PHRASE_WEIGHT = 18;

interface ClassificationSignals {
    dottedFieldPaths: string[];
    hasApiFieldContract: boolean;
    hasMixedStack: boolean;
    hasMediaQualitySymptom: boolean;
    hasVaguePerformanceSymptom: boolean;
    hasFrontendFacingEntity: boolean;
}

const FRONTEND_ENTITY_PATTERN =
    /\b(profile|profiles|page|pages|screen|screens|homepage|dashboard|player profile|player profiles)\b/i;

const VAGUE_PERFORMANCE_PATTERN =
    /\b(slow|slowly|performance|loads? very slowly|takes a long time|load faster|investigate and improve)\b/i;

function isVagueSymptomTicket(normalized: NormalizedTicket): boolean {
    return !ticketHasConcreteAnchors(normalized.raw) && normalized.raw.length < 900;
}

function extractDottedFieldPaths(raw: string): string[] {
    const paths = new Set<string>();

    for (const match of raw.matchAll(/\b([a-z][a-z0-9_]*(?:\.[a-z0-9_*<>[\]/`-]+)+)\b/gi)) {
        paths.add(match[1]!.toLowerCase());
    }

    for (const match of raw.matchAll(/`([^`\n]+\.[^`\n]+)`/g)) {
        paths.add(match[1]!.toLowerCase());
    }

    for (const match of raw.matchAll(/\b(post|get|put|patch|delete)\s+api\/[^\s]+/gi)) {
        paths.add(match[0]!.toLowerCase());
    }

    return [...paths];
}

function detectClassificationSignals(normalized: NormalizedTicket, surfaces: SurfaceScores): ClassificationSignals {
    const lower = normalized.lower;
    const dottedFieldPaths = extractDottedFieldPaths(normalized.raw);
    const apiContractLanguage = /\b(payload|property|properties|field|request|response)\b/i.test(lower);
    const hasApiFieldContract =
        dottedFieldPaths.length > 0 &&
        apiContractLanguage &&
        (/\bapi\b|api\/v\d+/i.test(lower) || surfaces.api >= TERM_WEIGHT);

    const publicApi = /\bpublic\b.*\bapi\b|\bget api\/v\d+/i.test(lower);
    const cmsApi = /\bcms\b/i.test(lower) && /\bapi\b|\bjwt\b|\broute/i.test(lower);
    const opsStack = /\b(storage|cache|redis|s3|artisan|cli|ops)\b/i.test(lower);
    const hasMixedStack = publicApi && cmsApi && opsStack;

    const hasStrongMediaSymptom =
        /\bblurry\b|\bblur\b|\bthumbnail|\bthumbnails|\bcompression|\boriginal upload/i.test(lower);
    const hasMediaQualitySymptom =
        (hasStrongMediaSymptom && /\bimage/i.test(lower)) ||
        (/\bimages?\b/i.test(lower) && /\bupload|\bcompression|\bthumbnail|\bmobile\b/i.test(lower) && hasStrongMediaSymptom);

    const hasVaguePerformanceSymptom =
        isVagueSymptomTicket(normalized) &&
        VAGUE_PERFORMANCE_PATTERN.test(lower) &&
        !hasMediaQualitySymptom;

    const hasFrontendFacingEntity = FRONTEND_ENTITY_PATTERN.test(lower);

    return {
        dottedFieldPaths,
        hasApiFieldContract,
        hasMixedStack,
        hasMediaQualitySymptom,
        hasVaguePerformanceSymptom,
        hasFrontendFacingEntity,
    };
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function isStructuralLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 8) {
        return true;
    }

    if (STRUCTURAL_LINE.test(trimmed)) {
        return true;
    }

    if (/^.+\s→\s.+—/.test(trimmed)) {
        return true;
    }

    if (/^\d+\.\s+\w/.test(trimmed) && trimmed.length < 24) {
        return true;
    }

    if (/^[A-Za-z]+\s*\n/.test(trimmed)) {
        return false;
    }

    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+){0,2}$/.test(trimmed) && !/\b(for|with|from|the)\b/i.test(trimmed)) {
        return true;
    }

    return false;
}

function extractSection(raw: string, startPattern: RegExp, endPattern: RegExp): string | undefined {
    const match = raw.match(new RegExp(`${startPattern.source}([\\s\\S]*?)(?=${endPattern.source}|$)`, "i"));
    const value = match?.[1]?.trim();
    return value ? normalizeWhitespace(value.split(/\r?\n\r?\n/)[0] ?? value) : undefined;
}

function extractNounPhrases(raw: string, contentLines: string[]): string[] {
    const phrases = new Set<string>();

    for (const match of raw.matchAll(/Purpose:\s*(.+?)(?:\.\s|$)/gi)) {
        const phrase = normalizeWhitespace(match[1] ?? "");
        if (phrase.length >= 8 && phrase.length <= 80) {
            phrases.add(phrase.toLowerCase());
        }
    }

    for (const match of raw.matchAll(/^\d+\.\s+([A-Za-z][A-Za-z0-9 /-]{2,40})$/gm)) {
        phrases.add(normalizeWhitespace(match[1]!).toLowerCase());
    }

    for (const match of raw.matchAll(/^\s*-\s+([a-z][a-z0-9 /_-]{2,40})$/gim)) {
        phrases.add(normalizeWhitespace(match[1]!).toLowerCase());
    }

    for (const match of raw.matchAll(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,4})\b/g)) {
        const phrase = match[1]!.toLowerCase();
        if (!/^(field value|display name|preview key)$/i.test(phrase)) {
            phrases.add(phrase);
        }
    }

    for (const line of contentLines) {
        if (/^[A-Za-z].*[.!?]$/.test(line) && line.length >= 24 && line.length <= 140) {
            phrases.add(normalizeWhitespace(line).toLowerCase());
        }
    }

    return [...phrases].slice(0, 10);
}

export function normalizeTicket(raw: string): NormalizedTicket {
    const trimmed = raw.trim();
    const title = extractSection(trimmed, /^Title:\s*\r?\n/i, /\r?\n(?:Description:|Summary:|$)/);
    const description = extractSection(trimmed, /^Description:\s*\r?\n/i, /\r?\n(?:Requirements:|Details:|$)/);
    const summary = extractSection(
        trimmed,
        /^Summary:\s*\r?\n/i,
        /\r?\n(?:Details:|Requirements:|Acceptance|$)/
    );

    const userStoryMatch = trimmed.match(
        /As an?\s+[^,\n]+,[\s\S]*?I want[^,\n]+,[\s\S]*?so that[^.\n]+[.]?/i
    );
    const userStory = userStoryMatch?.[0] ? normalizeWhitespace(userStoryMatch[0]) : undefined;

    const contentLines = trimmed
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !isStructuralLine(line));

    const tokens = tokenizeTicketText(trimmed);
    const nounPhrases = extractNounPhrases(trimmed, contentLines);

    return {
        raw: trimmed,
        title: title && !isStructuralLine(title) ? title : undefined,
        summary,
        description,
        userStory,
        contentLines,
        tokens,
        nounPhrases,
        lower: normalizeWhitespace(trimmed.toLowerCase()),
    };
}

function countTermMatches(text: string, term: string): number {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = term.includes(" ")
        ? new RegExp(escaped, "gi")
        : new RegExp(`\\b${escaped}\\b`, "gi");

    return (text.match(pattern) ?? []).length;
}

export function collectSurfaceFeatures(normalized: NormalizedTicket): SurfaceScores {
    const haystack = normalized.lower;
    const scores: SurfaceScores = {
        ui: 0,
        queue: 0,
        import: 0,
        api: 0,
        export: 0,
        persistence: 0,
        matches: [],
    };

    for (const surface of Object.keys(SURFACE_VOCAB) as SurfaceKey[]) {
        const vocab = SURFACE_VOCAB[surface];

        for (const phrase of vocab.phrases) {
            const hits = countTermMatches(haystack, phrase);
            if (hits > 0) {
                const weight = PHRASE_WEIGHT * hits;
                scores[surface] += weight;
                scores.matches.push({ surface, term: phrase, weight });
            }
        }

        for (const term of vocab.terms) {
            const hits = countTermMatches(haystack, term);
            if (hits > 0) {
                const weight = TERM_WEIGHT * hits;
                scores[surface] += weight;
                scores.matches.push({ surface, term, weight });
            }
        }
    }

    return scores;
}

export interface WorkflowScoreMap {
    ui: number;
    queue: number;
    import: number;
    api: number;
    unknown: number;
}

function scoreWorkflowsFromSurfaces(surfaces: SurfaceScores, normalized: NormalizedTicket): WorkflowScoreMap {
    const scores: WorkflowScoreMap = {
        ui: surfaces.ui,
        queue: surfaces.queue,
        import: surfaces.import + surfaces.export * 0.85,
        api: surfaces.api,
        unknown: 0,
    };

    if (surfaces.persistence > 0) {
        scores.queue += surfaces.persistence * 0.15;
        scores.import += surfaces.persistence * 0.1;
        scores.api += surfaces.persistence * 0.1;
    }

    const queueInfraScore =
        surfaces.matches
            .filter(match => match.surface === "queue" && /sqs|listener|consumer|queue message|consume the sqs|arn:aws:sqs/.test(match.term))
            .reduce((sum, match) => sum + match.weight, 0);

    const exportReportScore = surfaces.export;
    const metadataScore = countTermMatches(normalized.lower, "metadata") * TERM_WEIGHT;

    if (exportReportScore >= PHRASE_WEIGHT && exportReportScore > scores.queue) {
        scores.queue *= 0.35;
        scores.import += exportReportScore * 0.35;
    }

    if (exportReportScore >= PHRASE_WEIGHT && metadataScore > 0 && scores.queue > 0 && queueInfraScore < PHRASE_WEIGHT) {
        scores.queue *= 0.25;
        scores.import += Math.max(exportReportScore, metadataScore) * 0.25;
    }

    const contentTypeOnly =
        (countTermMatches(normalized.lower, "recording") > 0 || countTermMatches(normalized.lower, "vod") > 0) &&
        queueInfraScore < PHRASE_WEIGHT;

    if (contentTypeOnly && exportReportScore >= TERM_WEIGHT) {
        scores.queue *= 0.2;
    }

    if (contentTypeOnly && exportReportScore === 0 && scores.queue > 0 && queueInfraScore < PHRASE_WEIGHT) {
        scores.queue *= 0.45;
    }

    if (surfaces.ui > 0 && exportReportScore > 0 && exportReportScore >= scores.ui) {
        scores.import += exportReportScore * 0.2;
    }

    return scores;
}

function pickDominantWorkflow(scores: WorkflowScoreMap): { topic: WorkflowType; runnerUp: WorkflowType | null; margin: number } {
    const ranked = (Object.entries(scores) as Array<[WorkflowType, number]>)
        .filter(([type]) => type !== "unknown")
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const [topType, topScore] = ranked[0] ?? ["unknown", 0];
    const [secondType, secondScore] = ranked[1] ?? ["unknown", 0];

    if (topScore <= 0) {
        return { topic: "unknown", runnerUp: null, margin: 0 };
    }

    return {
        topic: topType,
        runnerUp: secondScore > 0 ? secondType : null,
        margin: topScore - secondScore,
    };
}

function firstSentence(text: string): string {
    const match = text.match(/^(.+?[.!?])(?:\s|$)/);
    if (match) {
        return normalizeWhitespace(match[1]!);
    }

    return normalizeWhitespace(text.slice(0, 160));
}

function formatPhraseList(items: string[]): string {
    const cleaned = items
        .map(item => item.replace(/\s+/g, " ").trim())
        .filter(item => item.length >= 3)
        .slice(0, 5);

    if (cleaned.length === 0) {
        return "requested content";
    }

    if (cleaned.length === 1) {
        return cleaned[0]!;
    }

    if (cleaned.length === 2) {
        return `${cleaned[0]} and ${cleaned[1]}`;
    }

    return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned.at(-1)}`;
}

function buildSummaryFromFeatures(
    normalized: NormalizedTicket,
    surfaces: SurfaceScores,
    topic: WorkflowType
): string {
    if (normalized.summary && !isStructuralLine(normalized.summary)) {
        return firstSentence(normalized.summary);
    }

    if (normalized.userStory) {
        return firstSentence(normalized.userStory);
    }

    if (normalized.description && !isStructuralLine(normalized.description)) {
        return firstSentence(normalized.description);
    }

    if (normalized.title) {
        return normalized.title;
    }

    const descriptiveLine = normalized.contentLines.find(
        line =>
            line.length >= 24 &&
            line.length <= 140 &&
            /[.!?]$/.test(line) &&
            !isStructuralLine(line) &&
            !/^purpose:/i.test(line)
    );
    if (descriptiveLine) {
        return firstSentence(descriptiveLine);
    }

    const entityPhrases = normalized.nounPhrases
        .filter(phrase => phrase.length <= 48 && !/^purpose:/i.test(phrase))
        .filter(phrase => !/^(headline|title|body|tags|call to action|overview)$/i.test(phrase));

    if (surfaces.export >= TERM_WEIGHT) {
        const detailPhrases = entityPhrases.length > 0
            ? entityPhrases
            : normalized.tokens.filter(token => /id|path|metadata|file|date|title/.test(token)).slice(0, 4);

        return `Export ${formatPhraseList(detailPhrases.length > 0 ? detailPhrases : ["content"])}.`;
    }

    if (topic === "queue" && surfaces.queue >= TERM_WEIGHT) {
        return `Process queue messages and update backend content state.`;
    }

    if (topic === "import" && surfaces.import >= TERM_WEIGHT) {
        const feedTerms = normalized.tokens.filter(token => /feed|provider|category|ranking|xml|csv/.test(token));
        return `Extend import or sync handling for ${formatPhraseList(feedTerms.length > 0 ? feedTerms : entityPhrases.slice(0, 3) || ["provider data"])}.`;
    }

    if (topic === "ui" && surfaces.ui >= TERM_WEIGHT) {
        const layoutTerms = [
            ...entityPhrases.slice(0, 4),
            ...normalized.tokens.filter(token => /layout|display|preview|component|preset|teaser/.test(token)),
        ];
        return `Update ${formatPhraseList([...new Set(layoutTerms)].slice(0, 4))} layout and display behavior.`;
    }

    if (topic === "api" && surfaces.api >= TERM_WEIGHT) {
        return `Change API request or response behavior for ${formatPhraseList(entityPhrases.slice(0, 3) || normalized.tokens.slice(0, 3))}.`;
    }

    if (entityPhrases.length > 0) {
        return `Investigate ${formatPhraseList(entityPhrases.slice(0, 3))}.`;
    }

    return "Ticket text provided without a clear title or summary.";
}

export function summarizeTicketText(ticketText: string): string {
    const normalized = normalizeTicket(ticketText);
    const surfaces = collectSurfaceFeatures(normalized);
    const workflowScores = scoreWorkflowsFromSurfaces(surfaces, normalized);
    const { topic } = pickDominantWorkflow(workflowScores);
    return buildSummaryFromFeatures(normalized, surfaces, topic);
}

function buildReasonsFromSurfaces(surfaces: SurfaceScores): string[] {
    const reasons: string[] = [];
    const rankedSurfaces = (Object.keys(SURFACE_VOCAB) as SurfaceKey[])
        .map(surface => ({ surface, score: surfaces[surface] }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.surface.localeCompare(b.surface));

    for (const item of rankedSurfaces.slice(0, 4)) {
        reasons.push(SURFACE_REASON_LABELS[item.surface]);
    }

    const matchedTerms = [...surfaces.matches]
        .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
        .map(match => match.term);

    for (const term of matchedTerms) {
        if (reasons.some(reason => reason.toLowerCase().includes(term.toLowerCase()))) {
            continue;
        }
        reasons.push(term);
        if (reasons.length >= 6) {
            break;
        }
    }

    return reasons.slice(0, 6);
}

export function collectClassificationReasons(ticketText: string): string[] {
    const normalized = normalizeTicket(ticketText);
    const surfaces = collectSurfaceFeatures(normalized);
    return buildReasonsFromSurfaces(surfaces);
}

function inferChangeIncludes(surfaces: SurfaceScores, topic: WorkflowType): TicketChangeArea {
    if (topic === "queue" || surfaces.queue >= surfaces.ui && surfaces.queue >= PHRASE_WEIGHT) {
        return "queue_job";
    }

    if (topic === "import" || surfaces.import >= TERM_WEIGHT || surfaces.export >= PHRASE_WEIGHT) {
        return "import_pipeline";
    }

    if (topic === "ui" || surfaces.ui >= TERM_WEIGHT) {
        return "cms_ui";
    }

    if (topic === "api" || surfaces.api >= TERM_WEIGHT) {
        return "api_field";
    }

    if (surfaces.persistence >= TERM_WEIGHT) {
        return "persistence";
    }

    return "backend_logic";
}

export function inferClassificationScopes(
    surfaces: SurfaceScores,
    topic: WorkflowType,
    changeIncludes: TicketChangeArea
): GraphScope[] {
    if (topic === "queue" || changeIncludes === "queue_job") {
        return ["php"];
    }

    if (surfaces.export >= PHRASE_WEIGHT && surfaces.export > surfaces.ui) {
        return ["php"];
    }

    if (
        topic === "ui" ||
        changeIncludes === "cms_ui" ||
        changeIncludes === "mixed" ||
        surfaces.ui >= TERM_WEIGHT ||
        (changeIncludes === "import_pipeline" && surfaces.ui >= TERM_WEIGHT)
    ) {
        return ["php", "js"];
    }

    if (topic === "api" && surfaces.ui >= TERM_WEIGHT) {
        return ["php", "js"];
    }

    return ["php"];
}

function applyClassificationRefinements(
    base: Omit<TicketClassification, "reasons"> & { margin: number },
    normalized: NormalizedTicket,
    surfaces: SurfaceScores,
    workflowScores: WorkflowScoreMap,
    signals: ClassificationSignals
): TicketClassification {
    let { ticket_topic: topic, change_includes: changeIncludes, scopes, confidence, summary, margin } = base;

    if (signals.hasMixedStack) {
        changeIncludes = "mixed";
    } else if (signals.hasApiFieldContract) {
        changeIncludes = "api_field";
    }

    if (signals.hasMediaQualitySymptom) {
        topic = "ui";
        changeIncludes = "mixed";
        scopes = ["php", "js"];
        confidence = Math.min(confidence, 0.48);
    } else if (signals.hasVaguePerformanceSymptom) {
        topic = workflowScores.api >= workflowScores.ui && surfaces.api >= TERM_WEIGHT ? "api" : "unknown";
        changeIncludes = "backend_logic";
        scopes = signals.hasFrontendFacingEntity ? ["php", "js"] : ["php"];
        confidence = Math.min(confidence, 0.45);
    }

    if (signals.hasApiFieldContract && !signals.hasMixedStack && !signals.hasMediaQualitySymptom) {
        topic = "api";
        if (changeIncludes !== "mixed") {
            changeIncludes = "api_field";
        }
    }

    if (changeIncludes === "mixed" && topic === "unknown" && surfaces.api >= TERM_WEIGHT) {
        topic = "api";
    }

    const reasons = buildReasonsFromSurfaces(surfaces);

    return {
        summary,
        ticket_topic: topic,
        change_includes: changeIncludes,
        scopes,
        confidence: Number(Math.max(0.2, Math.min(confidence, 0.95)).toFixed(2)),
        reasons,
    };
}

function computeClassificationConfidence(
    normalized: NormalizedTicket,
    workflowScores: WorkflowScoreMap,
    topic: WorkflowType,
    margin: number
): number {
    const ranked = (Object.values(workflowScores) as number[]).sort((a, b) => b - a);
    const top = ranked[0] ?? 0;
    const second = ranked[1] ?? 0;

    let score = 0.45;
    if (top >= 80) score = 0.9;
    else if (top >= 56) score = 0.78;
    else if (top >= 32) score = 0.65;
    else if (top >= 16) score = 0.52;

    if (margin >= 24) score += 0.08;
    else if (margin < 8) score -= 0.12;

    if (isVagueSymptomTicket(normalized)) {
        score = Math.min(score, 0.52);
    }

    if (ticketHasConcreteAnchors(normalized.raw)) {
        score += 0.06;
    }

    if (topic === "unknown") {
        score = Math.min(score, 0.35);
    }

    if (second > 0 && top / second < 1.25) {
        score -= 0.08;
    }

    return Number(Math.max(0.2, Math.min(score, 0.95)).toFixed(2));
}

/**
 * Classify a ticket before graph analysis.
 * Normalizes ticket text, scores generic workflow surfaces, and derives intent.
 */
export function classifyTicket(ticketText: string): TicketClassification {
    const trimmed = ticketText.trim();
    if (!trimmed) {
        return {
            summary: "Empty ticket text.",
            ticket_topic: "unknown",
            change_includes: "unsure",
            scopes: ["php"],
            confidence: 0,
            reasons: [],
        };
    }

    const normalized = normalizeTicket(trimmed);
    const surfaces = collectSurfaceFeatures(normalized);
    const workflowScores = scoreWorkflowsFromSurfaces(surfaces, normalized);
    const { topic, margin } = pickDominantWorkflow(workflowScores);
    const changeIncludes = inferChangeIncludes(surfaces, topic);
    const scopes = inferClassificationScopes(surfaces, topic, changeIncludes);
    const confidence = computeClassificationConfidence(normalized, workflowScores, topic, margin);
    const summary = buildSummaryFromFeatures(normalized, surfaces, topic);
    const signals = detectClassificationSignals(normalized, surfaces);

    return applyClassificationRefinements(
        {
            summary,
            ticket_topic: topic,
            change_includes: changeIncludes,
            scopes,
            confidence,
            margin,
        },
        normalized,
        surfaces,
        workflowScores,
        signals
    );
}

/** Map classification output to session `--answers` values. */
export function classificationToIntentAnswers(
    classification: TicketClassification
): Record<string, string> {
    return {
        ticket_topic: classification.ticket_topic,
        change_includes: classification.change_includes,
    };
}

/** Suggested CLI flags from classification (agent may override). */
export function classificationToSuggestedFlags(classification: TicketClassification): {
    scopes: string;
    answers: string;
} {
    const answers = classificationToIntentAnswers(classification);
    return {
        scopes: classification.scopes.join(","),
        answers: `ticket_topic:${answers.ticket_topic},change_includes:${answers.change_includes}`,
    };
}

export function formatClassificationMarkdown(classification: TicketClassification): string {
    const suggested = classificationToSuggestedFlags(classification);

    return [
        "# Ticket Classification",
        "",
        `- Summary: ${classification.summary}`,
        `- ticket_topic: **${classification.ticket_topic}**`,
        `- change_includes: **${classification.change_includes}**`,
        `- scopes: **${classification.scopes.join(", ")}**`,
        `- confidence: ${classification.confidence}`,
        `- reasons: ${classification.reasons.length === 0 ? "none" : classification.reasons.join(", ")}`,
        "",
        "Suggested analyze:ticket flags (review and override if confidence is low):",
        "",
        "```bash",
        `impactlens ticket sqlite/Graph.sqlite \\`,
        `  --ticket=<path> \\`,
        `  --scopes=${suggested.scopes} \\`,
        `  --answers=${suggested.answers}`,
        "```",
    ].join("\n");
}

export function formatClassificationBriefingSection(
    classification: TicketClassification,
    applied?: {
        ticket_topic?: string;
        change_includes?: string;
        scopes?: GraphScope[];
    }
): string[] {
    const suggested = classificationToSuggestedFlags(classification);
    const lines = [
        "## Ticket classification",
        `- Summary: ${classification.summary}`,
        `- Suggested ticket_topic: **${classification.ticket_topic}** (${classification.confidence})`,
        `- Suggested change_includes: **${classification.change_includes}**`,
        `- Suggested scopes: **${classification.scopes.join(", ")}**`,
        `- Reasons: ${classification.reasons.length === 0 ? "none" : classification.reasons.join(", ")}`,
    ];

    if (applied?.ticket_topic || applied?.change_includes || applied?.scopes) {
        lines.push(
            `- Applied ticket_topic: **${applied.ticket_topic ?? "—"}**`,
            `- Applied change_includes: **${applied.change_includes ?? "—"}**`,
            `- Applied scopes: **${(applied.scopes ?? []).join(", ") || "—"}**`
        );

        const topicMismatch =
            applied.ticket_topic &&
            applied.ticket_topic !== classification.ticket_topic &&
            applied.ticket_topic !== "unsure" &&
            applied.ticket_topic !== "mixed";
        const includesMismatch =
            applied.change_includes &&
            applied.change_includes !== classification.change_includes &&
            applied.change_includes !== "unsure" &&
            applied.change_includes !== "mixed";
        const scopesMismatch =
            applied.scopes &&
            applied.scopes.join(",") !== classification.scopes.join(",");

        if (topicMismatch || includesMismatch || scopesMismatch) {
            lines.push("- Note: applied session answers differ from classification suggestions.");
        }
    } else {
        lines.push(
            `- Suggested command: \`--scopes=${suggested.scopes} --answers=${suggested.answers}\``
        );
    }

    return lines;
}
