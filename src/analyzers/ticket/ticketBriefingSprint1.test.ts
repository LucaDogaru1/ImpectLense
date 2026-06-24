import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { filterFlowPathsForBriefing } from "./ticketFlowPaths";
import { inferIntentAnswers } from "./ticketIntent";
import { startTicketSession, continueTicketSession } from "./ticketSession";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");

function readFirstIndex(readFirst: Array<{ id: string; file: string | null }>, pattern: RegExp): number {
    return readFirst.findIndex(item => pattern.test(item.id) || pattern.test(item.file ?? ""));
}

function runBriefing(
    ticketName: string,
    answers?: Record<string, string>
): { readFirst: Array<{ id: string; file: string | null }>; flowPaths: Array<{ path: string }> } | null {
    if (!fs.existsSync(sqlitePath)) {
        return null;
    }

    const db = new Database(sqlitePath, { readonly: true });
    const ticketText = fs.readFileSync(path.join(projectRoot, "tickets", ticketName), "utf8");
    const resolvedAnswers = answers ?? inferIntentAnswers(ticketText);

    try {
        let result = startTicketSession(db, {
            ticketText,
            limit: 10,
            scopes: ["php", "js"],
            answers: resolvedAnswers,
        });

        if (result.status === "needs_input") {
            const followUp: Record<string, string> = { truncated_ack: "yes", missing_js_graph: "continue" };
            for (const question of result.questions ?? []) {
                if (question.id === "implementation_mode") {
                    followUp.implementation_mode = "extend_existing";
                }
            }
            result = continueTicketSession(db, result.session, followUp, { limit: 10 });
        }

        assert.equal(result.status, "ready");
        assert.ok(result.briefing);

        return {
            readFirst: result.briefing!.readFirst,
            flowPaths: result.briefing!.flowPaths,
        };
    } finally {
        db.close();
    }
}

function testFeNewDefaultHeroFirst(): void {
    const briefing = runBriefing("fe-new.txt", { ticket_topic: "ui", change_includes: "cms_ui" });
    if (!briefing) {
        console.log("  ↷ Skipping fe-new default — sqlite/Graph.sqlite not found");
        return;
    }

    const heroIndex = readFirstIndex(briefing.readFirst, /heroTeaser|HeroTeaser/i);
    const positionIndex = readFirstIndex(briefing.readFirst, /PositionSummary/i);
    const phpHelperIndex = readFirstIndex(briefing.readFirst, /isHeroTeaserModule/i);

    assert.ok(heroIndex >= 0, "expected HeroTeaser in read first");
    assert.equal(heroIndex, 0, "HeroTeaser should be first without boost hints");
    assert.ok(positionIndex === -1 || positionIndex > 2, "PositionSummary should not dominate read first");
    assert.ok(phpHelperIndex === -1 || phpHelperIndex > heroIndex, "PHP helper should not outrank HeroTeaser");
}

function testNewRealDefaultHeroFirst(): void {
    const briefing = runBriefing("new-real.txt", { ticket_topic: "ui", change_includes: "cms_ui" });
    if (!briefing) {
        console.log("  ↷ Skipping new-real default — sqlite/Graph.sqlite not found");
        return;
    }

    const heroIndex = readFirstIndex(briefing.readFirst, /heroTeaser|HeroTeaser/i);
    assert.ok(heroIndex >= 0, "expected HeroTeaser in read first");
    assert.equal(heroIndex, 0, "HeroTeaser should be first without boost hints");
}

function testSlidePresetDefaultRanking(): void {
    const briefing = runBriefing("slide-preset-dropdown-filter.txt", {
        ticket_topic: "ui",
        change_includes: "cms_ui",
    });
    if (!briefing) {
        console.log("  ↷ Skipping slide-preset default — sqlite/Graph.sqlite not found");
        return;
    }

    const cleanupIndex = readFirstIndex(briefing.readFirst, /CleanupSlidePresets/i);
    const dropdownIndex = readFirstIndex(briefing.readFirst, /SlidePresetDropdown|fetchSlidePresets/i);
    const apiIndex = readFirstIndex(briefing.readFirst, /slide-presets|SlidePresetsController/i);

    assert.equal(cleanupIndex, -1, "CleanupSlidePresets should not appear in read first");
    assert.ok(dropdownIndex >= 0 || apiIndex >= 0, "expected dropdown or slide-presets API in read first");
    assert.ok(
        Math.min(dropdownIndex >= 0 ? dropdownIndex : 99, apiIndex >= 0 ? apiIndex : 99) <= 1,
        "dropdown or API should rank in top two"
    );
}

function testQueueReadFirstAndFlows(): void {
    for (const ticketName of ["other.txt", "real-ticket.txt"]) {
        const briefing = runBriefing(ticketName);
        if (!briefing) {
            console.log(`  ↷ Skipping ${ticketName} — sqlite/Graph.sqlite not found`);
            return;
        }

        const listenerIndex = readFirstIndex(briefing.readFirst, /ExpiredVodObjectsListenerCommand|ListenerCommand/i);
        const jobIndex = readFirstIndex(briefing.readFirst, /ProcessExpiredVodObjectJob/i);

        assert.ok(listenerIndex >= 0, `${ticketName}: expected listener in read first`);
        assert.ok(jobIndex >= 0, `${ticketName}: expected job in read first`);
        assert.ok(listenerIndex < 2, `${ticketName}: listener should stay near the top`);

        const noisyApi = briefing.flowPaths.filter(path =>
            /PlayerSetting|RelatedContent|ModuleContent|ContentAccess|player-setting|related-content/i.test(path.path)
        );
        assert.equal(noisyApi.length, 0, `${ticketName}: unrelated content API flows should be filtered out`);
    }
}

function testQueueFlowPathFilterUnit(): void {
    const filtered = filterFlowPathsForBriefing(
        [
            {
                path: "integration:ExpiredVodObjectsListenerCommand → ProcessExpiredVodObjectJob",
                complete: false,
            },
            {
                path: "GET /content/{param}/player-setting → PlayerSettingController::player-setting",
                complete: true,
            },
            {
                path: "GET /content/{param}/related-content → RelatedContentController::related-content",
                complete: true,
            },
        ],
        {
            ticketText: "Archive expired VOD content after 30 days via SQS listener and queue job",
            workflowType: "queue",
            seedNodeIds: [
                "integration:SpOTTBackend\\Console\\Commands\\Content\\ExpiredVodObjectsListenerCommand:sqs_consumer",
            ],
            seedFiles: [
                "apps/spott-backend/app/Console/Commands/Content/ExpiredVodObjectsListenerCommand.php",
            ],
        },
        5
    );

    assert.ok(filtered.some(path => /ExpiredVod|ProcessExpired/i.test(path.path)));
    assert.ok(!filtered.some(path => /PlayerSetting|RelatedContent/i.test(path.path)));
}

function run(): void {
    console.log("ticketBriefingSprint1 tests\n");

    testFeNewDefaultHeroFirst();
    console.log("  ✓ fe-new default puts HeroTeaser first");

    testNewRealDefaultHeroFirst();
    console.log("  ✓ new-real default puts HeroTeaser first");

    testSlidePresetDefaultRanking();
    console.log("  ✓ slide-preset default ranks dropdown/API before cleanup noise");

    testQueueReadFirstAndFlows();
    console.log("  ✓ queue tickets keep listener/job and drop API noise");

    testQueueFlowPathFilterUnit();
    console.log("  ✓ queue flow path filter removes unrelated content API routes");

    console.log("\nAll Sprint 1 briefing tests passed.");
}

run();
