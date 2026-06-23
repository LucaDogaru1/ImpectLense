import { spawnSync } from "node:child_process";
import path from "node:path";

type CommandDef = {
    script: string;
    description: string;
};

const COMMANDS: Record<string, CommandDef> = {
    scan: {
        script: "scan.ts",
        description: "Build Graph.sqlite / Graph.json from a codebase",
    },
    ticket: {
        script: "commands/ticket.ts",
        description: "Ticket text → markdown briefing (alias: analyze:ticket)",
    },
    "analyze:ticket": {
        script: "commands/ticket.ts",
        description: "Same as ticket",
    },
    "ai-context": {
        script: "commands/aiContext.ts",
        description: "Compact report for one symbol (alias: analyze:ai-context)",
    },
    "analyze:ai-context": {
        script: "commands/aiContext.ts",
        description: "Same as ai-context",
    },
    "change-impact": {
        script: "commands/changeImpact.ts",
        description: "Blast radius for a symbol (alias: analyze:change-impact)",
    },
    "analyze:change-impact": {
        script: "commands/changeImpact.ts",
        description: "Same as change-impact",
    },
    impact: {
        script: "commands/impact.ts",
        description: "Richer impact report (alias: analyze:impact)",
    },
    "analyze:impact": {
        script: "commands/impact.ts",
        description: "Same as impact",
    },
    architecture: {
        script: "commands/architecture.ts",
        description: "Layer / dependency rule violations",
    },
    "analyze:architecture": {
        script: "commands/architecture.ts",
        description: "Same as architecture",
    },
    cycles: {
        script: "commands/cycles.ts",
        description: "Circular dependency detection",
    },
    "analyze:cycles": {
        script: "commands/cycles.ts",
        description: "Same as cycles",
    },
    "dead-code": {
        script: "commands/deadCode.ts",
        description: "Likely unreachable nodes",
    },
    "analyze:dead-code": {
        script: "commands/deadCode.ts",
        description: "Same as dead-code",
    },
    hotspots: {
        script: "commands/hotspots.ts",
        description: "Heavily connected nodes",
    },
    "analyze:hotspots": {
        script: "commands/hotspots.ts",
        description: "Same as hotspots",
    },
    risk: {
        script: "commands/risk.ts",
        description: "Combined risk ranking",
    },
    "analyze:risk": {
        script: "commands/risk.ts",
        description: "Same as risk",
    },
    "install-skill": {
        script: "",
        description: "Write .cursor/skills/impactlens/SKILL.md in the current project",
    },
};

function printCommands(): void {
    console.log(`ImpactLens commands

Usage:
  impactlens <command> [args...]
  npx impactlens <command> [args...]

Commands:`);

    const seen = new Set<string>();
    for (const [name, def] of Object.entries(COMMANDS)) {
        if (def.script && seen.has(def.script)) {
            continue;
        }
        if (def.script) {
            seen.add(def.script);
        }
        console.log(`  ${name.padEnd(22)} ${def.description}`);
    }
}

function printHelp(): void {
    console.log(`ImpactLens — static code graph + ticket briefings

`);
    printCommands();
    console.log(`
Examples:
  impactlens scan /path/to/repo --lang=both --output=both
  impactlens ticket sqlite/Graph.sqlite --ticket=tickets/issue.txt --scopes=php,js \\
    --answers=ticket_topic:ui,change_includes:cms_ui
  impactlens ai-context sqlite/Graph.sqlite "App\\\\Services\\\\Foo::bar" --compact

List commands only:  impactlens --commands
Full help:           impactlens --help

After npm install, the Cursor agent skill is written to:
  .cursor/skills/impactlens/SKILL.md

Skip auto-install: IMPACTLENS_SKIP_SKILL=1 npm install impactlens
Docs: https://github.com/LucaDogaru1/ImpectLens
`);
}

function tsxCliPath(): string {
    return path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
}

function runTsScript(relativeScript: string, args: string[]): number {
    const scriptPath = path.join(__dirname, relativeScript);
    const result = spawnSync(
        process.execPath,
        [tsxCliPath(), scriptPath, ...args],
        { stdio: "inherit", env: process.env }
    );
    return result.status === null ? 1 : result.status;
}

function runInstallSkill(): number {
    const { installAgentSkill } = require("../../scripts/postinstall.js") as {
        installAgentSkill: (io?: { log?: (msg: string) => void; warn?: (msg: string) => void }) => { ok: boolean };
    };
    installAgentSkill({ log: console.log, warn: console.warn });
    return 0;
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    process.exit(0);
}

if (command === "--commands" || command === "commands") {
    printCommands();
    process.exit(0);
}

const def = COMMANDS[command];
if (!def) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}

if (command === "install-skill") {
    process.exit(runInstallSkill());
}

process.exit(runTsScript(def.script, args.slice(1)));
