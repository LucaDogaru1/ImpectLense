import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTsParser } from "./parser";
import { processTsFile } from "./processTsFile";
import { resetGraph, graph } from "../../../graph/graph";

const nuxtRoot = path.resolve(__dirname, "../../../../../../spott/nuxt");

const fixtures = [
    "packages/apiParser/composables/useCollection.ts",
    "packages/payment/stores/useCheckoutStore.ts",
    "packages/ui-design/utils/tokenLoader.ts",
    "packages/ui-design/ui.config/button.ts",
];

function testParsesNuxtFixturesWithoutError(): void {
    const parser = createTsParser();
    let checked = 0;

    for (const fixture of fixtures) {
        const absolutePath = path.join(nuxtRoot, fixture);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        const source = fs.readFileSync(absolutePath, "utf8");
        const tree = parser.parse(source);
        assert.equal(
            tree.rootNode.hasError,
            false,
            `expected tree-sitter-typescript to parse ${fixture}`
        );
        checked += 1;
    }

    if (checked === 0) {
        console.log("  ↷ Skipping Nuxt fixture parse test — spott/nuxt not found locally");
        return;
    }
}

function testProcessTsFileBuildsGraphEdges(): void {
    const absolutePath = path.join(nuxtRoot, "packages/apiParser/composables/useCollection.ts");
    if (!fs.existsSync(absolutePath)) {
        console.log("  ↷ Skipping graph walk test — spott/nuxt not found locally");
        return;
    }

    resetGraph();
    const parser = createTsParser();

    processTsFile(
        {
            absolutePath,
            relativePath: "packages/apiParser/composables/useCollection.ts",
        },
        parser
    );

    const importEdges = [...graph.edges.values()].filter(edge => edge.type === "IMPORTS");
    assert.ok(importEdges.length > 0, "expected IMPORTS edges from TS walk");
}

function run(): void {
    console.log("tsParser tests\n");

    testParsesNuxtFixturesWithoutError();
    console.log("  ✓ parses Nuxt fixtures without error");

    testProcessTsFileBuildsGraphEdges();
    console.log("  ✓ processTsFile builds graph edges");

    console.log("\nAll ts parser tests passed.");
}

run();
