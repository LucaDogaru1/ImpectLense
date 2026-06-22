import Parser from "tree-sitter";
import fs from "node:fs";
import walk, { createWalkContext } from "../walk/jsWalker";
import { ScannedJsFile } from "../scanJs";
import { findVueComponentOptionsObject } from "./findComponentOptions";
import { splitSfc, VueSfc } from "./splitSfc";
import { stripTypescript } from "./stripTypescript";
import { registerScriptSetupComponent } from "./vueComponentRegistry";

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

export function processVueFile(file: ScannedJsFile, parser: Parser): void {
    const source = fs.readFileSync(file.absolutePath, "utf-8");
    const sfc = splitSfc(source);

    if (!sfc.script?.content) {
        return;
    }

    const scriptSource = sfc.script.lang === "ts" || sfc.script.lang === "tsx"
        ? stripTypescript(sfc.script.content)
        : sfc.script.content;

    let tree: Parser.Tree;

    try {
        tree = parser.parse(scriptSource);
    } catch (error) {
        console.error(`Vue script parser crashed: ${file.absolutePath}`);
        console.error(error);
        return;
    }

    if (tree.rootNode.hasError) {
        console.error(`Error parsing Vue script: ${file.absolutePath}`);
    }

    const externalTemplate = resolveTemplateContent(sfc);
    const context = {
        ...createWalkContext(file.relativePath),
        externalTemplate,
    };

    walk(tree.rootNode, file.relativePath, context);

    const optionsObject = findVueComponentOptionsObject(tree.rootNode);
    if (optionsObject) {
        return;
    }

    if (sfc.script.setup || /\bdefineProps\s*\(/.test(scriptSource)) {
        registerScriptSetupComponent(scriptSource, context, {
            externalTemplate,
            fallbackName: componentFallbackName(file.relativePath),
        });
    }
}
