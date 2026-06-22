import { getOptionValue } from "../../cli/shared/cliArgs";
import { OutputMode, ScanCliOptions, ScanLanguage } from "../types/scanCli";

export const DEFAULT_SCAN_IGNORE = [
    "vendor", "node_modules", "tests", "test", "cache", "logs",
    "bin", "bootstrap", "build", "database", "docker", "docs",
    "storage", "artisan", "composer.json", "composer.lock", "package.json", "package-lock.json",
    "boost.json", "certs",
];

function parseLanguage(value: string | undefined): ScanLanguage {
    if (value === "php" || value === "js" || value === "both") {
        return value;
    }
    return "both";
}

export function parseScanCliOptions(argv: string[]): ScanCliOptions {
    let rootDir = process.cwd();
    let outputMode: OutputMode = "json";
    let sqlitePath = "sqlite/Graph.sqlite";
    let language: ScanLanguage = "both";
    let mergeExistingGraph = true;
    let graphJsonPath = "Graph.json";

    const outputModeArg = getOptionValue(argv, "--output") as OutputMode | undefined;
    if (outputModeArg === "json" || outputModeArg === "sqlite" || outputModeArg === "both") {
        outputMode = outputModeArg;
    }

    const sqlitePathArg = getOptionValue(argv, "--sqlite-path");
    if (sqlitePathArg) {
        sqlitePath = sqlitePathArg;
    }

    language = parseLanguage(getOptionValue(argv, "--lang"));

    const graphJsonPathArg = getOptionValue(argv, "--graph-json");
    if (graphJsonPathArg) {
        graphJsonPath = graphJsonPathArg;
    }

    if (argv.includes("--no-merge")) {
        mergeExistingGraph = false;
    }

    for (const arg of argv) {
        if (!arg.startsWith("--")) {
            rootDir = arg;
        }
    }

    return { rootDir, outputMode, sqlitePath, language, mergeExistingGraph, graphJsonPath };
}
