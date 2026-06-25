import type { WorkflowType } from "./ticketWorkflow";

const STOP_WORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "when", "then", "into", "your",
    "are", "was", "were", "will", "should", "have", "has", "had", "not", "can", "may",
    "use", "used", "using", "same", "only", "also", "all", "any", "each", "other",
    "about", "after", "before", "between", "during", "through", "where", "which",
    "what", "how", "why", "who", "able", "being", "been", "does", "did", "done",
    "shown", "below", "above", "top", "bottom", "left", "right", "full", "width",
    "purpose", "setting", "settings", "options", "option", "value", "values", "field",
    "overview", "table", "rules", "rule", "logic", "hardcoded", "further", "beyond",
    "toggle", "empty", "maximum", "visible", "ordered", "multi", "select", "ignored",
    "primary", "secondary", "supporting", "intended", "multiple", "lines", "chips",
    "button", "buttons", "area", "render", "rendered", "desktop", "mobile", "column",
    "content", "text", "short", "prominently", "configurable", "configuration",
    "given", "feature", "scenario", "background", "acceptance",
    "behaviour", "behavior", "story", "criteria", "explicit", "scope", "ops",
    "authorization", "required", "forbidden", "layer", "layers", "merge", "merged",
]);

const GENERIC_TICKET_TOKENS = new Set([
    "ticket", "event", "file", "content", "status", "type", "summary", "position",
    "layout", "display", "enabled", "source", "title", "description", "default",
    "component", "frontend", "collection", "livestream", "action", "change", "check",
    "data", "days", "api", "usable", "preview", "defines", "name", "names", "home",
    "page", "field", "value", "toggle",
]);

export const LOW_INFORMATION_WARNINGS = [
    "No meaningful domain terms were extracted.",
    "ImpactLens cannot determine a reliable investigation entrypoint.",
    "Please provide a more specific ticket or rerun with --boost after identifying relevant symbols.",
] as const;

export interface LowInformationGateInput {
    ticketText: string;
    workflowType: WorkflowType;
    boostTerms?: string[];
    entities?: string[];
    fields?: string[];
    fieldTerms?: string[];
    sources?: string[];
    actions?: string[];
    statuses?: string[];
    /** Tokens that survived strong-match filtering in the analyzer. */
    strongMatchedTokens: string[];
}

export interface TicketDomainAssessment {
    rejected: boolean;
    meaningfulTokens: string[];
}

/** Usable strong tokens for triage: length >= 6 after analyzer noise filtering. */
export function usableStrongTicketTokens(strongMatchedTokens: string[]): string[] {
    return strongMatchedTokens.filter(token => token.length >= 6);
}

export function hasTicketStructuralSignals(input: LowInformationGateInput): boolean {
    if ((input.boostTerms ?? []).some(term => term.trim().length > 0)) {
        return true;
    }

    if (ticketHasConcreteAnchors(input.ticketText)) {
        return true;
    }

    const concreteActions = (input.actions ?? []).filter(action => action !== "unknown");

    return (
        (input.entities ?? []).length > 0 ||
        (input.fields ?? []).length > 0 ||
        (input.fieldTerms ?? []).length > 0 ||
        (input.sources ?? []).length > 0 ||
        concreteActions.length > 0 ||
        (input.statuses ?? []).length > 0 ||
        ticketMentionsHttpRoute(input.ticketText)
    );
}

/**
 * Prefer "I don't know" over ranking on generic English:
 * unknown workflow + no entities/fields/endpoints/sources/actions + <= 1 usable strong token.
 */
export function shouldRejectAsLowInformationTicket(input: LowInformationGateInput): boolean {
    if (hasTicketStructuralSignals(input)) {
        return false;
    }

    if (input.workflowType !== "unknown") {
        return false;
    }

    return usableStrongTicketTokens(input.strongMatchedTokens).length <= 1;
}

export function assessTicketDomainInformation(
    input: LowInformationGateInput
): TicketDomainAssessment {
    const meaningfulTokens = usableStrongTicketTokens(input.strongMatchedTokens);

    return {
        rejected: shouldRejectAsLowInformationTicket(input),
        meaningfulTokens,
    };
}

export function tokenizeTicketText(input: string): string[] {
    const normalized = input
        .replace(/[{}()[\],.;:!?'"`]/g, " ")
        .replace(/->/g, " ")
        .replace(/::/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    if (!normalized) {
        return [];
    }

    return [...new Set(
        normalized
            .split(" ")
            .map(token => token.trim())
            .filter(token => token.length >= 4)
            .filter(token => !/^\d+$/.test(token))
            .filter(token => !STOP_WORDS.has(token))
            .filter(token => !GENERIC_TICKET_TOKENS.has(token))
    )];
}

function addCompoundPhrasesFromLine(line: string, tokens: Set<string>): void {
    for (const match of line.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,3})\b/g) ?? []) {
        const compact = match.toLowerCase().replace(/\s+/g, "");
        if (compact.length >= 6 && compact.length <= 32) {
            tokens.add(compact);
        }
    }

    for (const match of line.match(/\b([A-Z][a-z0-9]+(?:\s+[a-z]{1,5}){1,2}\s+[A-Z][a-z0-9]+)\b/g) ?? []) {
        const compact = match.toLowerCase().replace(/\s+/g, "");
        if (compact.length >= 6 && compact.length <= 32) {
            tokens.add(compact);
        }
    }
}

function addCompoundPhrases(ticketText: string, tokens: Set<string>): void {
    for (const line of ticketText.split("\n")) {
        addCompoundPhrasesFromLine(line.trim(), tokens);
    }

    for (const match of ticketText.match(/\b[a-z][a-z0-9]*:[a-z][a-z0-9]*\b/gi) ?? []) {
        const [left, right] = match.toLowerCase().split(":");
        if (left && left.length >= 4) {
            tokens.add(left);
        }
        if (right && right.length >= 4) {
            tokens.add(right);
        }
        tokens.add(match.toLowerCase().replace(":", ""));
    }
}

export function extractDistinctiveTicketTokens(ticketText: string): string[] {
    const tokens = new Set<string>();

    addCompoundPhrases(ticketText, tokens);

    for (const token of tokenizeTicketText(ticketText)) {
        tokens.add(token);
    }

    return [...tokens].sort((left, right) => right.length - left.length);
}

export function extractFieldPathTerms(ticketText: string): string[] {
    const paths = new Set<string>();

    for (const match of ticketText.match(/\b[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9]*)+\b/gi) ?? []) {
        paths.add(match.toLowerCase());
    }

    for (const match of ticketText.match(/`([a-z0-9][a-z0-9._/-]*)`/gi) ?? []) {
        const value = match.replace(/`/g, "").toLowerCase();
        if (value.length >= 2) {
            paths.add(value);
        }
    }

    return [...paths];
}

const TITLE_LINE_PREFIX = /^(title|description|acceptance criteria|summary|to do)\b/i;

function ticketMentionsHttpRoute(ticketText: string): boolean {
    return (
        ticketText.match(
            /\b(GET|POST|PUT|PATCH|DELETE)\s+\/?(?:api\/v\d+\/)?[a-z0-9][a-z0-9./_{}<>\-]*/gi
        )?.length ?? 0
    ) > 0;
}

export function ticketHasConcreteAnchors(ticketText: string): boolean {
    if (ticketMentionsHttpRoute(ticketText)) {
        return true;
    }

    if (extractFieldPathTerms(ticketText).length > 0) {
        return true;
    }

    if (/`[^`]+`/.test(ticketText)) {
        return true;
    }

    if (/\.(vue|php|tsx?|jsx?)\b/i.test(ticketText)) {
        return true;
    }

    if (/\bModules\\[A-Za-z0-9\\]+/.test(ticketText)) {
        return true;
    }

    for (const line of ticketText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || TITLE_LINE_PREFIX.test(trimmed)) {
            continue;
        }

        if (/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/.test(trimmed)) {
            return true;
        }
    }

    return false;
}

export function countTokenOverlap(haystack: string, tokens: string[]): number {
    const normalized = haystack.toLowerCase();
    let score = 0;

    for (const token of tokens) {
        if (token.length < 4) {
            continue;
        }

        if (normalized.includes(token)) {
            score += token.length >= 8 ? 3 : token.length >= 6 ? 2 : 1;
        }
    }

    return score;
}

export function pathSegmentTokenOverlap(filePath: string | null, tokens: string[]): number {
    if (!filePath) {
        return 0;
    }

    const segments = filePath
        .toLowerCase()
        .split(/[/\\]/)
        .map(segment => segment.replace(/\.(vue|tsx?|jsx?)$/i, ""))
        .flatMap(segment => segment.split(/[-_]/))
        .map(segment => segment.replace(/[^a-z0-9]/g, ""))
        .filter(segment => segment.length >= 4);

    let score = 0;

    for (const token of tokens) {
        if (segments.some(segment => segment.includes(token) || token.includes(segment))) {
            score += token.length >= 8 ? 4 : 2;
        }
    }

    return score;
}
