import Database from "better-sqlite3";
import fs from "node:fs";
import { searchNodes, type SearchKind } from "../../graph/queries/searchNodes";
import { shortNavigationLabel } from "../../graph/queries/navigationQueries";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);

const kind = (getOptionValue(args, "--kind") ?? "auto") as SearchKind;
const limit = getIntOption(args, "--limit", 20, 1);
const jsonOutput = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");

if (!dbPath || !query) {
    console.log(`Usage: impactlens find <db.sqlite> "<query>" [--kind=auto|symbol|route|field|config|all] [--limit=20] [--json] [--output=file.txt]`);
    process.exit(2);
}

const db = new Database(dbPath);

try {
    const matches = searchNodes(db, query, { kind, limit });

    if (jsonOutput) {
        const payload = { query, kind, limit, matches };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(matches.length === 0 ? 1 : 0);
    }

    if (matches.length === 0) {
        console.log(`No matches for "${query}" (kind=${kind}).`);
        console.log("Try --kind=route for paths like POST /payments, or --kind=field for request/model fields.");
        process.exit(1);
    }

    const lines = [
        `# Find: ${query}`,
        "",
        `- kind: ${kind}`,
        `- matches: ${matches.length}`,
        "",
        "## Results",
        "",
    ];

    for (const match of matches) {
        lines.push(`- **${match.id}** (${match.type}) — score ${match.score}, ${match.matchReason}`);
        if (match.file) {
            lines.push(`  file: ${match.file}`);
        }
        lines.push(`  label: ${shortNavigationLabel(match.id)}`);
    }

    lines.push("");
    lines.push("## Next");
    lines.push("");
    lines.push(`impactlens ai-context ${dbPath} "${matches[0]!.id.replace(/\\/g, "\\\\")}" --compact`);
    lines.push("");

    const output = lines.join("\n");
    console.log(output);
    if (outputPath) {
        fs.writeFileSync(outputPath, output, "utf8");
    }
} finally {
    db.close();
}
