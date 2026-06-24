import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    classifyTicket,
    classificationToIntentAnswers,
    classificationToSuggestedFlags,
    collectClassificationReasons,
    collectSurfaceFeatures,
    formatClassificationBriefingSection,
    normalizeTicket,
    summarizeTicketText,
} from "./ticketClassification";

const projectRoot = path.resolve(__dirname, "../../..");

function readTicket(relativePath: string): string {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function testHeroUiTicket(): void {
    const ticket = readTicket("tickets/vague/hero-not-showing.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "ui");
    assert.equal(result.change_includes, "cms_ui");
    assert.deepEqual(result.scopes, ["php", "js"]);
    assert.ok(result.summary.toLowerCase().includes("hero"));
    assert.ok(result.confidence >= 0.5);
    assert.ok(result.reasons.some(reason => /cms\/layout surface|frontend|hero/i.test(reason)));
    assert.equal(classificationToIntentAnswers(result).ticket_topic, "ui");
}

function testQueueTicket(): void {
    const ticket = readTicket("tickets/other.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "queue");
    assert.equal(result.change_includes, "queue_job");
    assert.deepEqual(result.scopes, ["php"]);
    assert.ok(result.confidence >= 0.75);
    assert.ok(result.reasons.some(reason => /queue\/async surface/i.test(reason)));
    assert.ok(result.summary.length > 10);
}

function testImportTicket(): void {
    const ticket = readTicket("tickets/import.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "import");
    assert.equal(result.change_includes, "import_pipeline");
    assert.deepEqual(result.scopes, ["php", "js"]);
    assert.ok(result.confidence >= 0.6);
    assert.ok(result.reasons.some(reason => /import\/sync surface|cms\/layout surface/i.test(reason)));
}

function testFeNewPresetSummary(): void {
    const ticket = readTicket("tickets/fe-new.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "ui");
    assert.equal(result.change_includes, "cms_ui");
    assert.deepEqual(result.scopes, ["php", "js"]);
    assert.ok(result.summary.toLowerCase().includes("hero"));
    assert.ok(result.summary.toLowerCase().includes("homepage") || result.summary.toLowerCase().includes("display") || result.summary.toLowerCase().includes("layout"));
    assert.ok(result.reasons.includes("CMS/layout surface"));
    assert.ok(!result.summary.includes("→"));
}

function testExportDataSyncTicket(): void {
    const ticket = readTicket("tickets/vague/redsport-vod-recording-export.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "import");
    assert.equal(result.change_includes, "import_pipeline");
    assert.deepEqual(result.scopes, ["php"]);
    assert.ok(result.confidence <= 0.58, `expected vague-ticket confidence cap, got ${result.confidence}`);
    assert.ok(result.reasons.some(reason => /export\/reporting surface|import\/sync surface/i.test(reason)));
    assert.ok(result.summary.toLowerCase().includes("export"));
    assert.notEqual(result.ticket_topic, "queue");
}

function testVagueRankingTicket(): void {
    const ticket = readTicket("tickets/vague/ranking-not-updating.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "import");
    assert.equal(result.change_includes, "import_pipeline");
    assert.deepEqual(result.scopes, ["php"]);
    assert.ok(result.confidence <= 0.55, `expected low confidence, got ${result.confidence}`);
    assert.ok(result.reasons.some(reason => /import\/sync surface|ranking/i.test(reason)));
}

function testEditorialApiFieldTicket(): void {
    const ticket = readTicket("tickets/editorial-image-ticket.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "api");
    assert.equal(result.change_includes, "api_field");
    assert.ok(result.reasons.every(reason => !reason.includes("stored and returned")));
    assert.ok(result.reasons.some(reason => /API contract surface|payload|property|field/i.test(reason)));
}

function testNewNewMixedStackTicket(): void {
    const ticket = readTicket("tickets/NEW-new.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.change_includes, "mixed");
    assert.ok(["api", "ui"].includes(result.ticket_topic));
    assert.ok(result.reasons.some(reason => /API contract surface|CMS\/layout surface/i.test(reason)));
}

function testBlurryMobileMediaTicket(): void {
    const ticket = readTicket("tickets/vague/images-blurry-mobile.txt");
    const result = classifyTicket(ticket);

    assert.equal(result.ticket_topic, "ui");
    assert.equal(result.change_includes, "mixed");
    assert.deepEqual(result.scopes, ["php", "js"]);
    assert.ok(result.confidence <= 0.48);
}

function testPlayerProfilePerformanceTicket(): void {
    const ticket = readTicket("tickets/vague/player-profile-slow.txt");
    const result = classifyTicket(ticket);

    assert.ok(["unknown", "api"].includes(result.ticket_topic));
    assert.equal(result.change_includes, "backend_logic");
    assert.deepEqual(result.scopes, ["php", "js"]);
    assert.ok(result.confidence <= 0.45);
}

function testReasonsOnlyFromSignalGroups(): void {
    const ticket = readTicket("tickets/editorial-image-ticket.txt");
    const reasons = collectClassificationReasons(ticket);

    assert.ok(reasons.length > 0);
    assert.ok(reasons.every(reason => !reason.includes("database.")));
    assert.ok(reasons.every(reason => reason.split(" ").length <= 6));
}

function testSummarizeTicketText(): void {
    const ticket = readTicket("tickets/vague/redsport-vod-recording-export.txt");
    const summary = summarizeTicketText(ticket);

    assert.match(summary, /export/i);
    assert.ok(summary.length < 120);
}

function testNormalizationIgnoresStructure(): void {
    const ticket = readTicket("tickets/fe-new.txt");
    const normalized = normalizeTicket(ticket);

    assert.ok(normalized.contentLines.some(line => /full-width hero teaser/i.test(line)));
    assert.ok(normalized.nounPhrases.length >= 3);
    assert.equal(normalized.title, undefined);
}

function testSurfaceScoringPrefersExportOverQueue(): void {
    const ticket = readTicket("tickets/vague/redsport-vod-recording-export.txt");
    const normalized = normalizeTicket(ticket);
    const surfaces = collectSurfaceFeatures(normalized);

    assert.ok(surfaces.export > 0);
    assert.ok(surfaces.export >= surfaces.queue || surfaces.queue === 0);
}

function testSuggestedFlags(): void {
    const ticket = readTicket("tickets/vague/hero-not-showing.txt");
    const result = classifyTicket(ticket);
    const flags = classificationToSuggestedFlags(result);

    assert.match(flags.answers, /ticket_topic:ui/);
    assert.match(flags.answers, /change_includes:cms_ui/);
    assert.equal(flags.scopes, "php,js");
}

function testBriefingSectionShowsAppliedAnswers(): void {
    const ticket = readTicket("tickets/other.txt");
    const classification = classifyTicket(ticket);
    const lines = formatClassificationBriefingSection(classification, {
        ticket_topic: "queue",
        change_includes: "queue_job",
        scopes: ["php"],
    });
    const joined = lines.join("\n");

    assert.match(joined, /Suggested ticket_topic/);
    assert.match(joined, /Applied ticket_topic/);
    assert.match(joined, /Applied scopes/);
}

function testEmptyTicket(): void {
    const result = classifyTicket("   \n  ");
    assert.equal(result.ticket_topic, "unknown");
    assert.equal(result.confidence, 0);
    assert.deepEqual(collectClassificationReasons("   "), []);
}

function run(): void {
    console.log("ticketClassification tests\n");

    testHeroUiTicket();
    console.log("  ✓ hero UI ticket");

    testQueueTicket();
    console.log("  ✓ queue/SQS ticket");

    testImportTicket();
    console.log("  ✓ import ticket");

    testFeNewPresetSummary();
    console.log("  ✓ fe-new generic UI classification");

    testExportDataSyncTicket();
    console.log("  ✓ export/data sync ticket");

    testVagueRankingTicket();
    console.log("  ✓ vague ranking ticket");

    testEditorialApiFieldTicket();
    console.log("  ✓ editorial API field ticket");

    testNewNewMixedStackTicket();
    console.log("  ✓ NEW-new mixed stack ticket");

    testBlurryMobileMediaTicket();
    console.log("  ✓ blurry mobile media ticket");

    testPlayerProfilePerformanceTicket();
    console.log("  ✓ player profile performance ticket");

    testReasonsOnlyFromSignalGroups();
    console.log("  ✓ reasons from signal groups only");

    testSummarizeTicketText();
    console.log("  ✓ ticket summary");

    testNormalizationIgnoresStructure();
    console.log("  ✓ ticket normalization");

    testSurfaceScoringPrefersExportOverQueue();
    console.log("  ✓ export beats queue generically");

    testSuggestedFlags();
    console.log("  ✓ suggested CLI flags");

    testBriefingSectionShowsAppliedAnswers();
    console.log("  ✓ briefing classification section");

    testEmptyTicket();
    console.log("  ✓ empty ticket");

    console.log("\nAll ticket classification tests passed.");
}

run();
