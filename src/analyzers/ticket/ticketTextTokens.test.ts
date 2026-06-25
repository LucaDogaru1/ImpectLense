import assert from "node:assert/strict";
import {
    assessTicketDomainInformation,
    hasTicketStructuralSignals,
    shouldRejectAsLowInformationTicket,
    ticketHasConcreteAnchors,
    usableStrongTicketTokens,
} from "./ticketTextTokens";

function testMeaninglessTicketIsRejected(): void {
    const ticket = "write some ticket text on a page and make it do something";
    const assessment = assessTicketDomainInformation({
        ticketText: ticket,
        workflowType: "unknown",
        strongMatchedTokens: ["write", "some", "ticket", "text", "page"],
    });

    assert.equal(assessment.rejected, true);
    assert.deepEqual(assessment.meaningfulTokens, ["ticket"]);
    assert.equal(ticketHasConcreteAnchors(ticket), false);
}

function testVaguePerformanceTicketIsNotRejected(): void {
    const ticket = "the page feels slow when opening profiles";
    const rejected = shouldRejectAsLowInformationTicket({
        ticketText: ticket,
        workflowType: "unknown",
        strongMatchedTokens: ["feels", "slow", "opening", "profiles"],
    });

    assert.equal(rejected, false);
    assert.deepEqual(usableStrongTicketTokens(["feels", "slow", "opening", "profiles"]), [
        "opening",
        "profiles",
    ]);
}

function testHeroTicketHasStructuralSignals(): void {
    const ticket = "HeroTeaser full-width layout on homepage with slidePreset dropdown";
    const hasSignals = hasTicketStructuralSignals({
        ticketText: ticket,
        workflowType: "unknown",
        strongMatchedTokens: ["heroteaser", "homepage", "slidepreset"],
    });

    assert.equal(hasSignals, true);
    assert.equal(
        shouldRejectAsLowInformationTicket({
            ticketText: ticket,
            workflowType: "unknown",
            strongMatchedTokens: ["heroteaser"],
        }),
        false
    );
}

function testBoostTermsBypassLowInformationGate(): void {
    const rejected = shouldRejectAsLowInformationTicket({
        ticketText: "write some vague text",
        workflowType: "unknown",
        boostTerms: ["HeroTeaser"],
        strongMatchedTokens: ["write", "vague"],
    });

    assert.equal(rejected, false);
}

function testConcreteAnchorsBypassGate(): void {
    const ticket = "Fix GET /api/v1/slide-presets response";
    const rejected = shouldRejectAsLowInformationTicket({
        ticketText: ticket,
        workflowType: "unknown",
        strongMatchedTokens: ["fix", "response"],
    });

    assert.equal(rejected, false);
}

function testKnownWorkflowBypassesGate(): void {
    const rejected = shouldRejectAsLowInformationTicket({
        ticketText: "something vague",
        workflowType: "import",
        strongMatchedTokens: ["something"],
    });

    assert.equal(rejected, false);
}

function run(): void {
    testMeaninglessTicketIsRejected();
    testVaguePerformanceTicketIsNotRejected();
    testHeroTicketHasStructuralSignals();
    testBoostTermsBypassLowInformationGate();
    testConcreteAnchorsBypassGate();
    testKnownWorkflowBypassesGate();
    console.log("ticketTextTokens tests passed.");
}

run();
