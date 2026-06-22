import Parser from "tree-sitter";
import fs from "node:fs";
import { linkCrossLanguageEndpoints } from "../linking/crossLanguageEndpoints";
import { extractHttpResourcesFromSource } from "../resolvers/httpResourceRegexExtractor";
import { resetHttpResourceRegistry } from "../resolvers/httpResourceRegistry";
import { ensureJsModuleNode } from "../astHandlers/jsModule";
import { ScannedJsFile } from "../scanJs";
import { processVueFile } from "../vue/processVueFile";
import { stripTypescript } from "../vue/stripTypescript";
import walk, { createWalkContext } from "../walk/jsWalker";

function isVueFile(relativePath: string): boolean {
    return relativePath.endsWith(".vue");
}

function isTypeScriptFile(relativePath: string): boolean {
    return relativePath.endsWith(".ts") && !relativePath.endsWith(".d.ts");
}

function readSource(file: ScannedJsFile): string {
    const rawSource = fs.readFileSync(file.absolutePath, "utf-8");
    return isTypeScriptFile(file.relativePath)
        ? stripTypescript(rawSource)
        : rawSource;
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

    let vueFiles = 0;

    for (const file of files) {
        if (isVueFile(file.relativePath)) {
            try {
                processVueFile(file, parser);
                vueFiles += 1;
            } catch (error) {
                console.error(`Vue parser crashed on file: ${file.absolutePath}`);
                console.error(error);
            }
            continue;
        }

        try {
            const source = readSource(file);

            try {
                walkJsSource(source, file.relativePath, parser);
            } catch (error) {
                const recovered = recoverHttpResources(source, file.relativePath);
                if (recovered === 0) {
                    console.error(`JS parser crashed on file: ${file.absolutePath}`);
                    console.error(error);
                }
            }
        } catch (error) {
            console.error(`JS parser crashed on file: ${file.absolutePath}`);
            console.error(error);
        }
    }

    if (vueFiles > 0) {
        console.log(`Parsed ${vueFiles} Vue SFC files`);
    }

    const linkStats = linkCrossLanguageEndpoints();
    if (linkStats.canonicalized > 0 || linkStats.merged > 0 || linkStats.backendLinked > 0) {
        console.log(
            `Cross-language endpoints: ${linkStats.canonicalized} canonicalized, ` +
            `${linkStats.merged} merged, ${linkStats.backendLinked} linked to PHP backend`
        );
    }
}
