import fs from "node:fs";
import path from "node:path";

export interface ScannedPhpFile{
    absolutePath: string;
    relativePath: string;
}

export function scanPhpFiles(rootDir:string, FOLDERS_TO_IGNORE: string[], currentDir: string = rootDir): ScannedPhpFile[] {
    const result: ScannedPhpFile[] = [];

    for (const entry of  fs.readdirSync(currentDir, {withFileTypes: true})) {
        const fullPath = path.join(currentDir, entry.name);

        if((entry.isDirectory() && FOLDERS_TO_IGNORE.includes(entry.name)) || entry.name.startsWith(".")) continue;

        if(entry.isDirectory()){
            result.push(...scanPhpFiles(rootDir, FOLDERS_TO_IGNORE, fullPath));
            continue
        }

        if (!entry.isFile() || !entry.name.endsWith('.php')) continue;

        const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
        result.push({ absolutePath: fullPath, relativePath });
    }

    return result;
}