import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatIntentForEnrichment } from "./ticketIntent";
import { applyQuestionAnswer, mergeResolved } from "./ticketQuestions";
import { collapseReadFirstByFile, findStrongUiReadFirstCandidates } from "./ticketBriefing";
import { filterFlowPathsForBriefing } from "./ticketFlowPaths";

const projectRoot = path.resolve(__dirname, "../../..");

function testUnsureEnrichmentIsNeutral(): void {
    const lines = formatIntentForEnrichment({
        scopes: ["php"],
        confirmedTopic: "unsure",
        changeIncludes: "unsure",
    });

    const joined = lines.join("\n").toLowerCase();
    assert.ok(!/\bqueue\b/.test(joined));
    assert.ok(!/\blistener\b/.test(joined));
    assert.ok(lines.some(line => line.includes("no workflow boost applied")));
    assert.ok(lines.some(line => line.includes("no scope boost applied")));
}

function testUnsureClearsAutoLockedWorkflow(): void {
    const base = mergeResolved({
        autoResolved: {
            scopes: ["php"],
            lockedWorkflow: "queue",
            implementationMode: "extend_existing",
        },
        readinessScore: 0.5,
        readinessReasons: [],
        dominantWorkflow: { type: "queue", confidence: 0.8, score: 1, reasons: [], secondary: [] },
        truncated: false,
        structuralCandidates: [],
        infrastructureGaps: [],
        fieldStatuses: [],
        graphCoverage: [{ scope: "php", nodeCount: 1, edgeCount: 1, loaded: true }],
    });

    const next = applyQuestionAnswer(
        applyQuestionAnswer(base, "ticket_topic", "unsure"),
        "change_includes",
        "unsure"
    );

    assert.equal(next.lockedWorkflow, undefined);
    assert.equal(next.implementationMode, undefined);
    assert.equal(next.confirmedTopic, "unsure");
}

function testStrongUiPromotion(): void {
    const ticket = fs.readFileSync(path.join(projectRoot, "tickets/new-real.txt"), "utf8");
    const candidates = [
        {
            id: "integration:SpOTTBackend\\Jobs\\Content\\ProcessExpiredVodObjectJob:queue_listener",
            file: "apps/spott-backend/app/Jobs/Content/ProcessExpiredVodObjectJob.php",
            score: 90,
            reason: "Matched token(s): content, event, queue",
        },
        {
            id: "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser",
            file: "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
            score: 42,
            reason: "Matched vue component token(s): hero, teaser",
        },
        {
            id: "js:apps/spott-frontend/resources/assets/js/tailwind/Atoms/EventBasedList/CallToAction.vue::CallToAction",
            file: "apps/spott-frontend/resources/assets/js/tailwind/Atoms/EventBasedList/CallToAction.vue",
            score: 20,
            reason: "Matched vue component token(s): action",
        },
    ];

    const promoted = findStrongUiReadFirstCandidates(ticket, candidates, [
        {
            path: "index.vue::HeroTeaser",
            complete: false,
            gap: "No HTTP_REQUEST edge from this component",
        },
    ], { intentOpen: true, workflowType: "queue" });

    assert.ok(promoted.length > 0);
    assert.match(promoted[0]!.id, /heroTeaser/i);
    assert.ok(!promoted.some(item => /ProcessExpiredVodObjectJob/i.test(item.id)));
}

function testCollapseReadFirstByFile(): void {
    const collapsed = collapseReadFirstByFile([
        {
            id: "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser",
            file: "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
            reason: "component",
        },
        {
            id: "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser@prop:description",
            file: "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
            reason: "prop",
        },
        {
            id: "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser::setup",
            file: "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
            reason: "setup",
        },
        {
            id: "js:apps/spott-frontend/resources/assets/js/tailwind/Atoms/EventBasedList/CallToAction.vue::CallToAction",
            file: "apps/spott-frontend/resources/assets/js/tailwind/Atoms/EventBasedList/CallToAction.vue",
            reason: "cta",
        },
    ], 5);

    assert.equal(collapsed.length, 2);
    assert.match(collapsed[0]!.id, /::HeroTeaser$/);
    assert.match(collapsed[1]!.id, /CallToAction$/);
}

function testFilterFlowPathsForBriefing(): void {
    const ticket = fs.readFileSync(path.join(projectRoot, "tickets/fe-new.txt"), "utf8");
    const filtered = filterFlowPathsForBriefing([
        {
            path: "index.vue::HeroTeaser",
            complete: false,
            gap: "No HTTP_REQUEST edge from this component",
        },
        {
            path: "CallToAction.vue::CallToAction",
            complete: false,
            gap: "No HTTP_REQUEST edge from this component",
        },
        {
            path: "GET /users → UserController::index",
            complete: true,
        },
        {
            path: "GET /admin-audits/api-names → AdminAuditSearchController::getApiNames",
            complete: true,
        },
    ], {
        ticketText: ticket,
        workflowType: "ui",
        seedNodeIds: [
            "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser",
        ],
        seedFiles: [
            "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
        ],
    }, 5);

    assert.ok(filtered.some(item => /HeroTeaser/i.test(item.path)));
    assert.ok(filtered.some(item => /CallToAction/i.test(item.path)));
    assert.ok(!filtered.some(item => /UserController/i.test(item.path)));
    assert.ok(!filtered.some(item => /AdminAuditSearchController/i.test(item.path)));
}

function run(): void {
    console.log("ticketBriefing tests\n");

    testUnsureEnrichmentIsNeutral();
    console.log("  ✓ unsure enrichment is neutral");

    testUnsureClearsAutoLockedWorkflow();
    console.log("  ✓ unsure clears auto locked workflow");

    testStrongUiPromotion();
    console.log("  ✓ strong ui promotion");

    testCollapseReadFirstByFile();
    console.log("  ✓ collapse read first by file");

    testFilterFlowPathsForBriefing();
    console.log("  ✓ filter flow paths for briefing");

    console.log("\nAll ticket briefing tests passed.");
}

run();
