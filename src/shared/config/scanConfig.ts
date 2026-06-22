import fs from "node:fs";
import path from "node:path";

export interface ScanConfig {
    pathAliases?: Record<string, string>;
    httpResourceClassPattern?: string;
}

const DEFAULT_CONFIG: ScanConfig = {
    httpResourceClassPattern: "Resource",
};

export function loadScanConfig(rootDir: string): ScanConfig {
    const candidates = [
        path.join(rootDir, "impactlens.config.json"),
        path.join(rootDir, ".impactlens.json"),
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Partial<ScanConfig>;
            return { ...DEFAULT_CONFIG, ...parsed };
        } catch {
            continue;
        }
    }

    return DEFAULT_CONFIG;
}
