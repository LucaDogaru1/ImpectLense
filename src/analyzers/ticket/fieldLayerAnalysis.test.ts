import assert from "node:assert/strict";
import { canonicalFieldName, fieldNamesMatch } from "../../shared/fieldNameMatching";
import { analyzeFieldLayers } from "./ticketClaims";

function testFieldNameMatching(): void {
    assert.equal(canonicalFieldName("isArchived"), "isarchived");
    assert.equal(canonicalFieldName("is_archived"), "isarchived");
    assert.ok(fieldNamesMatch("isarchived", "isArchived"));
    assert.ok(fieldNamesMatch("is_archived", "isArchived"));
    assert.ok(!fieldNamesMatch("isarchived", "isDeleted"));
    assert.ok(fieldNamesMatch("16x9", "editorial.images.16x9"));
    assert.ok(fieldNamesMatch("editorial.images.1x1", "1x1"));
}

function testAnalyzeFieldLayersWithNestedApiOutput(): void {
    const rows = [
        {
            id: "response_field:Content:editorial.images.16x9",
            type: "response_field",
            name: "editorial.images.16x9",
            file: "app/Models/Content.php",
            parent: "Content",
            description: null,
            keywords: null,
        },
        {
            id: "Content::toArray",
            type: "method",
            name: "toArray",
            file: "app/Models/Content.php",
            parent: "Content",
            description: null,
            keywords: null,
        },
    ];

    const edges = [
        {
            from_id: "Content::toArray",
            to_id: "response_field:Content:editorial.images.16x9",
            type: "SERIALIZES",
        },
    ];

    const ticketText =
        "Add editorial.images.1x1 like editorial.images.16x9 in the content API response";

    const statuses = analyzeFieldLayers(rows, edges, ["16x9"], ticketText);
    const status = statuses[0];

    assert.ok(status);
    assert.ok((status.layers.api_output?.length ?? 0) > 0);
    assert.ok(!status.missingLayers.includes("api_output"));
}

function testAnalyzeFieldLayersWithApiOutput(): void {
    const rows = [
        {
            id: "model_field:App\\Models\\Content:isArchived",
            type: "model_field",
            name: "isArchived",
            file: "app/Models/Content.php",
            parent: "App\\Models\\Content",
            description: null,
            keywords: null,
        },
        {
            id: "response_field:App\\Models\\Content:isArchived",
            type: "response_field",
            name: "isArchived",
            file: "app/Models/Content.php",
            parent: "App\\Models\\Content",
            description: null,
            keywords: null,
        },
        {
            id: "App\\Services\\ContentService::archiveContent",
            type: "method",
            name: "archiveContent",
            file: "app/Services/ContentService.php",
            parent: "App\\Services\\ContentService",
            description: null,
            keywords: null,
        },
    ];

    const edges = [
        {
            from_id: "App\\Services\\ContentService::archiveContent",
            to_id: "model_field:App\\Models\\Content:isArchived",
            type: "PERSISTS",
        },
        {
            from_id: "App\\Models\\Content::toArray",
            to_id: "response_field:App\\Models\\Content:isArchived",
            type: "SERIALIZES",
        },
    ];

    const ticketText =
        "A new flag in content api called isArchived : true shall be added";

    const statuses = analyzeFieldLayers(rows, edges, ["isarchived"], ticketText);
    const status = statuses[0];

    assert.ok(status);
    assert.ok((status.layers.model_property?.length ?? 0) > 0);
    assert.ok((status.layers.api_output?.length ?? 0) > 0);
    assert.ok(!status.missingLayers.includes("api_output"));
    assert.match(status.summary, /found in/i);
}

function run(): void {
    console.log("field layer tests\n");

    testFieldNameMatching();
    console.log("  ✓ field name matching");

    testAnalyzeFieldLayersWithNestedApiOutput();
    console.log("  ✓ analyze field layers with nested api output");

    testAnalyzeFieldLayersWithApiOutput();
    console.log("  ✓ analyze field layers with api output");

    console.log("\nAll field layer tests passed.");
}

run();
