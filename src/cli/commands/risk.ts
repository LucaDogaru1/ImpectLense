import Database from "better-sqlite3";
import fs from "node:fs";
import { buildRiskRanking } from "../shared/riskRanking";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const args = process.argv.slice(3);

const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const depth = getIntOption(args, "--depth", 2, 1);
const limit = getIntOption(args, "--limit", 10, 1);
const candidatePool = getIntOption(args, "--candidate-pool", Math.max(limit * 20, 100), 1);
const outputPath = getOptionValue(args, "--output");

if (!dbPath) {
    console.log('Usage: npx tsx src/cli/commands/risk.ts Graph.sqlite [--depth=2] [--limit=10] [--candidate-pool=100] [--include-depends-on] [--include-interface-resolved] [--json] [--output=report.txt]');
    process.exit(2);
}

const db = new Database(dbPath);

try {
    const ranking = buildRiskRanking(db, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        impactLimit: limit,
        candidatePool,
    });
    const top = ranking.items.slice(0, limit);

    if (jsonOutput) {
        const payload = {
            includeDependsOn,
            includeInterfaceResolved,
            depth,
            limit,
            candidatePool: ranking.candidatePool,
            population: ranking.population,
            items: top,
        };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(0);
    }

    const lines: string[] = [];
    lines.push("HIGH RISK COMPONENTS");
    lines.push(`candidate pool: top ${ranking.candidatePool} hotspot candidates`);
    lines.push(`population: ${ranking.population} nodes`);
    lines.push("");

    if (top.length === 0) {
        lines.push("No risk candidates found.");
    } else {
        top.forEach((item, index) => {
            lines.push(`${index + 1}.`);
            lines.push(item.id);
            lines.push(`hotspot score: ${item.hotspotScore}`);
            lines.push(`impact score: ${item.impactScore}`);
            lines.push(`combined score: ${item.combinedScore}`);
            lines.push(`risk: ${item.risk}`);
            lines.push(`risk rank: ${item.riskRank}/${ranking.population}`);
            lines.push(`percentile: top ${item.percentileTop}%`);
            lines.push("");
        });
    }

    const text = lines.join("\n");
    console.log(text);
    if (outputPath) {
        fs.writeFileSync(outputPath, text, "utf8");
    }
} finally {
    db.close();
}

