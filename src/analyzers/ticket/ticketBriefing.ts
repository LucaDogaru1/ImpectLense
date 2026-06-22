import { TicketAnalyzerResult } from "./ticketAnalyzerV3";
import { TicketFlowPath } from "./ticketFlowPaths";
import { formatIntentLabel } from "./ticketIntent";
import { TicketBriefing, TicketProbeResult, TicketSessionResolved } from "./ticketSessionTypes";

const STRONG_UI_MATCH_THRESHOLD = 5;

const GENERIC_UI_TOKENS = new Set([
    "ticket",
    "event",
    "file",
    "content",
    "status",
    "type",
    "summary",
    "position",
    "layout",
    "display",
    "enabled",
    "source",
    "title",
    "description",
    "default",
    "component",
    "frontend",
    "collection",
    "livestream",
    "action",
    "change",
    "check",
    "data",
    "days",
    "api",
]);

interface StrongUiPromotionOptions {
    intentOpen?: boolean;
    workflowType?: string;
}

interface ReadFirstItem {
    id: string;
    file: string | null;
    reason: string;
}

function uniqueFiles(items: Array<{ file: string | null }>): string[] {
    const seen = new Set<string>();
    const files: string[] = [];

    for (const item of items) {
        if (!item.file || seen.has(item.file)) continue;
        seen.add(item.file);
        files.push(item.file);
    }

    return files;
}

function isReadFirstCandidate(
    item: { id: string; file: string | null },
    structuralIds: Set<string>,
    workflowType: string
): boolean {
    if (structuralIds.has(item.id)) {
        return true;
    }

    const haystack = `${item.id} ${item.file ?? ""}`;

    if (workflowType === "ui") {
        return /\.vue::|::setup\b|components\/|\/cells\/|\/views\/|pagemanager|hero|preset|slide|controller|resource/i.test(
            haystack
        );
    }

    return /expired|archive|vod|sqs|listener|consumer|import|controller|resource|store|update/i.test(haystack);
}

function isVueOrJsTarget(item: { id: string; file: string | null }): boolean {
    const haystack = `${item.id} ${item.file ?? ""}`;
    return /\.vue::|vue_component|\/cells\/|\/components\/|\/views\/|frontend\//i.test(haystack);
}

function extractStrongUiTokens(ticketText: string): string[] {
    const tokens = new Set<string>();

    for (const match of ticketText.match(/\b[a-z][a-z0-9]*:[a-z][a-z0-9]*\b/gi) ?? []) {
        const [left, right] = match.toLowerCase().split(":");
        if (left) tokens.add(left);
        if (right) tokens.add(right);
        tokens.add(match.toLowerCase().replace(":", ""));
    }

    for (const match of ticketText.match(/\b(?:hero|teaser|preset|slide)[a-z0-9]*\b/gi) ?? []) {
        if (match.length >= 4) {
            tokens.add(match.toLowerCase());
        }
    }

    for (const match of ticketText.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []) {
        if (/hero|teaser|preset|layout|position|component|frontend|cms|summary/.test(match)) {
            tokens.add(match);
        }
    }

    return [...tokens].filter(token => !GENERIC_UI_TOKENS.has(token) || /hero|teaser|preset|slide/.test(token));
}

function scoreStrongUiMatch(
    item: { id: string; file: string | null; score?: number },
    tokens: string[]
): number {
    const haystack = `${item.id} ${item.file ?? ""}`.toLowerCase();
    let score = 0;

    for (const token of tokens) {
        if (token.length < 4) {
            continue;
        }

        if (haystack.includes(token)) {
            score += token.length >= 8 ? 4 : 2;
        }
    }

    if (/heroteaser|hero\/|\/hero/i.test(haystack) && tokens.some(token => token.includes("hero"))) {
        score += 6;
    }

    if (/\.vue::/.test(haystack)) {
        score += 1;
    }

    if (/\/cells\//.test(haystack)) {
        score += 2;
    }

    return score + (item.score ?? 0) * 0.01;
}

function flowPathMatchesTarget(flowPath: string, item: { id: string; file: string | null }): boolean {
    const haystack = `${item.id} ${item.file ?? ""}`.toLowerCase();
    const pathLower = flowPath.toLowerCase();

    if (pathLower.includes(haystack) || haystack.includes(pathLower)) {
        return true;
    }

    const componentName = item.id.split("::").pop()?.toLowerCase();
    return Boolean(componentName && componentName.length >= 4 && pathLower.includes(componentName));
}

export function findStrongUiReadFirstCandidates(
    ticketText: string,
    candidates: Array<{ id: string; file: string | null; score?: number; reason: string }>,
    flowPaths: TicketFlowPath[] = [],
    options: StrongUiPromotionOptions = {}
): ReadFirstItem[] {
    const intentOpen = options.intentOpen ?? false;
    const workflowType = options.workflowType ?? "unknown";

    if (!intentOpen && workflowType !== "ui") {
        return [];
    }

    const tokens = extractStrongUiTokens(ticketText);
    if (tokens.length === 0) {
        return [];
    }

    const flowBackedIds = new Set<string>();

    for (const flowPath of flowPaths) {
        for (const candidate of candidates) {
            if (isVueOrJsTarget(candidate) && flowPathMatchesTarget(flowPath.path, candidate)) {
                flowBackedIds.add(candidate.id);
            }
        }
    }

    return candidates
        .filter(item => isVueOrJsTarget(item))
        .map(item => ({
            item,
            score: scoreStrongUiMatch(item, tokens) + (flowBackedIds.has(item.id) ? 3 : 0),
        }))
        .filter(entry => entry.score >= STRONG_UI_MATCH_THRESHOLD)
        .sort((left, right) => right.score - left.score)
        .map(({ item }) => ({
            id: item.id,
            file: item.file,
            reason: item.reason.split(" | ")[0] ?? item.reason,
        }));
}

function mergeReadFirst(primary: ReadFirstItem[], secondary: ReadFirstItem[], limit = 5): ReadFirstItem[] {
    const seen = new Set<string>();
    const merged: ReadFirstItem[] = [];

    for (const item of [...primary, ...secondary]) {
        if (seen.has(item.id)) {
            continue;
        }

        seen.add(item.id);
        merged.push(item);

        if (merged.length >= limit) {
            break;
        }
    }

    return merged;
}

function formatFlowPathLines(flowPaths: TicketFlowPath[]): string[] {
    if (flowPaths.length === 0) {
        return ["- None"];
    }

    return flowPaths.map(item => {
        const status = item.complete ? "complete" : "partial";
        const gap = item.gap ? ` — ${item.gap}` : "";
        return `- [${status}] ${item.path}${gap}`;
    });
}

export function buildTicketBriefing(
    analysis: TicketAnalyzerResult,
    probe: TicketProbeResult,
    resolved: TicketSessionResolved
): TicketBriefing {
    const structuralIds = new Set(probe.structuralCandidates.map(item => item.id));
    const workflowType = resolved.lockedWorkflow ?? analysis.workflow.type;
    const flowPaths = analysis.flowPaths ?? [];

    const prioritizedTargets = [
        ...analysis.investigationTargets.filter(item => structuralIds.has(item.id)),
        ...analysis.investigationTargets.filter(item => !structuralIds.has(item.id)),
    ];

    const workflowFiltered = prioritizedTargets
        .filter(item => isReadFirstCandidate(item, structuralIds, workflowType))
        .slice(0, 5)
        .map(item => ({
            id: item.id,
            file: item.file,
            reason: item.reason.split(" | ")[0] ?? item.reason,
        }));

    const uiSources = [...analysis.investigationTargets, ...analysis.matchedFrontend];
    const intentOpen = resolved.confirmedTopic === "unsure" || resolved.changeIncludes === "unsure";
    const strongUiMatches = findStrongUiReadFirstCandidates(analysis.query, uiSources, flowPaths, {
        intentOpen,
        workflowType,
    });
    const readFirst = mergeReadFirst(strongUiMatches, workflowFiltered, 5);

    const skip = analysis.claims.doNotStartHere.slice(0, 5).map(item => ({
        id: item.id,
        reason: item.reason,
    }));

    const verify: string[] = [];

    for (const status of analysis.claims.fieldStatuses) {
        if (status.missingLayers.length > 0) {
            verify.push(`Field '${status.field}': missing ${status.missingLayers.join(", ")}`);
        } else if (status.summary === "not found in graph") {
            verify.push(`Field '${status.field}' not found in graph`);
        }
    }

    for (const gap of probe.infrastructureGaps.slice(0, 3)) {
        verify.push(gap);
    }

    if (analysis.implementationConfidence < 0.35) {
        verify.push("Low implementation confidence — treat code hints as navigation only");
    }

    const warnings = [...analysis.claims.warnings];

    if (resolved.confirmedTopic === "unsure" || resolved.changeIncludes === "unsure") {
        warnings.push("User left topic or scope open (unsure) — treat ranking as broad guidance, verify in code");
    }

    const jsScopeRequested = resolved.scopes.includes("js");
    const jsLoaded = probe.graphCoverage.some(item => item.scope === "js" && item.loaded);
    if (jsScopeRequested && !jsLoaded) {
        warnings.push(
            "Frontend/JS scope requested but JS graph is not loaded yet — rerun after frontend scan"
        );
    }

    const workflowLabel = resolved.lockedWorkflow ?? analysis.workflow.type;
    const modeLabel = resolved.implementationMode ?? "unspecified";
    const surfaceLabel = resolved.surfaceScope ?? "unspecified";
    const scopeLabel = resolved.scopes.join(", ");
    const intentLabel = formatIntentLabel(resolved);

    const readFirstLines =
        readFirst.length === 0
            ? ["- None"]
            : readFirst.map((item, index) => {
                  const file = item.file ? ` (${item.file})` : "";
                  return `${index + 1}. \`${item.id}\`${file} — ${item.reason}`;
              });

    const skipLines =
        skip.length === 0
            ? ["- None"]
            : skip.map(item => `- \`${item.id}\` — ${item.reason}`);

    const verifyLines = verify.length === 0 ? ["- None"] : verify.map(item => `- ${item}`);
    const warningLines = warnings.length === 0 ? ["- None"] : warnings.map(item => `- ${item}`);
    const flowPathLines = formatFlowPathLines(flowPaths);

    const filesToOpen = uniqueFiles(readFirst).slice(0, 5);

    const markdown = [
        "# Ticket Briefing (AI context pack)",
        "",
        "## Session",
        ...(intentLabel ? [`- User intent: **${intentLabel}**`] : []),
        `- Workflow: **${workflowLabel}** (${analysis.workflow.confidence})`,
        `- Implementation mode: **${modeLabel}**`,
        `- Surface scope: **${surfaceLabel}**`,
        `- Graph scopes: **${scopeLabel}**`,
        `- Navigation confidence: ${analysis.navigationConfidence}`,
        `- Implementation confidence: ${analysis.implementationConfidence}`,
        `- Probe readiness: ${probe.readinessScore.toFixed(2)}`,
        "",
        "## Read first (in order)",
        ...readFirstLines,
        "",
        "## Likely flow paths",
        ...flowPathLines,
        "",
        "## Files to open",
        ...(filesToOpen.length === 0 ? ["- None"] : filesToOpen.map(file => `- ${file}`)),
        "",
        "## Verified / partial claims",
        ...(analysis.claims.fieldStatuses.length === 0
            ? ["- None"]
            : analysis.claims.fieldStatuses.map(status => `- ${status.field}: ${status.summary}`)),
        "",
        "## Skip / do not start here",
        ...skipLines,
        "",
        "## Verify manually",
        ...verifyLines,
        "",
        "## Warnings",
        ...warningLines,
        "",
        "## From ticket (condensed)",
        ...analysis.claims.fromTicket.slice(0, 6).map(line => `- ${line}`),
        "",
    ].join("\n");

    return {
        markdown,
        readFirst,
        flowPaths,
        skip,
        verify,
        warnings,
    };
}
