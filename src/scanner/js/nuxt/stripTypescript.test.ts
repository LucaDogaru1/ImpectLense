import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import { createTsParser } from "../ts/parser";
import { parseTsSourceForGraph, tsSourceParsesAsJs } from "./parseTsForGraph";
import { stripTypescript } from "./stripTypescript";

const jsParser = new Parser();
jsParser.setLanguage(JavaScript);
const tsParser = createTsParser();

const nuxtRoot = path.resolve(__dirname, "../../../../../../spott/nuxt");

function testStripsImportType(): void {
    const source = `import type { Foo } from "./foo";
import { bar, type Baz } from "./bar";
export const x = 1;`;

    const stripped = stripTypescript(source);
    assert.ok(!/import\s+type/.test(stripped));
    assert.ok(!/type Baz/.test(stripped));
    assert.match(stripped, /import \{ bar \}/);
    assert.ok(tsSourceParsesAsJs(stripped, jsParser));
}

function testStripsComposableGenerics(): void {
    const source = `import get from "lodash/get";

export const useCollection = (data, locale) => {
  const heading = computed<string>(() => get(unref(data), "title", ""));
  return { heading };
};`;

    assert.ok(tsSourceParsesAsJs(source, tsParser));
}

function testStripsIndexSignatureAnnotation(): void {
    const source = `export const localeImports: { [key: string]: () => Promise<unknown> } = {
  en: () => import("./en.json"),
};`;

    assert.ok(tsSourceParsesAsJs(source, tsParser));
}

function testStripsInterfacesAndInlineAssertions(): void {
    const source = `export interface TokenValue {
  $type: string;
}

export const useCheckoutStore = defineStore("checkout", {
  state: () => ({
    flowType: "none" as FlowType,
    resolvedSteps: [] as StepDefinition[],
  }),
});`;

    assert.ok(tsSourceParsesAsJs(source, tsParser));
}

function testNuxtFixtureFilesWhenPresent(): void {
    const fixtures = [
        "apps/whiteLabel/utils/localeLoader.ts",
        "packages/apiParser/composables/useCollection.ts",
        "packages/payment/stores/useCheckoutStore.ts",
        "packages/ui-design/ui.config/button.ts",
    ];

    let checked = 0;

    for (const fixture of fixtures) {
        const absolutePath = path.join(nuxtRoot, fixture);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        const source = fs.readFileSync(absolutePath, "utf8");
        assert.ok(
            tsSourceParsesAsJs(source, tsParser),
            `expected fixture to parse: ${fixture}`
        );
        checked += 1;
    }

    if (checked === 0) {
        console.log("  ↷ Skipping Nuxt fixture integration — spott/nuxt not found locally");
    }
}

function testParseTsSourceForGraphReturnsTree(): void {
    const tree = parseTsSourceForGraph("export const foo = () => 1;", tsParser);
    assert.equal(tree.rootNode.type, "program");
}

function run(): void {
    console.log("nuxt stripTypescript tests\n");

    testStripsImportType();
    console.log("  ✓ strips import type");

    testStripsComposableGenerics();
    console.log("  ✓ strips composable generics");

    testStripsIndexSignatureAnnotation();
    console.log("  ✓ strips index signature annotations");

    testStripsInterfacesAndInlineAssertions();
    console.log("  ✓ strips interfaces and inline assertions");

    testParseTsSourceForGraphReturnsTree();
    console.log("  ✓ parseTsSourceForGraph returns tree");

    testNuxtFixtureFilesWhenPresent();
    console.log("  ✓ nuxt fixture files when present");

    console.log("\nAll nuxt stripTypescript tests passed.");
}

run();
