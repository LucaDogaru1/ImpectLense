import { TicketAnalyzerResult } from "./ticketAnalyzerV3";
import { filterFlowPathsForBriefing, TicketFlowPath } from "./ticketFlowPaths";
import { routeLabelsFromAnchors } from "./ticketRouteAnchoring";
import { formatIntentLabel } from "./ticketIntent";
import {
    adjustScoreForRankingHints,
    hasRankingHints,
    isSuppressedByRankingHints,
    type TicketRankingHints,
} from "./ticketRankingHints";
import { TicketBriefing, TicketProbeResult, TicketSessionResolved } from "./ticketSessionTypes";
import {
    countTokenOverlap,
    extractDistinctiveTicketTokens,
    pathSegmentTokenOverlap,
} from "./ticketTextTokens";
import {
    getBestSymbolAnchorMatchKind,
    isOneTimeOrCleanupCommand,
} from "./ticketSymbolAnchors";

const STRONG_UI_MATCH_THRESHOLD = 5;

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
        return /\.vue::|::setup\b|\/cells\/|\/components\/|\/views\/|pagemanager|controller|resource/i.test(
            haystack
        );
    }

    if (workflowType === "api" || workflowType === "mixed") {
        if (/baseconfigplayer|baseconfigsession|rssfeed|tokensettings|hotjarform|clientcategorieslist/i.test(haystack)) {
            return false;
        }

        return /uitranslation|ui-translation|ui_translations|controller|service|resource|request|api_endpoint/i.test(
            haystack
        );
    }

    return /expired|archive|vod|sqs|listener|consumer|import|controller|resource|store|update/i.test(haystack);
}

function isVueOrJsTarget(item: { id: string; file: string | null }): boolean {
    const haystack = `${item.id} ${item.file ?? ""}`;
    return /\.vue::|vue_component|\/cells\/|\/components\/|\/views\/|frontend\//i.test(haystack);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExplicitlyNamedInTicket(item: ReadFirstItem, ticketText: string): boolean {
    const ticketLower = ticketText.toLowerCase();
    const candidates = new Set<string>();

    const idTail = item.id.split("\\").pop()?.split("::").pop()?.split("@")[0];
    if (idTail) {
        candidates.add(idTail);
    }

    const className = item.id.split("\\").pop()?.split("::")[0];
    if (className) {
        candidates.add(className);
    }

    const fileBase = item.file?.split(/[/\\]/).pop()?.replace(/\.(php|vue|tsx?|jsx?)$/i, "");
    if (fileBase) {
        candidates.add(fileBase);
    }

    for (const candidate of candidates) {
        if (candidate.length < 6) {
            continue;
        }

        if (new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(ticketText)) {
            return true;
        }

        const kebab = candidate.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        if (kebab.length >= 6 && ticketLower.includes(kebab)) {
            return true;
        }
    }

    return false;
}

function isLooseUiReadFirstItem(
    item: ReadFirstItem,
    ticketText: string,
    anchorSymbols: string[],
    strongUiIds: Set<string>
): boolean {
    if (strongUiIds.has(item.id) || isVueOrJsTarget(item) || isExplicitlyNamedInTicket(item, ticketText)) {
        return false;
    }

    const anchorKind = getBestSymbolAnchorMatchKind(item.id, item.file, anchorSymbols);
    if (anchorKind === "loose") {
        return true;
    }

    return anchorKind !== "exact";
}

function computeUiReadFirstSortScore(
    item: ReadFirstItem,
    ticketText: string,
    scoreById: Map<string, number>,
    options: { strongUiIds: Set<string>; anchorSymbols: string[] }
): number {
    let score = scoreById.get(item.id) ?? 0;

    if (options.strongUiIds.has(item.id)) {
        return score + 12000;
    }

    if (isVueOrJsTarget(item)) {
        score += 9000;
        const haystack = `${item.id} ${item.file ?? ""}`;
        if (/\/cells\//.test(haystack)) {
            score += 800;
        }
        if (/\.vue::/.test(haystack)) {
            score += 400;
        }
    }

    if (isExplicitlyNamedInTicket(item, ticketText)) {
        score += 7000;
    }

    const anchorKind = getBestSymbolAnchorMatchKind(item.id, item.file, options.anchorSymbols);
    if (anchorKind === "exact") {
        score += 5000;
    } else if (anchorKind === "loose") {
        score += 800;
    }

    if (isOneTimeOrCleanupCommand(item.id, item.file) && !isExplicitlyNamedInTicket(item, ticketText)) {
        score -= 8000;
    }

    if (!isVueOrJsTarget(item) && !isExplicitlyNamedInTicket(item, ticketText) && anchorKind !== "exact") {
        score -= 3000;
    }

    return score;
}

function enforceLooseAnchorMaxRank(
    items: ReadFirstItem[],
    maxRank: number,
    isLoose: (item: ReadFirstItem) => boolean
): ReadFirstItem[] {
    if (items.length === 0) {
        return items;
    }

    const tight: ReadFirstItem[] = [];
    const loose: ReadFirstItem[] = [];

    for (const item of items) {
        (isLoose(item) ? loose : tight).push(item);
    }

    const headCount = Math.max(0, maxRank - 1);
    return [...tight.slice(0, headCount), ...tight.slice(headCount), ...loose].slice(0, items.length);
}

export interface ReadFirstMergeOptions {
    workflowType?: string;
    strongUiIds?: Set<string>;
    anchorSymbols?: string[];
}

function mergeUiReadFirstWithoutHints(
    primary: ReadFirstItem[],
    secondary: ReadFirstItem[],
    limit: number,
    ticketText: string,
    scoreById: Map<string, number>,
    anchorSymbols: string[],
    strongUiIds: Set<string>
): ReadFirstItem[] {
    const combined = dedupeReadFirstItems([...primary, ...secondary]);
    const sorted = [...combined].sort(
        (left, right) =>
            computeUiReadFirstSortScore(right, ticketText, scoreById, { strongUiIds, anchorSymbols }) -
            computeUiReadFirstSortScore(left, ticketText, scoreById, { strongUiIds, anchorSymbols })
    );

    const collapsed = collapseReadFirstByFile(sorted, limit, ticketText, scoreById);
    return enforceLooseAnchorMaxRank(collapsed, 3, item =>
        isLooseUiReadFirstItem(item, ticketText, anchorSymbols, strongUiIds)
    );
}

function extractStrongUiTokens(ticketText: string): string[] {
    return extractDistinctiveTicketTokens(ticketText);
}

function scoreStrongUiMatch(
    item: { id: string; file: string | null; score?: number },
    tokens: string[]
): number {
    const haystack = `${item.id} ${item.file ?? ""}`.toLowerCase();
    let score = countTokenOverlap(haystack, tokens);
    score += pathSegmentTokenOverlap(item.file, tokens);

    if (/\.vue::/.test(haystack)) {
        score += 1;
    }

    if (/\/cells\//.test(haystack)) {
        score += 2;
    }

    const primaryTokens = tokens.filter(token => token.length >= 8);
    if (primaryTokens.some(token => haystack.includes(token))) {
        score += 4;
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

function dedupeReadFirstItems(items: ReadFirstItem[], maxItems?: number): ReadFirstItem[] {
    const seen = new Set<string>();
    const merged: ReadFirstItem[] = [];

    for (const item of items) {
        if (seen.has(item.id)) {
            continue;
        }

        seen.add(item.id);
        merged.push(item);

        if (maxItems !== undefined && merged.length >= maxItems) {
            break;
        }
    }

    return merged;
}

function mergeReadFirst(
    primary: ReadFirstItem[],
    secondary: ReadFirstItem[],
    limit = 5,
    ticketText?: string,
    scoreById?: Map<string, number>
): ReadFirstItem[] {
    return collapseReadFirstByFile(
        dedupeReadFirstItems([...primary, ...secondary], limit * 3),
        limit,
        ticketText,
        scoreById
    );
}

export function mergeReadFirstCandidates(
    primary: ReadFirstItem[],
    secondary: ReadFirstItem[],
    limit = 5,
    ticketText?: string,
    scoreById?: Map<string, number>,
    rankingHints?: TicketRankingHints,
    mergeOptions?: ReadFirstMergeOptions
): ReadFirstItem[] {
    if (hasRankingHints(rankingHints)) {
        const combined = dedupeReadFirstItems([...primary, ...secondary]).filter(
            item => !isSuppressedByRankingHints(item, rankingHints)
        );

        const adjustedScoreById = new Map<string, number>();
        for (const item of combined) {
            adjustedScoreById.set(
                item.id,
                adjustScoreForRankingHints(scoreById?.get(item.id) ?? 0, item, rankingHints)
            );
        }

        const sorted = [...combined].sort(
            (left, right) =>
                (adjustedScoreById.get(right.id) ?? 0) - (adjustedScoreById.get(left.id) ?? 0)
        );

        return collapseReadFirstByFile(sorted, limit, ticketText, adjustedScoreById);
    }

    if (mergeOptions?.workflowType === "ui" && ticketText) {
        return mergeUiReadFirstWithoutHints(
            primary,
            secondary,
            limit,
            ticketText,
            scoreById ?? new Map(),
            mergeOptions.anchorSymbols ?? [],
            mergeOptions.strongUiIds ?? new Set<string>()
        );
    }

    return mergeReadFirst(primary, secondary, limit, ticketText, scoreById);
}

function symbolEntryPriority(id: string): number {
    if (/@prop:|@emit:|@slot:/i.test(id)) {
        return 1;
    }

    if (/::setup\b|::mounted\b|::created\b/i.test(id)) {
        return 2;
    }

    const vueTail = id.match(/\.vue::([^@]+)$/i)?.[1];
    if (vueTail && !vueTail.includes("::")) {
        return 10;
    }

    return 5;
}

function componentBasename(id: string, file: string | null): string | null {
    const fromId = id.split("::").pop()?.split("@")[0]?.toLowerCase();
    if (fromId && fromId.length >= 4) {
        return fromId;
    }

    const fromFile = file?.split(/[/\\]/).pop()?.replace(/\.(vue|tsx?|jsx?)$/i, "").toLowerCase();
    return fromFile && fromFile.length >= 4 ? fromFile : null;
}

export function collapseReadFirstByFile(
    items: ReadFirstItem[],
    limit = 5,
    ticketText?: string,
    scoreById?: Map<string, number>
): ReadFirstItem[] {
    const tokens = ticketText ? extractDistinctiveTicketTokens(ticketText) : [];
    const bestByKey = new Map<string, ReadFirstItem>();

    for (const item of items) {
        const key = item.file ?? item.id;
        const existing = bestByKey.get(key);

        if (!existing || symbolEntryPriority(item.id) > symbolEntryPriority(existing.id)) {
            bestByKey.set(key, item);
        }
    }

    const collapsed: ReadFirstItem[] = [];
    const seenKeys = new Set<string>();
    const seenBasenames = new Map<string, number>();

    for (const item of items) {
        const key = item.file ?? item.id;

        if (seenKeys.has(key)) {
            continue;
        }

        const basename = componentBasename(item.id, item.file);
        if (basename) {
            const itemScore =
                (scoreById?.get(item.id) ?? 0) +
                pathSegmentTokenOverlap(item.file, tokens) * 10 +
                countTokenOverlap(`${item.id} ${item.file ?? ""}`, tokens);

            const existingScore = seenBasenames.get(basename);
            if (existingScore !== undefined && existingScore >= itemScore) {
                continue;
            }

            seenBasenames.set(basename, itemScore);
        }

        seenKeys.add(key);
        collapsed.push(bestByKey.get(key)!);

        if (collapsed.length >= limit) {
            break;
        }
    }

    return collapsed;
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

export const LOW_SIGNAL_NAVIGATION_CONFIDENCE_THRESHOLD = 0.45;

export function isLowSignalTicketBriefing(
    workflowType: string,
    navigationConfidence: number
): boolean {
    return workflowType === "unknown" && navigationConfidence < LOW_SIGNAL_NAVIGATION_CONFIDENCE_THRESHOLD;
}

function formatLowSignalReadFirstLines(): string[] {
    return [
        "This ticket does not contain enough domain-specific terms.",
        "",
        "ImpactLens could not identify a reliable implementation entrypoint.",
        "",
        "Suggestions:",
        "",
        "- search the repository for domain terminology",
        "- classify the affected workflow manually",
        "- rerun analyze with `--boost` once concrete symbols are known",
    ];
}

export function buildTicketBriefing(
    analysis: TicketAnalyzerResult,
    probe: TicketProbeResult,
    resolved: TicketSessionResolved
): TicketBriefing {
    const structuralIds = new Set(probe.structuralCandidates.map(item => item.id));
    const workflowType = resolved.lockedWorkflow ?? analysis.workflow.type;
    const lowSignalBriefing =
        analysis.lowInformation ||
        isLowSignalTicketBriefing(workflowType, analysis.navigationConfidence);
    const rawFlowPaths = analysis.flowPaths ?? [];

    let readFirst: ReadFirstItem[] = [];
    let flowPaths: TicketFlowPath[] = [];
    let relatedSymbols: Array<{ id: string; file: string | null; reason: string }> = [];
    let skip: Array<{ id: string; reason: string }> = [];
    const intentOpen = resolved.confirmedTopic === "unsure" || resolved.changeIncludes === "unsure";

    if (!lowSignalBriefing) {
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
    const strongUiMatches = findStrongUiReadFirstCandidates(analysis.query, uiSources, rawFlowPaths, {
        intentOpen,
        workflowType,
    });
    const scoreById = new Map<string, number>();
    for (const item of [
        ...analysis.investigationTargets,
        ...analysis.matchedFrontend,
        ...(analysis.anchorContext?.anchoredTargets ?? []),
    ]) {
        const existing = scoreById.get(item.id) ?? 0;
        scoreById.set(item.id, Math.max(existing, item.score));
    }
    const anchoredReadFirst =
        intentOpen
            ? []
            : analysis.anchorContext?.anchoredTargets.map(item => ({
                  id: item.id,
                  file: item.file,
                  reason: item.reason.split(" | ")[0] ?? item.reason,
              })) ?? [];
    const strongUiIds = new Set(strongUiMatches.map(item => item.id));
    readFirst = mergeReadFirstCandidates(
        [...strongUiMatches, ...anchoredReadFirst],
        workflowFiltered,
        5,
        analysis.query,
        scoreById,
        analysis.rankingHints,
        {
            workflowType,
            strongUiIds,
            anchorSymbols: analysis.anchorContext?.symbols ?? [],
        }
    );
    flowPaths = filterFlowPathsForBriefing(rawFlowPaths, {
        ticketText: analysis.query,
        workflowType,
        seedNodeIds: readFirst.map(item => item.id),
        seedFiles: readFirst.map(item => item.file),
        anchorRouteLabels: analysis.anchorContext
            ? routeLabelsFromAnchors(analysis.anchorContext.routes)
            : [],
    }, 5);
    relatedSymbols = analysis.relatedSymbols.slice(0, 5);

    skip = analysis.claims.doNotStartHere.slice(0, 5).map(item => ({
        id: item.id,
        reason: item.reason,
    }));
    }

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

    for (const symbol of analysis.anchorContext?.netNewSymbols.slice(0, 5) ?? []) {
        if (!intentOpen) {
            verify.push(`Net-new symbol not in graph: ${symbol}`);
        }
    }

    if (analysis.implementationConfidence < 0.35) {
        verify.push("Low implementation confidence — treat code hints as navigation only");
    }

    const warnings = [...analysis.claims.warnings];

    if (lowSignalBriefing && !analysis.lowInformation) {
        warnings.push(
            "Ticket lacks domain-specific terms for a reliable entrypoint — no ranked files returned"
        );
    }

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

    const readFirstLines = lowSignalBriefing
        ? formatLowSignalReadFirstLines()
        : readFirst.length === 0
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
    const relatedLines =
        relatedSymbols.length === 0
            ? ["- None"]
            : relatedSymbols.map(item => `- \`${item.id}\` — ${item.reason}`);

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
        `- Entrypoint confidence: ${analysis.entrypointConfidence}`,
        `- Graph coverage confidence: ${analysis.graphCoverageConfidence}`,
        `- Implementation confidence: ${analysis.implementationConfidence}`,
        `- Probe readiness: ${probe.readinessScore.toFixed(2)}`,
        "",
        "## Read first (in order)",
        ...readFirstLines,
        "",
        "## Likely flow paths",
        ...flowPathLines,
        "",
        "## Related symbols (graph)",
        ...relatedLines,
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
        relatedSymbols,
        skip,
        verify,
        warnings,
    };
}
