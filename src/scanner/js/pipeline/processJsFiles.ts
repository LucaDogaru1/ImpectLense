import Parser from "tree-sitter";
import fs from "node:fs";
import { linkCrossLanguageEndpoints } from "../linking/crossLanguageEndpoints";
import { extractHttpResourcesFromSource } from "../resolvers/httpResourceRegexExtractor";
import { resetHttpResourceRegistry } from "../resolvers/httpResourceRegistry";
import { ensureJsModuleNode } from "../astHandlers/jsModule";
import { ScannedJsFile } from "../scanJs";
import { stripTypescript } from "../nuxt/stripTypescript";
import { createTsParser } from "../ts/parser";
import { processTsFile } from "../ts/processTsFile";
import { processVueFile } from "../vue/processVueFile";
import walk, { createWalkContext } from "../walk/jsWalker";

function isVueFile(relativePath: string): boolean {
    return relativePath.endsWith(".vue");
}

function isTypeScriptFile(relativePath: string): boolean {
    return relativePath.endsWith(".ts") && !relativePath.endsWith(".d.ts");
}

function readSource(file: ScannedJsFile): string {
    return fs.readFileSync(file.absolutePath, "utf-8");
}

function readJsFallbackSource(file: ScannedJsFile): string {
    const rawSource = readSource(file);
    return isTypeScriptFile(file.relativePath) ? stripTypescript(rawSource) : rawSource;
}

function populateHttpResourceRegistry(files: ScannedJsFile[]): void {
    for (const file of files) {
        if (isVueFile(file.relativePath)) {
            continue;
        }

        const source = readSource(file);
        extractHttpResourcesFromSource(source, ensureJsModuleNode(file.relativePath));
    }
}

function walkJsSource(source: string, relativePath: string, parser: Parser): void {
    const tree = parser.parse(source);

    if (tree.rootNode.hasError) {
        throw new Error(`parse errors in ${relativePath}`);
    }

    const context = createWalkContext(relativePath);
    walk(tree.rootNode, relativePath, context);
}

function recoverHttpResources(source: string, relativePath: string): number {
    return extractHttpResourcesFromSource(source, ensureJsModuleNode(relativePath));
}

export function processJsFiles(files: ScannedJsFile[], parser: Parser): void {
    resetHttpResourceRegistry();
    populateHttpResourceRegistry(files);

    const tsParser = createTsParser();
    let vueFiles = 0;
    let vueTsScripts = 0;
    let vueStripFallbackScripts = 0;
    let tsFiles = 0;
    let tsFallbackFiles = 0;

    for (const file of files) {
        if (isVueFile(file.relativePath)) {
            try {
                const result = processVueFile(file, { jsParser: parser, tsParser });
                vueFiles += 1;
                if (result.usedTsParser) {
                    vueTsScripts += 1;
                } else if (result.usedStripFallback) {
                    vueStripFallbackScripts += 1;
                }
            } catch (error) {
                console.error(`Vue parser crashed on file: ${file.absolutePath}`);
                console.error(error);
            }
            continue;
        }

        if (isTypeScriptFile(file.relativePath)) {
            try {
                processTsFile(file, tsParser);
                tsFiles += 1;
            } catch (error) {
                try {
                    walkJsSource(readJsFallbackSource(file), file.relativePath, parser);
                    tsFallbackFiles += 1;
                } catch (fallbackError) {
                    const recovered = recoverHttpResources(readSource(file), file.relativePath);
                    if (recovered === 0) {
                        console.error(`TS parser crashed on file: ${file.absolutePath}`);
                        console.error(error);
                        console.error(fallbackError);
                    }
                }
            }
            continue;
        }

        try {
            walkJsSource(readSource(file), file.relativePath, parser);
        } catch (error) {
            const recovered = recoverHttpResources(readSource(file), file.relativePath);
            if (recovered === 0) {
                console.error(`JS parser crashed on file: ${file.absolutePath}`);
                console.error(error);
            }
        }
    }

    if (vueFiles > 0) {
        console.log(`Parsed ${vueFiles} Vue SFC files`);
    }

    if (vueTsScripts > 0) {
        console.log(`Parsed ${vueTsScripts} Vue <script lang="ts"> blocks (tree-sitter-typescript)`);
    }

    if (vueStripFallbackScripts > 0) {
        console.log(`Parsed ${vueStripFallbackScripts} Vue TS scripts via strip fallback`);
    }

    if (tsFiles > 0) {
        console.log(`Parsed ${tsFiles} TypeScript files (tree-sitter-typescript)`);
    }

    if (tsFallbackFiles > 0) {
        console.log(`Parsed ${tsFallbackFiles} TypeScript files via strip fallback`);
    }

    const linkStats = linkCrossLanguageEndpoints();
    if (linkStats.canonicalized > 0 || linkStats.merged > 0 || linkStats.backendLinked > 0) {
        console.log(
            `Cross-language endpoints: ${linkStats.canonicalized} canonicalized, ` +
            `${linkStats.merged} merged, ${linkStats.backendLinked} linked to PHP backend`
        );
    }
}
