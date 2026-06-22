import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { buildIntentQuestions, hasIntentAnswers, previewTicketIntent } from "./ticketIntent";
import { applyQuestionAnswer, autoExpandScopesForUiTicket, buildFollowUpQuestions, inferAutoAnswersForQuestions, isSessionReady, mergeResolved } from "./ticketQuestions";
import { startTicketSession, continueTicketSession } from "./ticketSession";
import { formatIntentForEnrichment } from "./ticketIntent";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");

function readTicket(name: string): string {
    return fs.readFileSync(path.join(projectRoot, "tickets", name), "utf8");
}

function testIntentQuestionsBeforeScan(): void {
    const ticket = readTicket("real-ticket.txt");
    const questions = buildIntentQuestions(ticket);

    assert.ok(questions.some(question => question.id === "ticket_topic"));
    assert.ok(questions.some(question => question.id === "change_includes"));

    const topic = questions.find(question => question.id === "ticket_topic")!;
    assert.ok(topic.options.some(option => option.id === "queue" || option.id === "mixed"));
    assert.ok(topic.options.some(option => /sqs|queue|api|archive/i.test(option.label)));

    const includes = questions.find(question => question.id === "change_includes")!;
    assert.ok(includes.options.some(option => option.id === "queue_job"));
    assert.ok(includes.options.some(option => option.id === "api_field" || option.id === "cms_ui"));
    assert.ok(includes.options.some(option => option.id === "unsure"));
    assert.ok(includes.options.some(option => option.id === "mixed"));
    assert.ok(topic.guidance?.includes("mixed"));
    assert.ok(includes.guidance?.includes("unsure"));
}

function testStartSessionAsksIntentFirst(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping intent-first test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = startTicketSession(db, {
            ticketText: readTicket("real-ticket.txt"),
            limit: 5,
        });

        assert.equal(result.status, "needs_input");
        assert.equal(result.session.phase, "intent");
        assert.equal(result.session.probe, undefined);
        assert.ok(result.questions.some(question => question.id === "ticket_topic"));
        assert.ok(result.questions.some(question => question.id === "change_includes"));
    } finally {
        db.close();
    }
}

function testMergeResolved(): void {
    const probe = {
        autoResolved: {
            lockedWorkflow: "queue" as const,
            implementationMode: "extend_existing" as const,
            scopes: ["php" as const],
        },
        readinessScore: 0.8,
        readinessReasons: [],
        dominantWorkflow: {
            type: "queue" as const,
            confidence: 0.9,
            score: 1,
            reasons: [],
            secondary: [],
        },
        truncated: false,
        structuralCandidates: [],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: [{ scope: "php" as const, nodeCount: 1, edgeCount: 1, loaded: true }],
    };

    const merged = mergeResolved(probe, { surfaceScope: "backend_api" });
    assert.equal(merged.implementationMode, "extend_existing");
    assert.equal(merged.surfaceScope, "backend_api");
}

function testIntentAnswersUnlockScan(): void {
    const resolved = applyQuestionAnswer(
        { scopes: ["php"] },
        "ticket_topic",
        "queue"
    );
    const withIncludes = applyQuestionAnswer(resolved, "change_includes", "mixed");

    assert.equal(withIncludes.confirmedTopic, "queue");
    assert.equal(withIncludes.changeIncludes, "mixed");
    assert.equal(withIncludes.intentConfirmed, true);
    assert.ok(hasIntentAnswers({ ticket_topic: "queue", change_includes: "mixed" }));
}

function testTruncatedTicketNeedsInputAfterScan(): void {
    const probe = {
        autoResolved: { scopes: ["php" as const] },
        readinessScore: 0.4,
        readinessReasons: ["Ticket appears truncated"],
        dominantWorkflow: {
            type: "queue" as const,
            confidence: 0.8,
            score: 1,
            reasons: [],
            secondary: [],
        },
        truncated: true,
        structuralCandidates: [{ id: "x", type: "integration_entrypoint", file: null, role: "sqs_consumer", reason: "" }],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: [{ scope: "php" as const, nodeCount: 1, edgeCount: 1, loaded: true }],
    };

    const resolved = mergeResolved(probe, {
        intentConfirmed: true,
        confirmedTopic: "queue",
        changeIncludes: "queue_job",
    });
    assert.equal(isSessionReady(probe, resolved), false);

    const questions = buildFollowUpQuestions("text...", probe, resolved, probe.graphCoverage);
    assert.ok(questions.some(question => question.id === "truncated_ack"));
}

function testApplyFrontendScopeAnswer(): void {
    const base = mergeResolved({
        autoResolved: { scopes: ["php"] },
        readinessScore: 0.5,
        readinessReasons: [],
        dominantWorkflow: { type: "api", confidence: 0.9, score: 1, reasons: [], secondary: [] },
        truncated: false,
        structuralCandidates: [],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: [{ scope: "php", nodeCount: 1, edgeCount: 1, loaded: true }],
    });

    const next = applyQuestionAnswer(base, "include_frontend_scope", "yes");
    assert.ok(next.scopes.includes("js"));
}

function testAutoExpandScopesForUiTicket(): void {
    const coverage = [
        { scope: "php" as const, nodeCount: 1, edgeCount: 1, loaded: true },
        { scope: "js" as const, nodeCount: 100, edgeCount: 50, loaded: false },
    ];

    const resolved = mergeResolved({
        autoResolved: { scopes: ["php"] },
        readinessScore: 0.5,
        readinessReasons: [],
        dominantWorkflow: { type: "ui", confidence: 0.9, score: 1, reasons: [], secondary: [] },
        truncated: false,
        structuralCandidates: [],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: coverage,
    });

    const expanded = autoExpandScopesForUiTicket(resolved, coverage, "update hero component in CMS");
    assert.deepEqual(expanded.scopes, ["php", "js"]);
}

function testInferAutoAnswersForQuestions(): void {
    const probe = {
        autoResolved: { scopes: ["php"] },
        readinessScore: 0.5,
        readinessReasons: [],
        dominantWorkflow: { type: "ui" as const, confidence: 0.9, score: 1, reasons: [], secondary: [] },
        truncated: true,
        structuralCandidates: [],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: [{ scope: "php" as const, nodeCount: 1, edgeCount: 1, loaded: true }],
    };

    const answers = inferAutoAnswersForQuestions(
        [
            {
                id: "truncated_ack",
                prompt: "truncated?",
                options: [
                    { id: "yes", label: "Yes" },
                    { id: "no", label: "No" },
                ],
                reason: "test",
                guidance: "test",
                required: true,
            },
            {
                id: "missing_js_graph",
                prompt: "missing js?",
                options: [
                    { id: "continue", label: "Continue" },
                    { id: "stop", label: "Stop" },
                ],
                reason: "test",
                guidance: "test",
                required: true,
            },
        ],
        probe,
        "update CMS component"
    );

    assert.equal(answers.truncated_ack, "yes");
    assert.equal(answers.missing_js_graph, "continue");
}

function testUnsureHeroTicketStaysNeutral(): void {
    const lines = formatIntentForEnrichment({
        scopes: ["php", "js"],
        confirmedTopic: "unsure",
        changeIncludes: "unsure",
    });

    assert.ok(!lines.join("\n").toLowerCase().includes("queue"));

    if (!fs.existsSync(sqlitePath) || !fs.existsSync(path.join(projectRoot, "tickets/new-real.txt"))) {
        console.log("  ↷ Skipping unsure hero integration — sqlite or ticket missing");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });
    const ticket = readTicket("new-real.txt");

    try {
        let result = startTicketSession(db, { ticketText: ticket, limit: 5 });
        result = continueTicketSession(
            db,
            result.session,
            { ticket_topic: "unsure", change_includes: "unsure" },
            { limit: 5 }
        );

        assert.equal(result.status, "ready");
        assert.equal(result.session.resolved.lockedWorkflow, undefined);
        assert.equal(result.session.resolved.implementationMode, undefined);
        assert.match(result.briefing!.markdown, /heroTeaser|HeroTeaser/i);
    } finally {
        db.close();
    }
}

function testSessionReadyOnRealTicket(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping session integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });
    const ticket = readTicket("real-ticket.txt");
    const preview = previewTicketIntent(ticket);

    try {
        const result = startTicketSession(db, {
            ticketText: ticket,
            limit: 5,
            answers: {
                ticket_topic: preview.dominantWorkflow.type,
                change_includes: "mixed",
            },
        });

        if (result.status === "needs_input") {
            const followUpAnswers: Record<string, string> = { truncated_ack: "yes" };

            for (const question of result.questions ?? []) {
                if (question.id === "implementation_mode") {
                    followUpAnswers.implementation_mode = "extend_existing";
                }
            }

            const answered = continueTicketSession(db, result.session, followUpAnswers, { limit: 5 });
            assert.equal(answered.status, "ready");
            assert.ok(answered.briefing!.readFirst.length > 0);
            assert.match(answered.briefing!.markdown, /ExpiredVod|ProcessExpiredVod/i);
            return;
        }

        assert.equal(result.status, "ready");
        assert.ok(result.briefing.readFirst.length > 0);
        assert.match(result.briefing.markdown, /User intent/);
    } finally {
        db.close();
    }
}

function run(): void {
    console.log("ticketSession tests\n");

    testIntentQuestionsBeforeScan();
    console.log("  ✓ intent questions before scan");

    testStartSessionAsksIntentFirst();
    console.log("  ✓ start session asks intent first");

    testMergeResolved();
    console.log("  ✓ merge resolved");

    testIntentAnswersUnlockScan();
    console.log("  ✓ intent answers unlock scan");

    testTruncatedTicketNeedsInputAfterScan();
    console.log("  ✓ truncated ticket needs input after scan");

    testApplyFrontendScopeAnswer();
    console.log("  ✓ frontend scope answer");

    testAutoExpandScopesForUiTicket();
    console.log("  ✓ auto expand scopes for ui ticket");

    testInferAutoAnswersForQuestions();
    console.log("  ✓ infer auto answers for questions");

    testUnsureHeroTicketStaysNeutral();
    console.log("  ✓ unsure hero ticket stays neutral");

    testSessionReadyOnRealTicket();
    console.log("  ✓ session on real ticket");

    console.log("\nAll ticket session tests passed.");
}

run();
