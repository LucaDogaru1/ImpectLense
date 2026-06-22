import fs from "node:fs";
import path from "node:path";

export interface ScannedJsFile {
    absolutePath: string;
    relativePath: string;
}

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".vue", ".ts"];

export function scanJsFiles(
    rootDir: string,
    foldersToIgnore: string[],
    currentDir: string = rootDir
): ScannedJsFile[] {
    const result: ScannedJsFile[] = [];

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name);

        if (
            (entry.isDirectory() && foldersToIgnore.includes(entry.name)) ||
            entry.name.startsWith(".")
        ) {
            continue;
        }

        if (entry.isDirectory()) {
            result.push(...scanJsFiles(rootDir, foldersToIgnore, fullPath));
            continue;
        }

        if (!entry.isFile() || !JS_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
            continue;
        }

        const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
        result.push({ absolutePath: fullPath, relativePath });
    }

    return result;
}
