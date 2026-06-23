import Parser from "tree-sitter";
import fs from "node:fs";
import walk, { createWalkContext } from "../walk/jsWalker";
import { ScannedJsFile } from "../scanJs";
import { findVueComponentOptionsObject } from "./findComponentOptions";
import { parseVueScript } from "./parseVueScript";
import { splitSfc, VueSfc } from "./splitSfc";
import { registerScriptSetupComponent } from "./vueComponentRegistry";

export interface ProcessVueFileOptions {
    jsParser: Parser;
    tsParser: Parser;
}

export interface ProcessVueFileResult {
    usedTsParser: boolean;
    usedStripFallback: boolean;
    parseError: boolean;
}

function resolveTemplateContent(sfc: VueSfc): string | undefined {
    const template = sfc.template;
    if (!template?.content) {
        return undefined;
    }

    const lang = template.lang ?? "html";
    if (lang === "pug" || lang === "jade") {
        return undefined;
    }

    return template.content;
}

function componentFallbackName(relativePath: string): string {
    const base = relativePath.split("/").pop() ?? "default";
    if (base === "index.vue") {
        const parts = relativePath.split("/");
        return parts[parts.length - 2] ?? "default";
    }

    return base.replace(/\.vue$/i, "");
}

export function processVueFile(
    file: ScannedJsFile,
    options: ProcessVueFileOptions
): ProcessVueFileResult {
    const source = fs.readFileSync(file.absolutePath, "utf-8");
    const sfc = splitSfc(source);

    if (!sfc.script?.content) {
        return { usedTsParser: false, usedStripFallback: false, parseError: false };
    }

    const rawScript = sfc.script.content;
    let parsed: ReturnType<typeof parseVueScript>;

    try {
        parsed = parseVueScript(
            rawScript,
            sfc.script.lang,
            options.jsParser,
            options.tsParser
        );
    } catch (error) {
        console.error(`Vue script parser crashed: ${file.absolutePath}`);
        console.error(error);
        return { usedTsParser: false, usedStripFallback: false, parseError: true };
    }

    if (parsed.tree.rootNode.hasError) {
        console.error(`Error parsing Vue script: ${file.absolutePath}`);
    }

    const externalTemplate = resolveTemplateContent(sfc);
    const context = {
        ...createWalkContext(file.relativePath),
        externalTemplate,
    };

    walk(parsed.tree.rootNode, file.relativePath, context);

    const optionsObject = findVueComponentOptionsObject(parsed.tree.rootNode);
    if (optionsObject) {
        return {
            usedTsParser: parsed.usedTsParser,
            usedStripFallback: parsed.usedStripFallback,
            parseError: parsed.tree.rootNode.hasError,
        };
    }

    if (sfc.script.setup || /\bdefineProps\s*[<(]/.test(rawScript)) {
        registerScriptSetupComponent(parsed.scriptSource, context, {
            externalTemplate,
            fallbackName: componentFallbackName(file.relativePath),
        });
    }

    return {
        usedTsParser: parsed.usedTsParser,
        usedStripFallback: parsed.usedStripFallback,
        parseError: parsed.tree.rootNode.hasError,
    };
}
