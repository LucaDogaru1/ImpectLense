import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { analyzeChangeImpact } from "../../analyzers/impact/ImpactScoringAnalyzer";
import { findNode } from "../../graph/queries/GraphQueries";
import { formatLocation } from "../../shared/formatting/text";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getFloatOption, getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const targetId = process.argv[3];
const args = process.argv.slice(4);

const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const verbose = hasFlag(args, "--verbose");
const depth = getIntOption(args, "--depth", 2, 1);
const limit = getIntOption(args, "--limit", 10, 1);
const decay = getFloatOption(args, "--decay", 0.6);
const outputPath = getOptionValue(args, "--output");

if (!dbPath || !targetId) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/changeImpact.ts Graph.sqlite "ClassOrMethodId" [--depth=2] [--limit=10] [--decay=0.6] [--json] [--verbose] [--include-depends-on] [--include-interface-resolved] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

try {
    const target = findNode(db, targetId);

    if (!target) {
        console.log(chalk.red.bold("Node not found"));
        console.log(chalk.gray(`Requested: ${targetId}`));
        process.exit(1);
    }

    const result = analyzeChangeImpact(db, targetId, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        limit,
        decay,
    });
    const whatUsesHeading = target.type === "method"
        ? "What this method uses"
        : target.type === "class"
            ? "What this class uses"
            : "What this node uses";

    if (jsonOutput) {
        const payload = {
            target,
            options: {
                includeDependsOn,
                includeInterfaceResolved,
                depth,
                limit,
                decay,
                verbose,
            },
            changeImpact: result,
        };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(0);
    }

    log();
    log(chalk.cyan.bold("===================================================="));
    log(chalk.cyan.bold("               CHANGE IMPACT REPORT"));
    log(chalk.cyan.bold("===================================================="));
    log();

    log(chalk.blue.bold("Target"));
    log(chalk.blue("----------------------------------------------------"));
    log(`   id: ${chalk.white(target.id)}`);
    log(`   type: ${chalk.white(target.type)}`);
    if (target.name) {
        log(`   name: ${chalk.white(target.name)}`);
    }
    if (target.file) {
        const location = formatLocation(target.file, target.start_row, target.end_row) ?? target.file;
        log(`   location: ${chalk.gray(location)}`);
    }
    log();

    log(chalk.blue.bold("Blast radius"));
    log(chalk.blue("----------------------------------------------------"));
    log(`   risk: ${chalk.white.bold(result.risk)}`);
    log(`   score: ${chalk.white(result.score)} ${chalk.gray("(relative impact score)")}`);
    log(`   upstream consumers: ${chalk.white(result.affectedCallers)} ${chalk.gray(`(entry points: ${result.components.directEntryPoints}, call-chain: ${result.components.directCallChainCallers})`)}`);
    log(`   methods used by target: ${chalk.white(result.methodsUsedByTarget)}`);
    log(`   affected files: ${chalk.white(result.affectedFiles)}`);
    if (verbose && result.affectedFilesList.length > 0) {
        for (const file of result.affectedFilesList) {
            log(`     - ${chalk.gray(path.basename(file))}`);
        }
    }
    log(`   depth: ${chalk.white(result.depth)} ${chalk.gray(`decay=${decay}`)}`);
    log("   components:");
    log(`     ${chalk.gray("direct callers:")} ${chalk.white(result.components.directCallers)} ${chalk.gray("(score:")} ${chalk.white(result.components.directCallerScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("indirect callers:")} ${chalk.white(result.components.indirectCallers)} ${chalk.gray("(score:")} ${chalk.white(result.components.indirectCallerScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("direct callees:")} ${chalk.white(result.components.directCallees)} ${chalk.gray("(score:")} ${chalk.white(result.components.directCalleeScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("dependency links:")} ${chalk.white(result.components.dependencyLinks)} ${chalk.gray("(score:")} ${chalk.white(result.components.dependencyScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("inheritance links:")} ${chalk.white(result.components.inheritanceLinks)} ${chalk.gray("(score:")} ${chalk.white(result.components.inheritanceScore)}${chalk.gray(")")}`);
    log("   technical details:");
    log(`     ${chalk.gray("inspected edges:")} ${chalk.white(result.inspectedEdges)}`);
    log();

    log(chalk.yellow.bold("Upstream consumers"));
    log(chalk.yellow("----------------------------------------------------"));
    if (result.affectedCallersList.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const item of result.affectedCallersList) {
            log(`   ${chalk.yellow("*")} ${chalk.white(item.id)}`);
            log(`     ${chalk.gray("relation:")} ${chalk.white(item.relationType)} ${chalk.gray("distance:")} ${chalk.white(item.distance)} ${chalk.gray("score:")} ${chalk.white(item.score)}`);
            if (item.file) {
                log(`     ${chalk.gray("file:")} ${chalk.gray(item.file)}`);
            }
            log();
        }
    }

    log(chalk.yellow.bold(whatUsesHeading));
    log(chalk.yellow("----------------------------------------------------"));
    if (result.usedByTargetList.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const item of result.usedByTargetList) {
            log(`   ${chalk.yellow("*")} ${chalk.white(item.id)}`);
            log(`     ${chalk.gray("relation:")} ${chalk.white(item.relationType)} ${chalk.gray("score:")} ${chalk.white(item.score)}`);
            if (item.file) {
                log(`     ${chalk.gray("file:")} ${chalk.gray(item.file)}`);
            }
            log();
        }
    }

    log();

    if (outputPath) {
        fs.writeFileSync(outputPath, toText(), "utf8");
    }
} finally {
    db.close();
}

