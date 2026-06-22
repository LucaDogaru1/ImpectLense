import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { analyzeTicket } from "./ticketAnalyzerV3";
import {
    calculateDominantWorkflow,
    isTicketTruncated,
    isWorkflowAlignedEntrypoint,
    scoreWorkflows,
} from "./ticketWorkflow";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");

function readTicket(name: string): string {
    return fs.readFileSync(path.join(projectRoot, "tickets", name), "utf8");
}

function testWorkflowDetection(): void {
    const queueTicket = readTicket("other.txt");
    const queueScores = scoreWorkflows(queueTicket, ["sqs", "queue", "recording", "filepath"]);
    const queueWorkflow = calculateDominantWorkflow(queueScores);

    assert.equal(queueWorkflow.type, "queue");
    assert.ok(queueWorkflow.confidence >= 0.65);

    const apiTicket = readTicket("editorial-image-ticket.txt");
    const apiScores = scoreWorkflows(apiTicket, ["api", "post", "property", "editorial"]);
    const apiWorkflow = calculateDominantWorkflow(apiScores);

    assert.equal(apiWorkflow.type, "api");

    const importTicket = readTicket("import.txt");
    const importScores = scoreWorkflows(importTicket, ["import", "xml", "feed", "provider"]);
    const importWorkflow = calculateDominantWorkflow(importScores);

    assert.equal(importWorkflow.type, "import");
}

function testTruncationDetection(): void {
    assert.equal(isTicketTruncated(readTicket("real-ticket.txt")), true);
    assert.equal(isTicketTruncated(readTicket("other.txt")), false);
}

function testWorkflowEntrypointAlignment(): void {
    assert.equal(
        isWorkflowAlignedEntrypoint("SpOTTBackend\\Jobs\\Content\\VtdSyncJob::handle", "apps/spott-backend/app/Jobs/Content/VtdSyncJob.php", "queue"),
        false
    );

    assert.equal(
        isWorkflowAlignedEntrypoint("App\\Queue\\ExpiredObjectsConsumer::handle", "app/Queue/ExpiredObjectsConsumer.php", "queue"),
        true
    );
}

function graphHasNode(db: InstanceType<typeof Database>, pattern: string): boolean {
    const row = db
        .prepare("SELECT 1 AS ok FROM nodes WHERE id LIKE ? LIMIT 1")
        .get(`%${pattern}%`) as { ok: number } | undefined;

    return Boolean(row?.ok);
}

function testQueueTicketAnalysis(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("other.txt"), { limit: 5 });
        const isDemoGraph = graphHasNode(db, "ExpiredObjectsConsumer");
        const isSpottGraph = graphHasNode(db, "ExpiredVodObjectsListenerCommand");

        assert.equal(result.workflow.type, "queue");
        assert.doesNotMatch(
            result.claims.infrastructureGaps.join(" "),
            /No SQS consumer/i
        );
        assert.ok(
            result.investigationTargets.some(target =>
                /ExpiredObjectsConsumer|ExpiredVodObjectsListenerCommand|sqs_consumer|archiveRecording/i.test(target.id)
            ) || result.investigationTargets.some(target => /::handle$/i.test(target.id))
        );
        assert.ok(result.implementationConfidence < result.navigationConfidence);

        if (isDemoGraph) {
            const topMethodIds = result.matchedMethods.map(method => method.id).join(" ");
            assert.match(topMethodIds, /archiveContent/i);

            const excludedIds = result.claims.doNotStartHere.map(item => item.id).join(" ");
            assert.doesNotMatch(excludedIds, /archiveContent/i);
        }

        if (isSpottGraph) {
            const investigationIds = result.investigationTargets.map(item => item.id).join(" ");
            assert.doesNotMatch(investigationIds, /ValidateConsumerKey|ApiKeyGenerator/i);
        }
    } finally {
        db.close();
    }
}

function testRealTicketAnalysis(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("real-ticket.txt"), { limit: 5 });

        assert.equal(result.workflow.type, "queue");
        assert.ok(result.claims.warnings.some(warning => /truncated/i.test(warning)));
        assert.doesNotMatch(
            result.claims.infrastructureGaps.join(" "),
            /No SQS consumer/i
        );
        assert.doesNotMatch(
            result.claims.infrastructureGaps.join(" "),
            /Queue name 'spottvod-expired-objects-prod' not referenced/i
        );
        assert.ok(
            result.implementationHints.every(hint => !/^Start at async entrypoint:/i.test(hint))
        );
        assert.ok(
            result.implementationHints.every(hint => !/^Existing related field/i.test(hint))
        );

        const investigationIds = result.investigationTargets.map(item => item.id).join(" ");
        assert.doesNotMatch(investigationIds, /Request::all/i);
        assert.doesNotMatch(investigationIds, /ValidateConsumerKey|ApiKeyGenerator/i);
        assert.ok(
            /ExpiredVod|archiveRecording|archiveContent|ExpiredObjectsConsumer/i.test(investigationIds),
            `Expected archive/expired VOD handlers in investigation targets, got: ${investigationIds}`
        );
    } finally {
        db.close();
    }
}

function testImportTicketInvestigationOrder(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("import.txt"), { limit: 5 });

        assert.equal(result.workflow.type, "import");
        assert.ok(result.investigationTargets.length > 0);
        assert.notEqual(result.investigationTargets[0]?.id, "ContentController::store");

        const investigationIds = result.investigationTargets.map(item => item.id).join(" ");
        assert.doesNotMatch(investigationIds, /ContentController::store|ContentController::update/);
    } finally {
        db.close();
    }
}

function testGeoTicketFiltersParameterNoise(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("new.txt"), { limit: 5 });

        const investigationIds = result.investigationTargets.map(item => item.id).join(" ");
        assert.doesNotMatch(investigationIds, /\$attributes/i);
        assert.doesNotMatch(investigationIds, /ContentController::update/i);
    } finally {
        db.close();
    }
}

function testImportTicketAnalysis(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("import.txt"), { limit: 5 });

        assert.equal(result.workflow.type, "import");
        assert.ok(result.matchedMethods.length > 0 || result.matchedEndpoints.length > 0);
    } finally {
        db.close();
    }
}

function testApiTicketAnalysis(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const result = analyzeTicket(db, readTicket("editorial-image-ticket.txt"), { limit: 5 });

        assert.equal(result.workflow.type, "api");
        assert.ok(result.matchedRequestFields.length > 0 || result.matchedEndpoints.length > 0);
    } finally {
        db.close();
    }
}

function testIsArchivedApiOutputOnSpottGraph(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        if (!graphHasNode(db, "BaseConfigEventContentResource")) {
            console.log("  ↷ Skipping isArchived api_output test — SpOTT graph not loaded");
            return;
        }

        const result = analyzeTicket(db, readTicket("real-ticket.txt"), { limit: 5 });
        const isArchived = result.claims.fieldStatuses.find(status => status.field === "isarchived");

        assert.ok(isArchived, "Expected isarchived field status");
        assert.ok(
            (isArchived.layers.api_output?.length ?? 0) > 0,
            `Expected api_output layer, got: ${isArchived.summary}`
        );
        assert.ok(!isArchived.missingLayers.includes("api_output"));
    } finally {
        db.close();
    }
}

function testFieldLayersOnDemoGraph(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping integration test — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        if (!graphHasNode(db, "ExpiredObjectsConsumer")) {
            console.log("  ↷ Skipping field layer test — demo graph not loaded in sqlite/Graph.sqlite");
            return;
        }

        const result = analyzeTicket(db, readTicket("other.txt"), { limit: 5 });
        const isArchived = result.claims.fieldStatuses.find(status => status.field === "isarchived");

        assert.ok(isArchived);
        assert.ok((isArchived.layers.model_property?.length ?? 0) > 0);
        assert.ok((isArchived.layers.api_output?.length ?? 0) > 0);
    } finally {
        db.close();
    }
}

function run(): void {
    console.log("ticketAnalyzerV3 tests\n");

    testWorkflowDetection();
    console.log("  ✓ workflow detection");

    testTruncationDetection();
    console.log("  ✓ truncation detection");

    testWorkflowEntrypointAlignment();
    console.log("  ✓ workflow entrypoint alignment");

    testQueueTicketAnalysis();
    console.log("  ✓ queue ticket analysis");

    testRealTicketAnalysis();
    console.log("  ✓ real ticket analysis");

    testIsArchivedApiOutputOnSpottGraph();
    console.log("  ✓ isArchived api_output on SpOTT graph");

    testImportTicketInvestigationOrder();
    console.log("  ✓ import investigation order");

    testGeoTicketFiltersParameterNoise();
    console.log("  ✓ geo ticket noise filtering");

    testFieldLayersOnDemoGraph();
    console.log("  ✓ field layer graph semantics");

    testImportTicketAnalysis();
    console.log("  ✓ import ticket analysis");

    testApiTicketAnalysis();
    console.log("  ✓ api ticket analysis");

    console.log("\nAll ticket analyzer tests passed.");
}

run();
