import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createJsParser } from "../parse/parser";
import { createTsParser } from "../ts/parser";
import { parseVueScript } from "./parseVueScript";
import { processVueFile } from "./processVueFile";
import { resetGraph } from "../../../graph/graph";

const nuxtRoot = path.resolve(__dirname, "../../../../../../spott/nuxt");
const snackBarVue = path.join(
    nuxtRoot,
    "packages/ui-design/components/SnackBar.vue"
);

function testParseVueScriptUsesTypeScriptParserForScriptSetup(): void {
    if (!fs.existsSync(snackBarVue)) {
        console.log("  ↷ Skipping SnackBar.vue fixture — spott/nuxt not found locally");
        return;
    }

    const source = fs.readFileSync(snackBarVue, "utf8");
    const scriptMatch = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch?.[1], "expected script block in SnackBar.vue");

    const parsed = parseVueScript(
        scriptMatch[1]!.trim(),
        "ts",
        createJsParser(),
        createTsParser()
    );

    assert.equal(parsed.usedTsParser, true);
    assert.equal(parsed.tree.rootNode.hasError, false);
}

function testProcessVueFileWalksSnackBar(): void {
    if (!fs.existsSync(snackBarVue)) {
        return;
    }

    resetGraph();

    const result = processVueFile(
        {
            absolutePath: snackBarVue,
            relativePath: "packages/ui-design/components/SnackBar.vue",
        },
        {
            jsParser: createJsParser(),
            tsParser: createTsParser(),
        }
    );

    assert.equal(result.usedTsParser, true);
    assert.equal(result.parseError, false);
}

function run(): void {
    console.log("processVueFile tests\n");

    testParseVueScriptUsesTypeScriptParserForScriptSetup();
    console.log("  ✓ parseVueScript uses TS parser for script setup");

    testProcessVueFileWalksSnackBar();
    console.log("  ✓ processVueFile walks SnackBar.vue");

    console.log("\nAll processVueFile tests passed.");
}

run();
