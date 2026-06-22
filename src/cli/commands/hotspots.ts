import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import { analyzeHotspots } from "../../analyzers/hotspots/HotspotAnalyzer";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);
const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const limit = getIntOption(args, "--limit", 20, 1);
const outputPath = getOptionValue(args, "--output");

if (!dbPath) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/hotspots.ts Graph.sqlite [--limit=20] [--json] [--include-depends-on] [--include-interface-resolved] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

function printHotspotSection(title: string, items: Array<{
    id: string;
    type: string;
    name: string;
    file: string | null;
    incoming: number;
    outgoing: number;
    score: number;
}>, incomingLabel: string, outgoingLabel: string) {
    log(chalk.yellow.bold(title));
    log(chalk.yellow("────────────────────────────────────────────────────"));
    if (items.length === 0) {
        log(chalk.gray("   No entries."));
        log();
        return;
    }

    for (const item of items) {
        log(`   ${chalk.yellow("•")} ${chalk.white.bold(item.id)}`);
        log(`     ${chalk.gray("type:")} ${chalk.white(item.type)} ${chalk.gray("name:")} ${chalk.white(item.name)}`);
        if (item.file) {
            log(`     ${chalk.gray("location:")} ${chalk.gray(item.file)}`);
        }
        log(`     ${chalk.gray(`${incomingLabel}:`)} ${chalk.white(item.incoming)} ${chalk.gray(`${outgoingLabel}:`)} ${chalk.white(item.outgoing)} ${chalk.gray("score:")} ${chalk.white(item.score)}`);
        log();
    }
}

try {
    const result = analyzeHotspots(db, { includeDependsOn, includeInterfaceResolved, limit });

    if (jsonOutput) {
        const json = JSON.stringify(result, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(0);
    }

    log();
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log(chalk.cyan.bold("                 HOTSPOT REPORT"));
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log();
    log(chalk.blue.bold("Summary"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    log(`   inspected nodes: ${chalk.white(result.inspectedNodes)}`);
    log(`   include DEPENDS_ON: ${chalk.white(String(result.includeDependsOn))}`);
    log(`   include interface resolved: ${chalk.white(String(result.includeInterfaceResolved))}`);
    log(`   limit per section: ${chalk.white(result.limit)}`);
    log(`   score formula: ${chalk.white("score = incoming + outgoing")}`);
    log(`   dependency score formula: ${chalk.white("dependency score = incoming dependencies + outgoing dependencies")}`);
    log();

    const incomingLabel = result.includeDependsOn ? "incoming links" : "incoming calls";
    const outgoingLabel = result.includeDependsOn ? "outgoing links" : "outgoing calls";

    printHotspotSection("Method hotspots", result.methodHotspots, incomingLabel, outgoingLabel);
    printHotspotSection("Class hotspots", result.classHotspots, incomingLabel, outgoingLabel);
    printHotspotSection("Dependency hotspots", result.dependencyHotspots, "incoming dependencies", "outgoing dependencies");
    printHotspotSection("Fan-out hotspots", result.fanOutHotspots, incomingLabel, outgoingLabel);

    log();

    if (outputPath) {
        fs.writeFileSync(outputPath, toText(), "utf8");
    }
} finally {
    db.close();
}

