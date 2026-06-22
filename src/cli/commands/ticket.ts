import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
    analyzeTicket,
    TicketAnalyzerResult,
    TicketAnalyzerOptions,
} from "../../analyzers/ticket/ticketAnalyzerV3";
import {
    hasIntentAnswers,
    inferIntentAnswers,
    INTENT_SESSION_INTRO,
} from "../../analyzers/ticket/ticketIntent";
import {
    continueTicketSession,
    startTicketSession,
} from "../../analyzers/ticket/ticketSession";
import { inferAutoAnswersForQuestions } from "../../analyzers/ticket/ticketQuestions";
import {
    TicketQuestion,
    TicketSessionStartResult,
} from "../../analyzers/ticket/ticketSessionTypes";
import { toBulletList } from "../../shared/formatting/text";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

type TicketRenderPayload = TicketAnalyzerResult & {
    limit: number;
    ticketSource: string;
};

type RenderableNode = {
    id: string;
    file: string | null;
    score: number;
    reason: string;
};

const dbPath = process.argv[2];
const args = process.argv.slice(3);

const ticketPath = getOptionValue(args, "--ticket");
const limit = getIntOption(args, "--limit", 5, 1);
const jsonOutput = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const includeDebug = hasFlag(args, "--debug");
const nonInteractive = hasFlag(args, "--non-interactive") || hasFlag(args, "--auto");
const interactive = !nonInteractive;
const fullOutput = hasFlag(args, "--full");
const legacy = hasFlag(args, "--legacy");
const scopesArg = getOptionValue(args, "--scopes");

function resolveTicketText(): string {
    if (!ticketPath?.trim()) {
        return "";
    }

    const resolved = path.resolve(ticketPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        console.log(`Ticket file not found: ${ticketPath}`);
        process.exit(2);
    }

    return fs.readFileSync(resolved, "utf8");
}

function resolveTicketSource(): string {
    return ticketPath ? path.resolve(ticketPath) : "--ticket";
}

function inferDefaultScopes(db: Database): Array<"php" | "js"> {
    const row = db.prepare(`
        SELECT COUNT(*) as c
        FROM nodes
        WHERE type IN ('vue_component', 'js_module', 'vue_prop')
           OR file LIKE '%.vue'
           OR file LIKE '%.tsx'
           OR file LIKE '%.jsx'
           OR file LIKE '%.ts'
    `).get() as { c: number };

    return row.c > 0 ? ["php", "js"] : ["php"];
}

function parseScopes(value: string | undefined, db: Database): Array<"php" | "js"> {
    if (!value) {
        return inferDefaultScopes(db);
    }

    const scopes = value
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(item => item === "php" || item === "js");

    return scopes.length > 0 ? scopes as Array<"php" | "js"> : inferDefaultScopes(db);
}

function parseAnswers(value: string | undefined): Record<string, string> {
    if (!value) return {};

    const answers: Record<string, string> = {};
    for (const pair of value.split(",")) {
        const [questionId, answerId] = pair.split(":").map(item => item.trim());
        if (questionId && answerId) {
            answers[questionId] = answerId;
        }
    }

    return answers;
}

function formatEndpointLabel(endpointId: string): string {
    const match = endpointId.match(/^api:([A-Z]+):(\/.*)$/i);

    if (!match) {
        return endpointId;
    }

    return `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`.trim();
}

function formatNodeLabel(item: RenderableNode): string {
    const file = item.file ? `\n  - File: ${item.file}` : "";

    return `**${item.id}** [score=${item.score}]${file}\n  - Evidence: ${item.reason}`;
}

function renderIntent(payload: TicketRenderPayload): string[] {
    return [
        "## Extracted Intent",
        toBulletList([
            `Actions: ${payload.intent.actions.length === 0 ? "none" : payload.intent.actions.join(", ")}`,
            `Entities: ${payload.intent.entities.length === 0 ? "none" : payload.intent.entities.join(", ")}`,
            `Statuses: ${payload.intent.statuses.length === 0 ? "none" : payload.intent.statuses.join(", ")}`,
            `Sources: ${payload.intent.sources.length === 0 ? "none" : payload.intent.sources.join(", ")}`,
            `Fields: ${payload.intent.fields.length === 0 ? "none" : payload.intent.fields.join(", ")}`,
            `Primary workflow: ${payload.workflow.type} (${payload.workflow.confidence})`,
        ]),
        "",
    ];
}

function renderClaims(payload: TicketRenderPayload): string[] {
    const fromTicket = payload.claims.fromTicket.map(item => item);
    const codeHints = payload.claims.codeHints.map(hint => {
        const file = hint.file ? ` (${hint.file})` : "";
        return `${hint.id}${file} — ${hint.reason}`;
    });
    const notFound = payload.claims.notFoundInGraph;
    const doNotStart = payload.claims.doNotStartHere.map(item => `${item.id} — ${item.reason}`);

    return [
        "## From Ticket",
        fromTicket.length === 0 ? "- None" : toBulletList(fromTicket),
        "",
        "## Code Hints (unverified)",
        codeHints.length === 0 ? "- None" : toBulletList(codeHints),
        "",
        "## Not Found In Graph",
        notFound.length === 0 ? "- None" : toBulletList(notFound),
        "",
        "## Do Not Start Here",
        doNotStart.length === 0 ? "- None" : toBulletList(doNotStart),
        "",
    ];
}

function renderFieldLayers(payload: TicketRenderPayload): string[] {
    if (payload.claims.fieldStatuses.length === 0) {
        return [];
    }

    const lines = payload.claims.fieldStatuses.map(status =>
        `${status.field}: ${status.summary}`
    );

    return [
        "## Field Verification",
        toBulletList(lines),
        "",
    ];
}

function getLikelyInvestigationTargets(payload: TicketRenderPayload): RenderableNode[] {
    return payload.investigationTargets;
}

function renderTopTargets(payload: TicketRenderPayload): string[] {
    const targets = getLikelyInvestigationTargets(payload);

    return [
        "## Recommended Investigation Order",
        targets.length === 0
            ? "- None"
            : toBulletList(targets.map(formatNodeLabel)),
        "",
    ];
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;

    return `${value.slice(0, maxLength).trim()}...`;
}

function renderCompactFlow(payload: TicketRenderPayload): string[] {
    const importantIds = new Set(
        getLikelyInvestigationTargets(payload).map(item => item.id)
    );

    const importantFlows = payload.relatedFlows
        .filter(flow => importantIds.has(flow.from) || importantIds.has(flow.to))
        .slice(0, 12);

    const lines = importantFlows.map(flow => formatFlowLine(flow));

    return [
        "## Supporting Flow Evidence",
        lines.length === 0 ? "- None" : toBulletList(lines),
        "",
    ];
}

function formatFlowLine(flow: TicketAnalyzerResult["relatedFlows"][number]): string {
    const via = flow.via ? ` via ${flow.via}` : "";
    const arg = flow.argumentIndex !== null && flow.argumentIndex !== undefined
        ? ` arg#${flow.argumentIndex}`
        : "";
    const confidence = flow.confidence !== null && flow.confidence !== undefined
        ? ` confidence=${flow.confidence}`
        : "";

    return `${flow.from} -> ${flow.to} [${flow.type}${via}${arg}${confidence}]`;
}

function renderRawNodeMatches(
    title: string,
    items: RenderableNode[]
): string[] {
    return [
        `### ${title}`,
        items.length === 0
            ? "- None"
            : toBulletList(items.map(formatNodeLabel)),
        "",
    ];
}

function renderRawEndpointMatches(
    items: TicketAnalyzerResult["matchedEndpoints"]
): string[] {
    const endpointLines = items.map(endpoint => {
        const file = endpoint.file ? ` (${endpoint.file})` : "";
        return `${formatEndpointLabel(endpoint.id)}${file} [score=${endpoint.score}] - ${endpoint.reason}`;
    });

    return [
        "### Matched Endpoints",
        endpointLines.length === 0 ? "- None" : toBulletList(endpointLines),
        "",
    ];
}

function renderMarkdown(payload: TicketRenderPayload): string {
    const flowLines = payload.relatedFlows.map(flow => formatFlowLine(flow));

    const suggestedFileLines = payload.suggestedFiles.map(file => {
        return `${file.file} [score=${file.score}]`;
    });

    const aiContextHints = payload.suggestedFiles
        .slice(0, 3)
        .map(file => `Open ${file.file} and inspect the matched flow edges.`);

    return [
        "# Ticket Analysis",
        "",
        "## Summary",
        `- Navigation confidence: ${payload.navigationConfidence}`,
        `- Implementation confidence: ${payload.implementationConfidence}`,
        `- Primary workflow: ${payload.workflow.type} (${payload.workflow.confidence})`,
        `- Source: ${payload.ticketSource}`,
        `- Matched methods: ${payload.matchedMethods.length}`,
        `- Matched fields: ${payload.matchedRequestFields.length}`,
        `- Matched endpoints: ${payload.matchedEndpoints.length}`,
        `- Related flow edges: ${payload.relatedFlows.length}`,
        "",
        "## Ticket Preview",
        truncateText(payload.query || "(empty)", 1200),
        "",
        ...renderIntent(payload),
        ...renderClaims(payload),
        ...renderFieldLayers(payload),
        ...renderTopTargets(payload),
        "## Implementation Hints",
        payload.implementationHints.length === 0
            ? "- None"
            : toBulletList(payload.implementationHints),
        "",
        ...renderCompactFlow(payload),
        "## Suggested Files",
        suggestedFileLines.length === 0 ? "- None" : toBulletList(suggestedFileLines),
        "",
        "## Next Step",
        aiContextHints.length === 0 ? "- None" : toBulletList(aiContextHints),
        "",
        "---",
        "",
        "## Raw Matches / Evidence",
        "",
        ...renderRawNodeMatches("Matched Methods", payload.matchedMethods),
        ...renderRawNodeMatches("Matched Fields", payload.matchedRequestFields),
        ...renderRawEndpointMatches(payload.matchedEndpoints),
        "### Full Related Data / Call Flow",
        flowLines.length === 0 ? "- None" : toBulletList(flowLines),
        "",
        "## Extracted Tokens",
        payload.tokens.length === 0 ? "- None" : toBulletList(payload.tokens),
        "",
        "## Extracted Field Terms",
        payload.fieldTerms.length === 0
            ? "- None"
            : toBulletList(payload.fieldTerms),
        "",
        "## Missing Field Terms",
        payload.missingFieldTerms.length === 0
            ? "- None"
            : toBulletList(payload.missingFieldTerms),
        "",
        "## Debug",
        payload.debug
            ? toBulletList([
                `endpointMatches: ${payload.debug.endpointMatches}`,
                `methodMatches: ${payload.debug.methodMatches}`,
                `fieldMatches: ${payload.debug.fieldMatches}`,
                `flowEdges: ${payload.debug.flowEdges}`,
            ])
            : "- Disabled. Use --debug.",
        "",
    ].join("\n");
}

function renderProbeSummary(result: Extract<TicketSessionStartResult, { status: "needs_input" }>): string {
    const probe = result.session.probe;
    const lines = [
        "# Ticket Analysis — needs input",
        "",
    ];

    if (result.session.phase === "intent") {
        lines.push(
            "## Intent (before graph scan)",
            "Answer these first — graph scan and code ranking run after your choices.",
            ""
        );
    } else if (probe) {
        lines.push(
            "## Probe",
            `- Readiness: ${probe.readinessScore.toFixed(2)}`,
            `- Workflow: ${probe.dominantWorkflow.type} (${probe.dominantWorkflow.confidence})`,
            `- Truncated: ${probe.truncated ? "yes" : "no"}`,
            `- Structural candidates: ${probe.structuralCandidates.length}`,
            `- Graph scopes loaded: ${probe.graphCoverage.filter(item => item.loaded).map(item => item.scope).join(", ") || "none"}`,
            ""
        );
    }

    lines.push(
        "## Resolved so far",
        ...Object.entries(result.session.resolved)
            .filter(([key, value]) => key !== "scopes" && value !== undefined)
            .map(([key, value]) => `- ${key}: ${String(value)}`),
        "",
        "## Questions",
    );

    for (const question of result.questions) {
        lines.push(`### ${question.id}`);
        lines.push(question.prompt);
        if (question.guidance) {
            lines.push(`Tip: ${question.guidance}`);
        }
        lines.push(`Reason: ${question.reason}`);
        if (question.options.length > 0) {
            lines.push(toBulletList(question.options.map((option, index) =>
                `${index + 1}. [${option.id}] ${option.label}`
            )));
        }
        lines.push("");
    }

    lines.push("Rerun with answers, e.g. `--answers=ticket_topic:ui,change_includes:mixed`, or use `--non-interactive` to infer automatically.");
    return lines.join("\n");
}

const STRONG_INTENT_SUGGESTION_CONFIDENCE = 0.85;

function formatStrongIntentSuggestion(question: TicketQuestion): string | undefined {
    if (question.id !== "ticket_topic") {
        return undefined;
    }

    const first = question.options[0];
    if (!first || first.id === "unsure" || first.id === "mixed") {
        return undefined;
    }

    const confidenceMatch = first.label.match(/\((\d+(?:\.\d+)?)\)\s*$/);
    const confidence = confidenceMatch ? Number(confidenceMatch[1]) : 0;
    if (confidence < STRONG_INTENT_SUGGESTION_CONFIDENCE) {
        return undefined;
    }

    const label = first.label.replace(/\s*\(\d+(?:\.\d+)?\)\s*$/, "");
    return `Suggested: ${label} (${confidence}). Press 1 to confirm, Enter to stay unsure.`;
}

async function promptForAnswers(
    questions: TicketQuestion[],
    options?: { showIntentIntro?: boolean }
): Promise<Record<string, string>> {
    const rl = readline.createInterface({ input, output });
    const answers: Record<string, string> = {};

    try {
        if (options?.showIntentIntro) {
            console.log(`\n${INTENT_SESSION_INTRO}\n`);
        }

        for (const question of questions) {
            console.log(`\n${question.prompt}`);
            if (question.guidance) {
                console.log(`Tip: ${question.guidance}`);
            }
            console.log(`Reason: ${question.reason}`);

            if (question.options.length === 0) {
                continue;
            }

            question.options.forEach((option, index) => {
                console.log(`  ${index + 1}. [${option.id}] ${option.label}`);
            });

            const hasUnsure = question.options.some(option => option.id === "unsure");
            const strongSuggestion = formatStrongIntentSuggestion(question);
            if (strongSuggestion) {
                console.log(strongSuggestion);
            }

            const promptLabel = hasUnsure
                ? "Choose option number or id (Enter = unsure): "
                : "Choose option number or id: ";
            const raw = (await rl.question(promptLabel)).trim();

            if (!raw && hasUnsure) {
                answers[question.id] = "unsure";
                continue;
            }

            const byIndex = Number(raw);
            if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= question.options.length) {
                answers[question.id] = question.options[byIndex - 1]!.id;
                continue;
            }

            const matched = question.options.find(option => option.id === raw);
            answers[question.id] = matched?.id ?? raw;
        }
    } finally {
        await rl.close();
    }

    return answers;
}

async function runSessionFlow(db: Database): Promise<string> {
    const ticketText = resolveTicketText();
    const scopes = parseScopes(scopesArg, db);
    const presetAnswers = parseAnswers(getOptionValue(args, "--answers"));

    let result = startTicketSession(db, {
        ticketText,
        scopes,
        answers: presetAnswers,
        limit,
        includeDebug,
    });

    while (result.status === "needs_input") {
        if (!interactive) {
            const autoAnswers: Record<string, string> = {};

            if (
                result.session.phase === "intent" &&
                !hasIntentAnswers({ ...presetAnswers, ...result.session.answers })
            ) {
                Object.assign(autoAnswers, inferIntentAnswers(result.session.ticketText));
            }

            Object.assign(
                autoAnswers,
                inferAutoAnswersForQuestions(
                    result.questions ?? [],
                    result.session.probe,
                    result.session.ticketText
                )
            );

            const newAnswers = Object.fromEntries(
                Object.entries(autoAnswers).filter(
                    ([questionId, answerId]) =>
                        answerId && result.session.answers[questionId] === undefined
                )
            );

            if (Object.keys(newAnswers).length === 0) {
                return renderProbeSummary(result);
            }

            result = continueTicketSession(db, result.session, newAnswers, {
                limit,
                includeDebug,
            });
            continue;
        }

        const answers = await promptForAnswers(result.questions, {
            showIntentIntro: result.session.phase === "intent",
        });

        result = continueTicketSession(db, result.session, answers, {
            limit,
            includeDebug,
        });

        if (result.status === "needs_input" && answers.truncated_ack === "no") {
            return renderProbeSummary(result);
        }
    }

    if (result.status !== "ready") {
        return renderProbeSummary(result as Extract<TicketSessionStartResult, { status: "needs_input" }>);
    }

    const payload: TicketRenderPayload = {
        ...result.analysis,
        limit,
        ticketSource: resolveTicketSource(),
    };

    if (fullOutput) {
        return [
            result.briefing.markdown,
            "",
            "---",
            "",
            renderMarkdown(payload),
        ].join("\n");
    }

    return result.briefing.markdown;
}

if (!dbPath) {
    console.log([
        "Usage: npx tsx src/cli/commands/ticket.ts Graph.sqlite [options]",
        "",
        "Ticket source:",
        "  --ticket=path        Path to ticket text file (e.g. tickets/my-ticket.txt)",
        "",
        "Session (interactive by default; briefing-only output unless --full):",
        "  --scopes=php,js      Graph scopes (auto-detects js when graph has Vue/JS nodes)",
        "  --non-interactive    Infer intent and skip prompts (also --auto)",
        "  --answers=q:id,...   Pre-fill answers (works with either mode)",
        "  --full               Briefing + detailed analysis (raw matches, evidence)",
        "  --legacy             Skip session; run analyzeTicket directly",
        "",
        "Other:",
        "  --limit=5  --json  --debug  --output=report.md",
    ].join("\n"));
    process.exit(2);
}

const ticketText = resolveTicketText();

if (ticketText.trim().length === 0) {
    console.log("No ticket file provided. Use --ticket=tickets/my-ticket.txt");
    process.exit(2);
}

const db = new Database(dbPath);

async function main(): Promise<void> {
    try {
        if (legacy) {
            const analyzerOptions: TicketAnalyzerOptions = { limit, includeDebug };
            const result = analyzeTicket(db, ticketText, analyzerOptions);
            const payload: TicketRenderPayload = {
                ...result,
                limit,
                ticketSource: resolveTicketSource(),
            };

            if (jsonOutput) {
                const outputJson = JSON.stringify(payload, null, 2);
                console.log(outputJson);
                if (outputPath) fs.writeFileSync(outputPath, outputJson, "utf8");
                return;
            }

            const markdown = renderMarkdown(payload);
            console.log(markdown);
            if (outputPath) fs.writeFileSync(outputPath, markdown, "utf8");
            return;
        }

        const markdown = await runSessionFlow(db);

        if (jsonOutput) {
            console.log(JSON.stringify({ markdown }, null, 2));
            if (outputPath) fs.writeFileSync(outputPath, JSON.stringify({ markdown }, null, 2), "utf8");
            return;
        }

        console.log(markdown);
        if (outputPath) fs.writeFileSync(outputPath, markdown, "utf8");
    } finally {
        db.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
