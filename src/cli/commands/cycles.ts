import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import { detectCycles } from "../../analyzers/cycles/CycleAnalyzer";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);
const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const failOnCycles = hasFlag(args, "--fail-on-cycles");
const limit = getIntOption(args, "--limit", 20, 1);
const outputPath = getOptionValue(args, "--output");

if (!dbPath) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/cycles.ts Graph.sqlite [--limit=20] [--json] [--include-depends-on] [--include-interface-resolved] [--fail-on-cycles] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

try {
    const result = detectCycles(db, { includeDependsOn, includeInterfaceResolved });

    if (jsonOutput) {
        const payload = {
            ...result,
            limit,
            failOnCycles,
            shownCycles: result.cycles.slice(0, limit),
        };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        if (failOnCycles && result.cycleCount > 0) {
            process.exit(1);
        }
        process.exit(0);
    }

    log();
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log(chalk.cyan.bold("                    CYCLE REPORT"));
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log();
    log(chalk.blue.bold("Summary"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    const edgeLabel = result.includeDependsOn ? "scanned CALLS+DEPENDS_ON edges" : "scanned CALLS edges";
    log(`   ${edgeLabel}: ${chalk.white(result.totalEdges)}`);
    log(`   include interface resolved: ${chalk.white(String(result.includeInterfaceResolved))}`);
    log(`   cycles found: ${chalk.white(result.cycleCount)}`);
    log(`   showing top: ${chalk.white(limit)}`);
    log();

    if (result.cycles.length === 0) {
        log(chalk.gray("No cycles detected."));
    } else {
        log(chalk.red.bold("Cycles"));
        log(chalk.red("────────────────────────────────────────────────────"));
        result.cycles.slice(0, limit).forEach((cycle, index) => {
            log(`   ${chalk.red("↻")} ${chalk.white(`Cycle #${index + 1} length: ${cycle.length}`)}`);
            log(`     ${chalk.gray("path:")} ${chalk.white(cycle.nodes.join(chalk.gray(" → ")))}`);
            log(`     ${chalk.gray("edge types:")} ${chalk.white(cycle.edgeTypes.join(", "))}`);
            if (cycle.files.length > 0) {
                log(`     ${chalk.gray("files:")}`);
                for (const file of cycle.files) {
                    log(`       - ${chalk.gray(file)}`);
                }
            }
            log();
        });

        if (result.cycles.length > limit) {
            log(chalk.gray(`   ... ${result.cycles.length - limit} more cycles omitted`));
        }
    }

    log();

    if (outputPath) {
        fs.writeFileSync(outputPath, toText(), "utf8");
    }

    if (failOnCycles && result.cycleCount > 0) {
        log(chalk.red.bold(`\n✖  --fail-on-cycles: ${result.cycleCount} cycle(s) found. Exiting with code 1.`));
        process.exitCode = 1;
    }
} finally {
    db.close();
}

