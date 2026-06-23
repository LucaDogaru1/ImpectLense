import assert from "node:assert/strict";
import {
    applyRankingHintsToMatches,
    buildRankingHints,
    rankingHintMatchesHaystack,
} from "./ticketRankingHints";
import type { TicketMatchedNode } from "./ticketAnalyzerV3";

function sampleNode(overrides: Partial<TicketMatchedNode> = {}): TicketMatchedNode {
    return {
        id: "js:apps/cms/HeroTeaser.vue::HeroTeaser",
        type: "vue_component",
        name: "HeroTeaser",
        file: "apps/cms/HeroTeaser/index.vue",
        score: 100,
        reason: "Matched token(s): hero",
        ...overrides,
    };
}

function testBoostIncreasesScore(): void {
    const items = applyRankingHintsToMatches(
        [sampleNode()],
        buildRankingHints("HeroTeaser", undefined)
    );

    assert.equal(items.length, 1);
    assert.ok(items[0]!.score > 100);
    assert.match(items[0]!.reason, /Agent boost: HeroTeaser/);
}

function testSuppressDemotesNoise(): void {
    const items = applyRankingHintsToMatches(
        [
            sampleNode(),
            sampleNode({
                id: "js:apps/cms/vertical-promotion.vue::VerticalPromotion",
                name: "VerticalPromotion",
                file: "apps/cms/vertical-promotion.vue",
                score: 120,
            }),
        ],
        buildRankingHints(undefined, "vertical-promotion")
    );

    assert.equal(items.length, 1);
    assert.equal(items[0]!.name, "HeroTeaser");
}

function testHyphenatedSuppressMatchesCamelCase(): void {
    const haystack =
        "js:packages/ui-design/components/vertical-promotion.vue verticalpromotion";
    assert.equal(rankingHintMatchesHaystack(haystack, "vertical-promotion"), true);
}

function testParseCommaSeparatedTerms(): void {
    const hints = buildRankingHints("slidePreset, SlidePresetDropdown", "hero, vertical-promotion");
    assert.deepEqual(hints.boost, ["slidePreset", "SlidePresetDropdown"]);
    assert.deepEqual(hints.suppress, ["hero", "vertical-promotion"]);
}

function run(): void {
    console.log("ticketRankingHints tests\n");

    testBoostIncreasesScore();
    console.log("  ✓ boost increases matching node score");

    testSuppressDemotesNoise();
    console.log("  ✓ suppress removes or demotes matching nodes");

    testHyphenatedSuppressMatchesCamelCase();
    console.log("  ✓ hyphenated suppress terms match related symbols");

    testParseCommaSeparatedTerms();
    console.log("  ✓ parses comma-separated boost and suppress terms");

    console.log("\nAll ticket ranking hint tests passed.");
}

run();
