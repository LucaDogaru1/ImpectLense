import Database from "better-sqlite3";
import { analyzeTicket, TicketAnalyzerOptions, TicketAnalyzerResult } from "./ticketAnalyzerV3";
import { buildTicketBriefing } from "./ticketBriefing";
import {
    buildIntentQuestions,
    formatIntentForEnrichment,
    hasIntentAnswers,
    inferIntentAnswers,
} from "./ticketIntent";
import { loadTicketGraphContext, type TicketGraphContext } from "./ticketGraphContext";
import { probeTicket } from "./ticketProbe";
import {
    applyQuestionAnswer,
    autoExpandScopesForUiTicket,
    buildFollowUpQuestions,
    isSessionReady,
    mergeResolved,
} from "./ticketQuestions";
import {
    GraphScope,
    TicketSessionContinueResult,
    TicketSessionInput,
    TicketSessionResolved,
    TicketSessionStartResult,
    TicketSessionState,
} from "./ticketSessionTypes";

type SQLiteDatabase = InstanceType<typeof Database>;

function enrichTicketForAnalysis(
    ticketText: string,
    resolved: TicketSessionResolved
): string {
    const lines: string[] = [
        ...formatIntentForEnrichment(resolved),
    ];

    if (resolved.lockedWorkflow) {
        lines.push(`Confirmed primary workflow: ${resolved.lockedWorkflow}.`);
    }

    if (resolved.implementationMode === "extend_existing") {
        lines.push("This extends existing infrastructure; prefer existing listeners/jobs/services.");
    } else if (resolved.implementationMode === "net_new") {
        lines.push("This is net-new infrastructure unless graph proves otherwise.");
    }

    if (resolved.surfaceScope === "cms_ui") {
        lines.push("Primary surface: CMS/admin UI.");
    } else if (resolved.surfaceScope === "public_frontend") {
        lines.push("Primary surface: public UI layer.");
    } else if (resolved.surfaceScope === "full_stack") {
        lines.push("Primary surface: API and UI together.");
    }

    if (resolved.truncatedAcknowledged) {
        lines.push("Analyzer may proceed despite truncated source ticket.");
    }

    if (lines.length === 0) {
        return ticketText;
    }

    return `${ticketText.trim()}\n\nSession clarifications:\n${lines.map(line => `- ${line}`).join("\n")}`;
}

function runFinalAnalysis(
    db: SQLiteDatabase,
    session: TicketSessionState,
    graph: TicketGraphContext,
    options?: Pick<TicketAnalyzerOptions, "limit" | "includeDebug">
): { analysis: TicketAnalyzerResult; briefing: ReturnType<typeof buildTicketBriefing> } {
    const enrichedTicket = enrichTicketForAnalysis(session.ticketText, session.resolved);
    const analysis = analyzeTicket(db, enrichedTicket, {
        limit: options?.limit ?? 5,
        includeDebug: options?.includeDebug,
        graph,
    });
    const briefing = buildTicketBriefing(analysis, session.probe!, session.resolved);

    return { analysis, briefing };
}

function buildSessionState(
    ticketText: string,
    scopes: GraphScope[],
    answers: Record<string, string>,
    round: number,
    phase: TicketSessionState["phase"],
    probe?: ReturnType<typeof probeTicket>
): TicketSessionState {
    let resolved: TicketSessionResolved = mergeResolved(
        probe ?? {
            autoResolved: { scopes },
            readinessScore: 0,
            readinessReasons: [],
            dominantWorkflow: {
                type: "unknown",
                confidence: 0,
                score: 0,
                reasons: [],
                secondary: [],
            },
            truncated: false,
            structuralCandidates: [],
            infrastructureGaps: [],
            fieldStatuses: [],
            graphCoverage: [{ scope: "php", nodeCount: 0, edgeCount: 0, loaded: false }],
        },
        { scopes }
    );

    for (const [questionId, answerId] of Object.entries(answers)) {
        resolved = applyQuestionAnswer(resolved, questionId, answerId);
    }

    return {
        ticketText,
        scopes: resolved.scopes,
        resolved,
        answers,
        phase,
        probe,
        round,
    };
}

function runScanPhase(
    db: SQLiteDatabase,
    ticketText: string,
    scopes: GraphScope[],
    answers: Record<string, string>,
    round: number,
    graph?: TicketGraphContext,
    options?: Pick<TicketAnalyzerOptions, "limit" | "includeDebug">
): TicketSessionStartResult {
    const ctx = graph ?? loadTicketGraphContext(db);
    let session = buildSessionState(
        ticketText,
        scopes,
        answers,
        round,
        "scan",
        probeTicket(
            db,
            enrichTicketForAnalysis(
                ticketText,
                buildSessionState(ticketText, scopes, answers, round, "scan").resolved
            ),
            scopes,
            ctx
        )
    );

    const expanded = autoExpandScopesForUiTicket(
        session.resolved,
        session.probe!.graphCoverage,
        ticketText
    );

    if (expanded.scopes.length !== session.scopes.length) {
        const enrichedText = enrichTicketForAnalysis(ticketText, expanded);
        const probe = probeTicket(db, enrichedText, expanded.scopes, ctx);
        session = {
            ...buildSessionState(ticketText, expanded.scopes, answers, round, "scan", probe),
            resolved: expanded,
            scopes: expanded.scopes,
        };
    }

    const probe = session.probe!;

    if (isSessionReady(probe, session.resolved)) {
        const { analysis, briefing } = runFinalAnalysis(db, session, ctx, options);
        return { status: "ready", session, analysis, briefing };
    }

    const questions = buildFollowUpQuestions(
        ticketText,
        probe,
        session.resolved,
        probe.graphCoverage
    );

    if (questions.length === 0) {
        const { analysis, briefing } = runFinalAnalysis(db, session, ctx, options);
        return { status: "ready", session, analysis, briefing };
    }

    return { status: "needs_input", session, questions };
}

export function startTicketSession(
    db: SQLiteDatabase,
    input: TicketSessionInput
): TicketSessionStartResult {
    const scopes = input.scopes ?? ["php"];
    let answers = { ...(input.answers ?? {}) };

    if (!input.skipIntent && !hasIntentAnswers(answers)) {
        const questions = buildIntentQuestions(input.ticketText);
        const session = buildSessionState(input.ticketText, scopes, answers, 0, "intent");

        return { status: "needs_input", session, questions };
    }

    if (input.skipIntent && !hasIntentAnswers(answers)) {
        answers = { ...answers, ...inferIntentAnswers(input.ticketText) };
    }

    const graph = loadTicketGraphContext(db);
    return runScanPhase(db, input.ticketText, scopes, answers, 1, graph, input);
}

export function continueTicketSession(
    db: SQLiteDatabase,
    session: TicketSessionState,
    newAnswers: Record<string, string>,
    options?: Pick<TicketAnalyzerOptions, "limit" | "includeDebug"> & { graph?: TicketGraphContext }
): TicketSessionContinueResult {
    const mergedAnswers = { ...session.answers, ...newAnswers };

    if (session.phase === "intent") {
        const nextSession = buildSessionState(
            session.ticketText,
            session.scopes,
            mergedAnswers,
            session.round + 1,
            "intent"
        );

        if (!hasIntentAnswers(mergedAnswers)) {
            const questions = buildIntentQuestions(session.ticketText).filter(
                question => !mergedAnswers[question.id]
            );

            if (questions.length > 0) {
                return { status: "needs_input", session: nextSession, questions };
            }
        }

        const ctx = options?.graph ?? loadTicketGraphContext(db);
        return runScanPhase(
            db,
            session.ticketText,
            session.scopes,
            mergedAnswers,
            nextSession.round,
            ctx,
            options
        );
    }

    const ctx = options?.graph ?? loadTicketGraphContext(db);
    const nextSession = buildSessionState(
        session.ticketText,
        session.scopes,
        mergedAnswers,
        session.round + 1,
        "scan",
        session.probe
    );

    if (newAnswers.truncated_ack === "no") {
        return {
            status: "needs_input",
            session: nextSession,
            questions: [
                {
                    id: "truncated_ack",
                    prompt: "Paste the full ticket and rerun analyze:ticket.",
                    options: [],
                    reason: "Analysis paused until full ticket text is available.",
                    required: true,
                },
            ],
        };
    }

    if (isSessionReady(nextSession.probe!, nextSession.resolved)) {
        const { analysis, briefing } = runFinalAnalysis(db, nextSession, ctx, options);
        return { status: "ready", session: nextSession, analysis, briefing };
    }

    const questions = buildFollowUpQuestions(
        nextSession.ticketText,
        nextSession.probe!,
        nextSession.resolved,
        nextSession.probe!.graphCoverage
    );

    if (questions.length === 0) {
        const { analysis, briefing } = runFinalAnalysis(db, nextSession, ctx, options);
        return { status: "ready", session: nextSession, analysis, briefing };
    }

    return { status: "needs_input", session: nextSession, questions };
}

export { enrichTicketForAnalysis };
