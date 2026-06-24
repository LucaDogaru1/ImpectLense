import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { mergeReadFirstCandidates } from "./ticketBriefing";
import { buildRankingHints } from "./ticketRankingHints";
import { startTicketSession, continueTicketSession } from "./ticketSession";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");

function readFirstIndex(readFirst: Array<{ id: string }>, pattern: RegExp): number {
    return readFirst.findIndex(item => pattern.test(item.id) || pattern.test(item.file ?? ""));
}

function testBoostPromotesMatchingNodeInReadFirst(): void {
    const heroTeaser = {
        id: "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser",
        file: "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
        reason: "Matched vue component token(s): hero, teaser",
    };
    const positionSummary = {
        id: "js:apps/spott-frontend/resources/assets/js/tailwind/Molecules/PositionSummaryOverviewField.vue::PositionSummaryOverviewField",
        file: "apps/spott-frontend/resources/assets/js/tailwind/Molecules/PositionSummaryOverviewField.vue",
        reason: "Symbol anchor: PositionSummaryOverviewField",
    };

    const scoreById = new Map([
        [positionSummary.id, 500],
        [heroTeaser.id, 80],
    ]);

    const readFirst = mergeReadFirstCandidates(
        [positionSummary],
        [heroTeaser],
        5,
        "Add heroTeaser cell to CMS page",
        scoreById,
        buildRankingHints("heroTeaser,HeroTeaser", "PositionSummary")
    );

    assert.ok(readFirst.length > 0);
    assert.match(readFirst[0]!.id, /heroTeaser|HeroTeaser/i);
    assert.ok(!readFirst.some(item => /PositionSummary/i.test(item.id)));
}

function testSuppressRemovesNoisyNodeFromReadFirst(): void {
    const cleanup = {
        id: "integration:SpOTTBackend\\Console\\Commands\\OneTime\\CleanupSlidePresets:console_command",
        file: "apps/spott-backend/app/Console/Commands/OneTime/CleanupSlidePresets.php",
        reason: "Symbol anchor: CleanupSlidePresets",
    };
    const dropdown = {
        id: "js:apps/spott-frontend/resources/assets/js/views/pagemanager/module/options/SlidePresetDropdown.vue::fetchSlidePresets",
        file: "apps/spott-frontend/resources/assets/js/views/pagemanager/module/options/SlidePresetDropdown.vue",
        reason: "Matched token(s): slide, preset",
    };

    const scoreById = new Map([
        [cleanup.id, 600],
        [dropdown.id, 120],
    ]);

    const readFirst = mergeReadFirstCandidates(
        [cleanup],
        [dropdown],
        5,
        "Filter slide preset dropdown",
        scoreById,
        buildRankingHints("SlidePresetDropdown,slide-presets", "CleanupSlidePresets")
    );

    assert.ok(readFirst.length > 0);
    assert.match(readFirst[0]!.id, /SlidePresetDropdown|slide-presets/i);
    assert.ok(!readFirst.some(item => /CleanupSlidePresets/i.test(item.id)));
}

function runBriefingRegression(
    ticketName: string,
    hints: ReturnType<typeof buildRankingHints>,
    assertReadFirst: (readFirst: Array<{ id: string; file: string | null }>) => void,
    assertFlowPaths?: (flowPaths: Array<{ path: string }>) => void
): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log(`  ↷ Skipping ${ticketName} — sqlite/Graph.sqlite not found`);
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });
    const ticketText = fs.readFileSync(path.join(projectRoot, "tickets", ticketName), "utf8");

    try {
        let result = startTicketSession(db, {
            ticketText,
            limit: 10,
            rankingHints: hints,
            scopes: ["php", "js"],
            answers: { ticket_topic: "ui", change_includes: "cms_ui" },
        });

        if (result.status === "needs_input") {
            result = continueTicketSession(db, result.session, {}, { limit: 10, rankingHints: hints });
        }

        assert.equal(result.status, "ready");
        assert.ok(result.briefing);

        assertReadFirst(result.briefing!.readFirst);
        if (assertFlowPaths) {
            assertFlowPaths(result.briefing!.flowPaths);
        }
    } finally {
        db.close();
    }
}

function testFeNewBoostRegression(): void {
    runBriefingRegression(
        "fe-new.txt",
        buildRankingHints("heroTeaser,HeroTeaser", "vertical-promotion,PositionSummary"),
        readFirst => {
            const heroIndex = readFirstIndex(readFirst, /heroTeaser|HeroTeaser/i);
            const positionIndex = readFirstIndex(readFirst, /PositionSummary/i);

            assert.ok(heroIndex >= 0, "expected heroTeaser in read first");
            assert.equal(positionIndex, -1, "PositionSummary should be suppressed from read first");
            assert.equal(heroIndex, 0, "heroTeaser should be first in read first");
        },
        flowPaths => {
            assert.ok(flowPaths.some(path => /HeroTeaser|heroTeaser/i.test(path.path)));
        }
    );
}

function testNewRealBoostRegression(): void {
    runBriefingRegression(
        "new-real.txt",
        buildRankingHints("heroTeaser,HeroTeaser", "vertical-promotion,PositionSummary"),
        readFirst => {
            const heroIndex = readFirstIndex(readFirst, /heroTeaser|HeroTeaser/i);
            const positionIndex = readFirstIndex(readFirst, /PositionSummary/i);

            assert.ok(heroIndex >= 0, "expected heroTeaser in read first");
            assert.equal(positionIndex, -1, "PositionSummary should be suppressed from read first");
            assert.equal(heroIndex, 0, "heroTeaser should be first in read first");
        }
    );
}

function testSlidePresetBoostRegression(): void {
    runBriefingRegression(
        "slide-preset-dropdown-filter.txt",
        buildRankingHints("SlidePresetDropdown,slide-presets", "CleanupSlidePresets"),
        readFirst => {
            const dropdownIndex = readFirstIndex(readFirst, /SlidePresetDropdown|slide-presets/i);
            const cleanupIndex = readFirstIndex(readFirst, /CleanupSlidePresets/i);

            assert.ok(dropdownIndex >= 0, "expected SlidePresetDropdown or slide-presets in read first");
            assert.equal(cleanupIndex, -1, "CleanupSlidePresets should be suppressed from read first");
            assert.equal(dropdownIndex, 0, "SlidePresetDropdown should be first in read first");
        },
        flowPaths => {
            assert.ok(flowPaths.some(path => /slide-presets|SlidePreset/i.test(path.path)));
        }
    );
}

function run(): void {
    console.log("ticketBriefingRankingHints tests\n");

    testBoostPromotesMatchingNodeInReadFirst();
    console.log("  ✓ boost promotes matching node in read first");

    testSuppressRemovesNoisyNodeFromReadFirst();
    console.log("  ✓ suppress removes noisy node from read first");

    testFeNewBoostRegression();
    console.log("  ✓ fe-new boost/suppress regression");

    testNewRealBoostRegression();
    console.log("  ✓ new-real boost/suppress regression");

    testSlidePresetBoostRegression();
    console.log("  ✓ slide-preset boost/suppress regression");

    console.log("\nAll ticket briefing ranking hint tests passed.");
}

run();
