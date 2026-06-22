import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import { findDeadCode } from "../../analyzers/deadCode/DeadCodeAnalyzer";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);
const debugMethodId = getOptionValue(args, "--debug");
const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const failOnDeadCode = hasFlag(args, "--fail-on-dead-code");
const limit = getIntOption(args, "--limit", 20, 1);
const outputPath = getOptionValue(args, "--output");

const ignoreConstructors = !hasFlag(args, "--no-ignore-constructors");
const ignoreControllerActions = !hasFlag(args, "--no-ignore-controller-actions");
const ignoreMagicMethods = !hasFlag(args, "--no-ignore-magic-methods");
const ignoreTests = !hasFlag(args, "--no-ignore-tests");
const ignoreInterfaceMethods = !hasFlag(args, "--no-ignore-interface-methods");

if (!dbPath) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/deadCode.ts Graph.sqlite [--limit=20] [--json] [--include-depends-on] [--include-interface-resolved] [--fail-on-dead-code] [--debug="Class::method"] [--no-ignore-constructors] [--no-ignore-controller-actions] [--no-ignore-magic-methods] [--no-ignore-tests] [--no-ignore-interface-methods] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

try {
    const result = findDeadCode(db, {
        debugMethodId,
        includeInterfaceResolved,
        ignoreConstructors,
        ignoreControllerActions,
        ignoreMagicMethods,
        ignoreTests,
        ignoreInterfaceMethods,
    });

    if (jsonOutput) {
        const payload = {
            ...result,
            includeDependsOn,
            includeInterfaceResolved,
            ignoreConstructors,
            ignoreControllerActions,
            ignoreMagicMethods,
            ignoreTests,
            ignoreInterfaceMethods,
            failOnDeadCode,
            limit,
            shownItems: result.items.slice(0, limit),
        };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        if (failOnDeadCode && result.deadMethods > 0) {
            process.exit(1);
        }
        process.exit(0);
    }

    log();
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log(chalk.cyan.bold("                  DEAD CODE REPORT"));
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log();
    log(chalk.blue.bold("Summary"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    log(`   scanned public methods: ${chalk.white(result.scannedMethods)}`);
    log(`   unused public methods: ${chalk.white(result.deadMethods)}`);
    log(`   include depends_on: ${chalk.white(String(includeDependsOn))}`);
    log(`   include interface resolved: ${chalk.white(String(includeInterfaceResolved))}`);
    log(`   showing top: ${chalk.white(limit)}`);
    log();

    log(chalk.blue.bold("Ignore rules"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    log(`   constructors: ${chalk.white(String(ignoreConstructors))}`);
    log(`   controller actions: ${chalk.white(String(ignoreControllerActions))}`);
    log(`   magic methods: ${chalk.white(String(ignoreMagicMethods))}`);
    log(`   tests: ${chalk.white(String(ignoreTests))}`);
    log(`   interface methods: ${chalk.white(String(ignoreInterfaceMethods))}`);
    log();

    if (result.items.length === 0) {
        log(chalk.gray("No unused public methods found."));
    } else {
        log(chalk.yellow.bold("Unused public methods"));
        log(chalk.yellow("────────────────────────────────────────────────────"));
        result.items.slice(0, limit).forEach(item => {
            log(`   ${chalk.yellow("•")} ${chalk.white.bold(item.id)}`);
            log(`     ${chalk.gray("name:")} ${chalk.white(item.name)}`);
            if (item.file) {
                log(`     ${chalk.gray("location:")} ${chalk.gray(item.file)}`);
            }
            log(`     ${chalk.gray("incoming calls:")} ${chalk.white(item.incomingCalls)}`);
            log();
        });

        if (result.items.length > limit) {
            log(chalk.gray(`   ... ${result.items.length - limit} more methods omitted`));
        }
    }

    if (debugMethodId) {
        log(chalk.magenta.bold("Debug"));
        log(chalk.magenta("────────────────────────────────────────────────────"));

        if (!result.debug || !result.debug.found) {
            log(chalk.gray(`   Method not found: ${debugMethodId}`));
        } else {
            log(`   ${chalk.gray("method:")} ${chalk.white(result.debug.methodId)}`);

            if (result.debug.skippedReason) {
                log(`   ${chalk.gray("skipped reason:")} ${chalk.white(result.debug.skippedReason)}`);
            }

            log(`   ${chalk.gray("direct incoming:")} ${chalk.white(result.debug.directIncomingCalls)}`);
            log(`   ${chalk.gray("resolved incoming:")} ${chalk.white(result.debug.resolvedIncomingCalls)}`);
            log(`   ${chalk.gray("interface incoming:")} ${chalk.white(result.debug.interfaceIncomingCalls)}`);
            log(`   ${chalk.gray("inheritance incoming:")} ${chalk.white(result.debug.inheritanceIncomingCalls)}`);
            log(`   ${chalk.gray("inheritance dispatch incoming:")} ${chalk.white(result.debug.inheritanceDispatchIncomingCalls)}`);
            log(`   ${chalk.gray("effective incoming:")} ${chalk.white(result.debug.effectiveIncomingCalls)}`);
            log(`   ${chalk.gray("considered dead:")} ${chalk.white(String(result.debug.consideredDead))}`);
        }

        log();
    }

    log();

    if (outputPath) {
        fs.writeFileSync(outputPath, toText(), "utf8");
    }

    if (failOnDeadCode && result.deadMethods > 0) {
        log(chalk.red.bold(`\n✖  --fail-on-dead-code: ${result.deadMethods} unused public method(s) found. Exiting with code 1.`));
        process.exitCode = 1;
    }
} finally {
    db.close();
}

