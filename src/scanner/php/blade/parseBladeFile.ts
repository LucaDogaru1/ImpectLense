import fs from "node:fs";
import { scanBladeFile } from "./bladeScanner";

export function parseBladeFile(absolutePath: string, relativePath: string): void {
    const content = fs.readFileSync(absolutePath, "utf-8");
    scanBladeFile(relativePath, content);
}
