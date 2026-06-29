import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import { findDeadCode, type DeadCodeOptions } from "../../analyzers/deadCode/DeadCodeAnalyzer";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);

const options: DeadCodeOptions = {
    debugMethodId: getOptionValue(args, "--debug"),
    includeInterfaceResolved: hasFlag(args, "--include-interface-resolved"),
    includeRoutes: !hasFlag(args, "--no-include-routes"),
    includeBladeReferences: !hasFlag(args, "--no-include-blade-references"),
    ignoreConstructors: !hasFlag(args, "--no-ignore-constructors"),
    ignoreControllerActions: !hasFlag(args, "--no-ignore-controller-actions"),
    ignoreMagicMethods: !hasFlag(args, "--no-ignore-magic-methods"),
    ignoreTests: !hasFlag(args, "--no-ignore-tests"),
    ignoreInterfaceMethods: !hasFlag(args, "--no-ignore-interface-methods"),
    ignoreFrameworkMethods: !hasFlag(args, "--no-ignore-framework-methods"),
    ignoreAccessors: !hasFlag(args, "--no-ignore-accessors"),
    ignoreBaseClasses: !hasFlag(args, "--no-ignore-base-classes"),
};


const includeDependsOn = hasFlag(args, "--include-depends-on");
const jsonOutput = hasFlag(args, "--json");
const failOnDeadCode = hasFlag(args, "--fail-on-dead-code");
const limit = getIntOption(args, "--limit", 20, 1);
const outputPath = getOptionValue(args, "--output");

if (!dbPath) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/deadCode.ts Graph.sqlite [--limit=20] [--json] [--include-depends-on] [--include-interface-resolved] [--no-include-routes] [--no-ignore-base-classes] [--fail-on-dead-code] [--debug="Class::method"] [--no-ignore-framework-methods] [--no-ignore-accessors] [--no-ignore-constructors] [--no-ignore-controller-actions] [--no-ignore-magic-methods] [--no-ignore-tests] [--no-ignore-interface-methods] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

try {
    const result = findDeadCode(db, options);

    if (jsonOutput) {
        const payload = {
            ...result,
            includeDependsOn,
            ...options,
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
    log(`   include interface resolved: ${chalk.white(String(options.includeInterfaceResolved))}`);
    log(`   include routes: ${chalk.white(String(options.includeRoutes))}`);
    log(`   include blade refs: ${chalk.white(String(options.includeBladeReferences))}`);
    log(`   showing top: ${chalk.white(limit)}`);
    log();

    log(chalk.blue.bold("Ignore rules"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    log(`   constructors: ${chalk.white(String(options.ignoreConstructors))}`);
    log(`   controller actions: ${chalk.white(String(options.ignoreControllerActions))}`);
    log(`   magic methods: ${chalk.white(String(options.ignoreMagicMethods))}`);
    log(`   tests: ${chalk.white(String(options.ignoreTests))}`);
    log(`   interface methods: ${chalk.white(String(options.ignoreInterfaceMethods))}`);
    log(`   framework methods: ${chalk.white(String(options.ignoreFrameworkMethods))}`);
    log(`   entity accessors: ${chalk.white(String(options.ignoreAccessors))}`);
    log(`   base classes: ${chalk.white(String(options.ignoreBaseClasses))}`);
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
            log(`     ${chalk.gray("incoming routes:")} ${chalk.white(item.incomingRoutes)}`);
            log(`     ${chalk.gray("incoming blade refs:")} ${chalk.white(item.incomingBladeRefs)}`);
            log(`     ${chalk.gray("category:")} ${chalk.white(item.category)}  ${chalk.gray("risk:")} ${chalk.white(item.risk)}`);
            log();
        });

        if (result.items.length > limit) {
            log(chalk.gray(`   ... ${result.items.length - limit} more methods omitted`));
        }
    }

    if (options.debugMethodId) {
        log(chalk.magenta.bold("Debug"));
        log(chalk.magenta("────────────────────────────────────────────────────"));

        if (!result.debug || !result.debug.found) {
            log(chalk.gray(`   Method not found: ${options.debugMethodId}`));
        } else {
            log(`   ${chalk.gray("method:")} ${chalk.white(result.debug.methodId)}`);

            if (result.debug.skippedReason) {
                log(`   ${chalk.gray("skipped reason:")} ${chalk.white(result.debug.skippedReason)}`);
            }

            log(`   ${chalk.gray("direct incoming calls:")} ${chalk.white(result.debug.directIncomingCalls)}`);
            log(`   ${chalk.gray("incoming routes:")} ${chalk.white(result.debug.incomingRoutes)}`);
            log(`   ${chalk.gray("incoming blade refs:")} ${chalk.white(result.debug.incomingBladeRefs)}`);
            log(`   ${chalk.gray("resolved incoming:")} ${chalk.white(result.debug.resolvedIncomingCalls)}`);
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
