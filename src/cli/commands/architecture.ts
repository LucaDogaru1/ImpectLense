import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import { analyzeArchitecture, ArchitectureRuleConfig } from "../../analyzers/architecture/ArchitectureAnalyzer";
import { createReportLogger } from "../../shared/reporting/reportLogger";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);
const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const failOnViolations = hasFlag(args, "--fail-on-violations");
const ignoreLikelyFalsePositives = hasFlag(args, "--ignore-likely-false-positives");
const limit = getIntOption(args, "--limit", 20, 1);
const outputPath = getOptionValue(args, "--output");
const architectureConfigPath = getOptionValue(args, "--architecture-config");
let architectureRuleConfig: ArchitectureRuleConfig | undefined;

if (architectureConfigPath) {
    const rawConfig = fs.readFileSync(architectureConfigPath, "utf8");
    const parsed = JSON.parse(rawConfig) as { architecture?: ArchitectureRuleConfig } & ArchitectureRuleConfig;
    architectureRuleConfig = parsed.architecture ?? ((parsed.ignorePatterns || parsed.allow)
        ? {
            ignorePatterns: parsed.ignorePatterns,
            allow: parsed.allow,
        }
        : undefined);
}

if (!dbPath) {
    console.log(chalk.red('Usage: npx tsx src/cli/commands/architecture.ts Graph.sqlite [--limit=20] [--json] [--include-depends-on] [--include-interface-resolved] [--ignore-likely-false-positives] [--architecture-config=impactlens.config.json] [--fail-on-violations] [--output=report.txt]'));
    process.exit(2);
}

const db = new Database(dbPath);
const { log, toText } = createReportLogger();

try {
    const result = analyzeArchitecture(db, { includeDependsOn, includeInterfaceResolved, ruleConfig: architectureRuleConfig });
    const activeViolations = ignoreLikelyFalsePositives
        ? result.violations.filter(item => !item.isLikelyFalsePositive)
        : result.violations;
    const activeViolationCount = activeViolations.length;

    if (jsonOutput) {
        const payload = {
            ...result,
            architectureConfigPath: architectureConfigPath ?? null,
            ignoreLikelyFalsePositives,
            activeViolationCount,
            limit,
            failOnViolations,
            shownViolations: activeViolations.slice(0, limit),
        };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        if (failOnViolations && activeViolationCount > 0) {
            process.exit(1);
        }
        process.exit(0);
    }

    log();
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log(chalk.cyan.bold("               ARCHITECTURE REPORT"));
    log(chalk.cyan.bold("════════════════════════════════════════════════════"));
    log();
    log(chalk.blue.bold("Summary"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    const inspectedLabel = includeDependsOn ? "inspected CALLS+DEPENDS_ON edges" : "inspected CALLS edges";
    log(`   ${inspectedLabel}: ${chalk.white(result.inspectedEdges)}`);
    log(`   include interface resolved: ${chalk.white(String(includeInterfaceResolved))}`);
    log(`   violations (total): ${chalk.white(result.violationCount)}`);
    log(`   likely false positives: ${chalk.white(result.likelyFalsePositiveCount)}`);
    log(`   actionable violations: ${chalk.white(result.actionableViolationCount)}`);
    log(`   ignore likely false positives: ${chalk.white(String(ignoreLikelyFalsePositives))}`);
    log(`   architecture config: ${chalk.white(architectureConfigPath ?? "(none)")}`);
    log(`   active violations (after filters): ${chalk.white(activeViolationCount)}`);
    log(`   showing top: ${chalk.white(limit)}`);
    log();

    log(chalk.blue.bold("By source layer"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    const sourceLayers = Object.entries(result.bySourceLayer).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (sourceLayers.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const [layer, count] of sourceLayers) {
            log(`   ${layer}: ${chalk.white(count)}`);
        }
    }
    log();

    log(chalk.blue.bold("By target layer"));
    log(chalk.blue("────────────────────────────────────────────────────"));
    const targetLayers = Object.entries(result.byTargetLayer).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (targetLayers.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const [layer, count] of targetLayers) {
            log(`   ${layer}: ${chalk.white(count)}`);
        }
    }
    log();

    if (activeViolations.length === 0) {
        log(chalk.gray("No architectural violations found."));
    } else {
        log(chalk.yellow.bold("Violations"));
        log(chalk.yellow("────────────────────────────────────────────────────"));
        activeViolations.slice(0, limit).forEach((violation, index) => {
            const shortFrom = violation.fromId.split("\\").pop() ?? violation.fromId;
            const shortTo   = violation.toId.split("\\").pop()   ?? violation.toId;
            const marker = violation.isLikelyFalsePositive ? chalk.gray(" [likely false positive]") : "";
            log(`   ${chalk.yellow("!")} ${chalk.white(`#${index + 1} ${shortFrom} → ${shortTo}`)}${marker}`);
            log(`     ${chalk.gray("severity:")}   ${chalk.white(violation.severity)}`);
            log(`     ${chalk.gray("reason:")}     ${chalk.white(violation.reason)}`);
            log(`     ${chalk.gray("expected:")}   ${chalk.white(violation.expected)}`);
            log(`     ${chalk.gray("detected:")}   ${chalk.white(violation.detected)}`);
            if (violation.falsePositiveReason) {
                log(`     ${chalk.gray("fp note:")}    ${chalk.white(violation.falsePositiveReason)}`);
            }
            log();
        });

        if (activeViolations.length > limit) {
            log(chalk.gray(`   ... ${activeViolations.length - limit} more violations omitted`));
        }
    }

    log();

    if (outputPath) {
        fs.writeFileSync(outputPath, toText(), "utf8");
    }

    if (failOnViolations && activeViolationCount > 0) {
        log(chalk.red.bold(`\n✖  --fail-on-violations: ${activeViolationCount} active violation(s) found. Exiting with code 1.`));
        process.exitCode = 1;
    }
} finally {
    db.close();
}

