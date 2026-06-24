import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { inferIntentAnswers, previewTicketIntent } from "./ticketIntent";
import { startTicketSession, continueTicketSession } from "./ticketSession";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");
const vagueDir = path.join(projectRoot, "tickets/vague");

interface VagueBriefingResult {
    readFirst: Array<{ id: string; file: string | null }>;
    flowPaths: Array<{ path: string; complete: boolean }>;
    warnings: string[];
    navigationConfidence: number;
    implementationConfidence: number;
    inferredWorkflow: string;
    markdown: string;
}

function readFirstMatches(
    readFirst: Array<{ id: string; file: string | null }>,
    pattern: RegExp
): boolean {
    return readFirst.some(item => pattern.test(item.id) || pattern.test(item.file ?? ""));
}

function runVagueBriefing(ticketFile: string): VagueBriefingResult | null {
    if (!fs.existsSync(sqlitePath)) {
        return null;
    }

    const ticketPath = path.join(vagueDir, ticketFile);
    if (!fs.existsSync(ticketPath)) {
        throw new Error(`Missing vague ticket fixture: ${ticketPath}`);
    }

    const ticketText = fs.readFileSync(ticketPath, "utf8");
    const preview = previewTicketIntent(ticketText);
    const answers = inferIntentAnswers(ticketText);
    const db = new Database(sqlitePath, { readonly: true });

    try {
        let result = startTicketSession(db, {
            ticketText,
            limit: 8,
            scopes: ["php", "js"],
            answers,
        });

        if (result.status === "needs_input") {
            const followUp: Record<string, string> = {
                truncated_ack: "yes",
                missing_js_graph: "continue",
            };

            for (const question of result.questions ?? []) {
                if (question.id === "implementation_mode") {
                    followUp.implementation_mode = "extend_existing";
                }
            }

            result = continueTicketSession(db, result.session, followUp, { limit: 8 });
        }

        assert.equal(result.status, "ready");
        assert.ok(result.briefing);
        assert.ok(result.analysis);

        return {
            readFirst: result.briefing!.readFirst,
            flowPaths: result.briefing!.flowPaths,
            warnings: result.briefing!.warnings,
            navigationConfidence: result.analysis!.navigationConfidence,
            implementationConfidence: result.analysis!.implementationConfidence,
            inferredWorkflow: preview.dominantWorkflow.type,
            markdown: result.briefing!.markdown,
        };
    } finally {
        db.close();
    }
}

function assertNoAbsurdAnchors(readFirst: Array<{ id: string; file: string | null }>): void {
    assert.ok(
        !readFirst.some(item => /\/access\/{param}|ContentAccessController/i.test(item.id)),
        "vague ticket should not anchor unrelated access routes"
    );
}

function assertTierCTriageSignals(result: VagueBriefingResult, ticketLabel: string): void {
    assert.ok(result.readFirst.length > 0, `${ticketLabel}: read first should not be empty`);
    assertNoAbsurdAnchors(result.readFirst);

    assert.ok(
        result.warnings.some(w => /concrete code anchors|triage only|uncertain|unknown|verify/i.test(w)),
        `${ticketLabel}: vague ticket should warn that ranking is triage-only or uncertain`
    );
}

function testHeroNotShowingTriage(): void {
    const result = runVagueBriefing("hero-not-showing.txt");
    if (!result) {
        console.log("  ↷ Skipping hero-not-showing — sqlite/Graph.sqlite not found");
        return;
    }

    assertTierCTriageSignals(result, "hero-not-showing");
    assert.ok(
        readFirstMatches(result.readFirst, /hero/i),
        "hero ticket should surface hero-related components"
    );
    assert.ok(
        result.flowPaths.some(path => /hero/i.test(path.path)),
        "hero ticket should include partial hero flow paths"
    );
}

function testRankingNotUpdatingTriage(): void {
    const result = runVagueBriefing("ranking-not-updating.txt");
    if (!result) {
        console.log("  ↷ Skipping ranking-not-updating — sqlite/Graph.sqlite not found");
        return;
    }

    assertTierCTriageSignals(result, "ranking-not-updating");
    assert.ok(
        readFirstMatches(result.readFirst, /ranking|import/i),
        "ranking ticket should surface ranking- or import-related candidates"
    );

    const hasUncertaintySignal =
        result.inferredWorkflow === "import" ||
        result.warnings.some(w => /unsure|uncertain|verify/i.test(w)) ||
        result.implementationConfidence < 0.65;

    assert.ok(
        hasUncertaintySignal,
        "ranking ticket should not look like a sharp, high-confidence briefing"
    );
}

function testPlayerProfileSlowTriage(): void {
    const result = runVagueBriefing("player-profile-slow.txt");
    if (!result) {
        console.log("  ↷ Skipping player-profile-slow — sqlite/Graph.sqlite not found");
        return;
    }

    assertTierCTriageSignals(result, "player-profile-slow");
    assert.ok(
        readFirstMatches(result.readFirst, /profile|player|user/i),
        "player profile ticket should surface profile/player-related candidates"
    );

    const hasUncertaintySignal =
        result.inferredWorkflow === "unknown" ||
        result.warnings.some(w => /unknown|uncertain|verify/i.test(w)) ||
        result.implementationConfidence < 0.6;

    assert.ok(
        hasUncertaintySignal,
        "player profile ticket should signal ambiguity (unknown workflow or warning or low impl confidence)"
    );
}

function testImagesBlurryMobileTriage(): void {
    const result = runVagueBriefing("images-blurry-mobile.txt");
    if (!result) {
        console.log("  ↷ Skipping images-blurry-mobile — sqlite/Graph.sqlite not found");
        return;
    }

    assertTierCTriageSignals(result, "images-blurry-mobile");
    assert.ok(
        readFirstMatches(result.readFirst, /mobile|device|image|vue/i),
        "blurry images ticket should surface some frontend/mobile/image-related candidates"
    );
}

function testCategoriesMissingImportTriage(): void {
    const result = runVagueBriefing("categories-missing-import.txt");
    if (!result) {
        console.log("  ↷ Skipping categories-missing-import — sqlite/Graph.sqlite not found");
        return;
    }

    assertTierCTriageSignals(result, "categories-missing-import");
    assert.ok(
        readFirstMatches(result.readFirst, /import|category|provider|mapper/i),
        "categories import ticket should surface import/category-related candidates"
    );
}

function testRedsportExportTriage(): void {
    const result = runVagueBriefing("redsport-vod-recording-export.txt");
    if (!result) {
        console.log("  (skipped — Graph.sqlite missing)");
        return;
    }

    assert.notEqual(result.inferredWorkflow, "queue", "export/cms ticket should not infer queue workflow");
    assert.ok(
        result.warnings.some(w => /triage only|concrete anchors/i.test(w)),
        "expected vague triage warning"
    );
    assert.ok(result.readFirst.length > 0, "read-first should suggest starting points");
    assert.ok(
        readFirstMatches(result.readFirst, /contentlist|content.?list|import|sync|cms/i),
        "read-first should surface cms list or data-sync compass"
    );
    assert.ok(result.implementationConfidence <= 0.58, "vague ticket should cap implementation confidence");
}

function testAllVagueFixturesExist(): void {
    const expected = [
        "player-profile-slow.txt",
        "ranking-not-updating.txt",
        "hero-not-showing.txt",
        "images-blurry-mobile.txt",
        "categories-missing-import.txt",
        "redsport-vod-recording-export.txt",
    ];

    for (const file of expected) {
        assert.ok(fs.existsSync(path.join(vagueDir, file)), `expected vague fixture ${file}`);
    }
}

function run(): void {
    console.log("ticketVagueTriage tests\n");

    testAllVagueFixturesExist();
    console.log("  ✓ vague fixtures exist");

    testHeroNotShowingTriage();
    console.log("  ✓ hero-not-showing tier-C triage");

    testRankingNotUpdatingTriage();
    console.log("  ✓ ranking-not-updating tier-C triage");

    testPlayerProfileSlowTriage();
    console.log("  ✓ player-profile-slow tier-C triage");

    testImagesBlurryMobileTriage();
    console.log("  ✓ images-blurry-mobile tier-C triage");

    testCategoriesMissingImportTriage();
    console.log("  ✓ categories-missing-import tier-C triage");

    testRedsportExportTriage();
    console.log("  ✓ redsport-vod-recording-export tier-C triage");

    console.log("\nAll vague triage tests passed.");
}

run();
