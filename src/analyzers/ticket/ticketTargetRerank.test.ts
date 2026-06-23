import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyWorkflowTargetRerank } from "./ticketTargetRerank";

const projectRoot = path.resolve(__dirname, "../../..");

function testApiFieldRerankPrefersParser(): void {
    const ticket = fs.readFileSync(path.join(projectRoot, "tickets/editorial-image-ticket.txt"), "utf8");
    const reranked = applyWorkflowTargetRerank([
        {
            id: "SpOTTBackend\\Http\\Controllers\\ClientManager\\v2\\BaseConfig\\BaseConfigSessionControlController::generateSessionResetLink",
            type: "method",
            name: "generateSessionResetLink",
            file: "apps/spott-backend/app/Http/Controllers/ClientManager/v2/BaseConfig/BaseConfigSessionControlController.php",
            score: 500,
            reason: "Matched token(s): url, string, example",
        },
        {
            id: "SpOTTFrontend\\Http\\Parser\\StoreContentRequestParser::getEventDto",
            type: "method",
            name: "getEventDto",
            file: "apps/spott-frontend/app/Http/Parser/StoreContentRequestParser.php",
            score: 420,
            reason: "Matched token(s): editorial, images",
        },
    ], { type: "api", confidence: 0.95, score: 1, reasons: [], secondary: [] }, ticket, ["editorial", "images"]);

    assert.match(reranked[0]!.id, /StoreContentRequestParser/i);
}

function testImportRerankPenalizesCmsImportUi(): void {
    const ticket = fs.readFileSync(path.join(projectRoot, "tickets/import.txt"), "utf8");
    const reranked = applyWorkflowTargetRerank([
        {
            id: "js:apps/spott-backend/resources/assets/js/views/contentmanager/timeline-markers/import/components/ImportDone.vue::ImportDone",
            type: "vue_component",
            name: "ImportDone",
            file: "apps/spott-backend/resources/assets/js/views/contentmanager/timeline-markers/import/components/ImportDone.vue",
            score: 400,
            reason: "Matched token(s): import",
        },
        {
            id: "SpOTTCommon\\Content\\Import\\ExternalMatch::saveExternalMatchesId",
            type: "method",
            name: "saveExternalMatchesId",
            file: "packages/spott-common/src/Content/Import/ExternalMatch.php",
            score: 350,
            reason: "Matched token(s): import, external",
        },
    ], { type: "import", confidence: 0.95, score: 1, reasons: [], secondary: [] }, ticket, ["providercategory"]);

    assert.match(reranked[0]!.id, /ExternalMatch/i);
}

function run(): void {
    console.log("ticketTargetRerank tests\n");

    testApiFieldRerankPrefersParser();
    console.log("  ✓ api field rerank prefers parser");

    testImportRerankPenalizesCmsImportUi();
    console.log("  ✓ import rerank prefers pipeline over cms import ui");

    console.log("\nAll ticket target rerank tests passed.");
}

run();
