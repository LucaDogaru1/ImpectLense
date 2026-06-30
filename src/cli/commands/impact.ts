import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { analyzeChangeImpact } from "../../analyzers/impact/ImpactScoringAnalyzer";
import { findInheritanceChain, getRelationTargetId, resolveMethodThroughInheritance } from "../../graph/queries/GraphQueries";
import {
    findIncomingGraphEntries,
    formatGraphEntryLabel,
    hasGraphEntry,
    isFrameworkNoiseNodeId,
} from "../../graph/queries/navigationQueries";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

let report = "";

function log(message: string = "") {
    console.log(message);

    const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, "");
    report += cleanMessage + "\n";
}

const dbPath = process.argv[2];
const targetId = process.argv[3];
const args = process.argv.slice(4);
const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const verbose = hasFlag(args, "--verbose");
const enableImpactScore = !hasFlag(args, "--no-impact-score");
const limit = getIntOption(args, "--limit", 20, 1);
const impactDepth = getIntOption(args, "--impact-depth", 2, 1);
const impactLimit = getIntOption(args, "--impact-limit", 5, 1);
const outputPath = getOptionValue(args, "--output") ?? "impact.txt";

if (!dbPath || !targetId) {
    log(
        chalk.red(
            'Usage: npx tsx src/cli/commands/impact.ts Graph.sqlite "Class::method" [--limit=20] [--json] [--verbose] [--include-depends-on] [--include-interface-resolved] [--impact-depth=2] [--impact-limit=5] [--no-impact-score] [--output=report.txt]'
        )
    );
    process.exit(2);
}

const db = new Database(dbPath);

const target = db.prepare(`
    SELECT *
    FROM nodes
    WHERE id = ?
`).get(targetId) as any;

if (!target) {
    log("");
    log(chalk.red.bold("Node not found"));
    log(chalk.gray(`Requested: ${targetId}`));
    log("");

    fs.writeFileSync(outputPath, report, "utf8");

    db.close();
    process.exit(1);
}

const usages = db.prepare(`
    SELECT
        e.from_id,
        e.type,
        e.call_type,
        e.via,
        n.type AS node_type,
        n.name,
        n.file,
        n.start_row,
        n.end_row
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.from_id
    WHERE e.to_id = ?
      AND e.type = 'CALLS'
      AND (
          ? = 1
          OR e.call_type IS NULL
          OR e.call_type != 'INTERFACE_RESOLVED'
      )
`).all(targetId, includeInterfaceResolved ? 1 : 0) as any[];

const graphEntries = target.type === "method"
    ? findIncomingGraphEntries(db, targetId, { includeInterfaceResolved, limit })
    : [];

const entryPoints = graphEntries.filter(entry => entry.kind !== "call");
const hasIncomingUsage = usages.length > 0 || hasGraphEntry(graphEntries);

const dependencies = db.prepare(`
    SELECT
        e.to_id,
        e.type,
        e.call_type,
        e.via,
        n.type AS node_type,
        n.name,
        n.file,
        n.start_row,
        n.end_row
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.type = 'CALLS'
      AND (
          ? = 1
          OR e.call_type IS NULL
          OR e.call_type != 'INTERFACE_RESOLVED'
      )
`).all(targetId, includeInterfaceResolved ? 1 : 0) as any[];

const visibleDependencies = dependencies.filter(dep => !isFrameworkNoiseNodeId(dep.to_id));

const resolvedDependencies = includeInterfaceResolved ? db.prepare(`
    SELECT
        e.to_id,
        e.type,
        e.call_type,
        e.via,
        n.type AS node_type,
        n.name,
        n.file,
        n.start_row,
        n.end_row
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.type = 'CALLS'
      AND e.call_type = 'INTERFACE_RESOLVED'
`).all(targetId) as any[] : [];

const extendsRelations = db.prepare(`
    SELECT
        e.to_id,
        n.type AS node_type,
        n.name,
        n.file
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.type = 'EXTENDS'
`).all(targetId) as any[];

const implementsRelations = db.prepare(`
    SELECT
        e.to_id,
        n.type AS node_type,
        n.name,
        n.file
    FROM edges e
    LEFT JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.type = 'IMPLEMENTS'
`).all(targetId) as any[];

function groupByCallKind(rows: Array<{ type?: string; call_type?: string }>): string {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const key = row.call_type ?? row.type ?? "UNKNOWN";
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([kind, count]) => `${kind}(${count})`)
        .join(", ");
}

const outgoingByType = groupByCallKind([...visibleDependencies, ...resolvedDependencies]);
const incomingByType = groupByCallKind(usages);

const unresolvedCallsRaw = visibleDependencies.filter(dep => {
    const isMissingTarget = !dep.node_type;
    const hasResolvedAlternative = resolvedDependencies.some(
        resolved => resolved.via === dep.to_id
    );
    return isMissingTarget && !hasResolvedAlternative;
});

const inheritedResolvedCalls = unresolvedCallsRaw
    .map(dep => {
        const resolvedId = resolveMethodThroughInheritance(db, dep.to_id);
        if (!resolvedId || resolvedId === dep.to_id) {
            return null;
        }
        return {
            unresolvedId: dep.to_id as string,
            resolvedId,
        };
    })
    .filter((item): item is { unresolvedId: string; resolvedId: string } => Boolean(item));

const inheritedResolvedSet = new Set(inheritedResolvedCalls.map(item => item.unresolvedId));
const unresolvedCalls = unresolvedCallsRaw.filter(dep => !inheritedResolvedSet.has(dep.to_id));

const resolvedInterfaceMap = new Set<string>();
for (const resolved of resolvedDependencies) {
    if (resolved.via && resolved.to_id) {
        resolvedInterfaceMap.add(`${resolved.via} -> ${resolved.to_id}`);
    }
}
for (const usage of usages) {
    if (usage.call_type === "INTERFACE_RESOLVED" && usage.via) {
        resolvedInterfaceMap.add(`${usage.via} -> ${target.id}`);
    }
}

const relationTargetId = getRelationTargetId(target);
const inheritanceChain = relationTargetId ? findInheritanceChain(db, relationTargetId) : [];

const dependsOnOutgoing = includeDependsOn && relationTargetId
    ? db.prepare(`
        SELECT
            e.to_id,
            n.type AS node_type,
            n.name,
            n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.to_id
        WHERE e.from_id = ?
          AND e.type = 'DEPENDS_ON'
    `).all(relationTargetId) as any[]
    : [];

const dependsOnIncoming = relationTargetId
    && includeDependsOn
    ? db.prepare(`
        SELECT
            e.from_id,
            n.type AS node_type,
            n.name,
            n.file
        FROM edges e
        LEFT JOIN nodes n ON n.id = e.from_id
        WHERE e.to_id = ?
          AND e.type = 'DEPENDS_ON'
    `).all(relationTargetId) as any[]
    : [];

const directImplements = relationTargetId
    ? db.prepare(`
        SELECT to_id
        FROM edges
        WHERE from_id = ?
          AND type = 'IMPLEMENTS'
    `).all(relationTargetId) as Array<{ to_id: string }>
    : [];

const containedMethods = relationTargetId
    ? db.prepare(`
        SELECT id, name, file
        FROM nodes
        WHERE type = 'method'
          AND parent = ?
        ORDER BY id ASC
    `).all(relationTargetId) as Array<{ id: string; name: string; file: string | null }>
    : [];

const mostImportantMethods = relationTargetId
    ? db.prepare(`
        SELECT
            m.id,
            m.name,
            m.file,
            SUM(CASE WHEN e.from_id = m.id THEN 1 ELSE 0 END) AS outgoing,
            SUM(CASE WHEN e.to_id = m.id THEN 1 ELSE 0 END) AS incoming
        FROM nodes m
        LEFT JOIN edges e ON (
            (e.from_id = m.id OR e.to_id = m.id)
            AND e.type = 'CALLS'
            AND (
                ? = 1
                OR e.call_type IS NULL
                OR e.call_type != 'INTERFACE_RESOLVED'
            )
        )
        WHERE m.type = 'method'
          AND m.parent = ?
        GROUP BY m.id, m.name, m.file
        ORDER BY (incoming + outgoing) DESC, m.id ASC
        LIMIT ?
    `).all(includeInterfaceResolved ? 1 : 0, relationTargetId, limit) as Array<{
        id: string;
        name: string;
        file: string | null;
        outgoing: number;
        incoming: number;
    }>
    : [];

const neighborStats = new Map<string, { score: number; in: number; out: number }>();
for (const row of usages) {
    const current = neighborStats.get(row.from_id) ?? { score: 0, in: 0, out: 0 };
    current.score += 1;
    current.in += 1;
    neighborStats.set(row.from_id, current);
}
if (includeDependsOn) {
    for (const relation of dependsOnIncoming) {
        const current = neighborStats.get(relation.from_id) ?? { score: 0, in: 0, out: 0 };
        current.score += 1;
        current.in += 1;
        neighborStats.set(relation.from_id, current);
    }
    for (const relation of dependsOnOutgoing) {
        const current = neighborStats.get(relation.to_id) ?? { score: 0, in: 0, out: 0 };
        current.score += 1;
        current.out += 1;
        neighborStats.set(relation.to_id, current);
    }
}
for (const row of [...visibleDependencies, ...resolvedDependencies]) {
    const current = neighborStats.get(row.to_id) ?? { score: 0, in: 0, out: 0 };
    current.score += 1;
    current.out += 1;
    neighborStats.set(row.to_id, current);
}
const topNeighbors = Array.from(neighborStats.entries())
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, limit);

// ── Cycle detection ─────────────────────────────────────────────────────────

const allCallEdges = db.prepare(`
    SELECT from_id, to_id
    FROM edges
    WHERE type = 'CALLS'
      AND (
          ? = 1
          OR call_type IS NULL
          OR call_type != 'INTERFACE_RESOLVED'
      )
`).all(includeInterfaceResolved ? 1 : 0) as Array<{ from_id: string; to_id: string }>;

const callGraph = new Map<string, string[]>();
for (const edge of allCallEdges) {
    const existing = callGraph.get(edge.from_id) ?? [];
    existing.push(edge.to_id);
    callGraph.set(edge.from_id, existing);
}

function detectCycles(start: string, maxDepth = 10): string[][] {
    const foundCycles: string[][] = [];
    const seen = new Set<string>();

    function dfs(current: string, path: string[]): void {
        if (path.length > maxDepth) return;

        const neighbors = callGraph.get(current) ?? [];
        for (const neighbor of neighbors) {
            if (neighbor === start) {
                foundCycles.push([...path, neighbor]);
                continue;
            }
            if (seen.has(neighbor)) continue;
            seen.add(neighbor);
            dfs(neighbor, [...path, neighbor]);
            seen.delete(neighbor);
        }
    }

    seen.add(start);
    dfs(start, [start]);
    return foundCycles;
}

const ARCH_LAYERS: Record<string, number> = {
    "Controller": 0,
    "Http":       0,
    "Presentation": 0,
    "UseCase":    1,
    "UseCases":   1,
    "Service":    2,
    "Services":   2,
    "Repository": 3,
    "Repositories": 3,
    "Domain":     4,
    "Infrastructure": 5,
};

function detectLayer(id: string): string | undefined {
    const classId = id.includes("::") ? id.split("::")[0] : id;
    for (const key of Object.keys(ARCH_LAYERS)) {
        if (classId.includes(key)) return key;
    }
    return undefined;
}

function isArchitecturalViolation(from: string, to: string): string | null {
    const fromLayer = detectLayer(from);
    const toLayer   = detectLayer(to);
    if (!fromLayer || !toLayer) return null;
    const fromRank = ARCH_LAYERS[fromLayer];
    const toRank   = ARCH_LAYERS[toLayer];
    if (fromRank > toRank) {
        return `${fromLayer}(${fromRank}) → ${toLayer}(${toRank}) — lower layer calls upper layer`;
    }
    return null;
}

const cycles = detectCycles(targetId);
const changeImpact = enableImpactScore
    ? analyzeChangeImpact(db, targetId, {
        includeDependsOn,
        includeInterfaceResolved,
        depth: impactDepth,
        limit: impactLimit,
    })
    : null;

const archViolations: string[] = [];
for (const dep of [...visibleDependencies, ...resolvedDependencies]) {
    const violation = isArchitecturalViolation(targetId, dep.to_id);
    if (violation) {
        archViolations.push(`${targetId} → ${dep.to_id}  [${violation}]`);
    }
}

if (includeDependsOn) {
    for (const dep of dependsOnOutgoing) {
        const violation = isArchitecturalViolation(relationTargetId ?? targetId, dep.to_id);
        if (violation) {
            archViolations.push(`${relationTargetId ?? targetId} → ${dep.to_id}  [${violation}]`);
        }
    }
}

if (jsonOutput) {
    const payload = {
        target,
        options: {
            includeDependsOn,
            includeInterfaceResolved,
            limit,
            verbose,
            impactScore: enableImpactScore,
            impactDepth,
            impactLimit,
        },
        stats: {
            incomingCalls: usages.length,
            incomingEntryPoints: entryPoints.length,
            outgoingCalls: visibleDependencies.length,
            extendsCount: extendsRelations.length,
            implementsCount: implementsRelations.length,
            dependsOnOutgoing: dependsOnOutgoing.length,
            dependsOnIncoming: dependsOnIncoming.length,
            cycles: cycles.length,
            archViolations: archViolations.length,
        },
        usages: usages.slice(0, limit),
        entryPoints: entryPoints.slice(0, limit),
        graphEntries: graphEntries.slice(0, limit),
        dependencies: visibleDependencies.slice(0, limit),
        resolvedDependencies: resolvedDependencies.slice(0, limit),
        extendsRelations,
        implementsRelations,
        dependsOnOutgoing: dependsOnOutgoing.slice(0, limit),
        dependsOnIncoming: dependsOnIncoming.slice(0, limit),
        containedMethods: containedMethods.slice(0, limit),
        mostImportantMethods,
        cycles: cycles.slice(0, limit),
        archViolations: archViolations.slice(0, limit),
        topNeighbors,
        unresolvedCalls: unresolvedCalls.slice(0, limit),
        inheritedResolvedCalls,
        changeImpact,
    };

    const json = JSON.stringify(payload, null, 2);
    console.log(json);
    fs.writeFileSync(outputPath, json, "utf8");
    db.close();
    process.exit(0);
}

log("");
log(chalk.cyan.bold("════════════════════════════════════════════════════"));
log(chalk.cyan.bold("                  IMPACT REPORT"));
log(chalk.cyan.bold("════════════════════════════════════════════════════"));
log("");

log(chalk.blue.bold("📍 Selected node"));
log(chalk.blue("────────────────────────────────────────────────────"));
log(`   ${chalk.white.bold(target.id)}`);
log(`   Type: ${chalk.magenta(target.type)}`);

if (target.name) {
    log(`   Name: ${chalk.white(target.name)}`);
}

if (target.parent) {
    log(`   Parent: ${chalk.white(target.parent)}`);
}

if (target.visibility) {
    log(`   Visibility: ${chalk.white(target.visibility)}`);
}

if (target.is_static !== null && target.is_static !== undefined) {
    log(
        `   Static: ${chalk.white(
            Boolean(target.is_static).toString()
        )}`
    );
}

if (target.file) {
    log(
        `   Location: ${chalk.gray(
            `${target.file}:${target.start_row}-${target.end_row}`
        )}`
    );
}

log("");

log(chalk.blue.bold("🧠 Compact summary"));
log(chalk.blue("────────────────────────────────────────────────────"));
log(`   node_kind: ${chalk.white(target.type)}`);
log(
    `   relation_summary: ${chalk.gray("in_calls=")}${chalk.white(usages.length)} ` +
    `${chalk.gray("entry_points=")}${chalk.white(entryPoints.length)} ` +
    `${chalk.gray("out_calls=")}${chalk.white(visibleDependencies.length)} ` +
    `${chalk.gray("extends=")}${chalk.white(extendsRelations.length)} ` +
    `${chalk.gray("implements=")}${chalk.white(implementsRelations.length)} ` +
    `${chalk.gray("depends_out=")}${chalk.white(dependsOnOutgoing.length)} ` +
    `${chalk.gray("depends_in=")}${chalk.white(dependsOnIncoming.length)}`
);
log(`   incoming_by_type: ${chalk.white(incomingByType || "-")}`);
log(`   outgoing_by_type: ${chalk.white(outgoingByType || "-")}`);
log(`   include_interface_resolved: ${chalk.white(String(includeInterfaceResolved))}`);
log(`   include_depends_on: ${chalk.white(String(includeDependsOn))}`);
log(`   limit: ${chalk.white(String(limit))}`);

const unresolvedIds = unresolvedCalls.map(row => row.to_id);
log(`   unresolved calls: ${chalk.white(String(unresolvedCalls.length))}`);
if (unresolvedIds.length > 0) {
    log(`   unresolved_call_ids: ${chalk.white(unresolvedIds.join(", "))}`);
}
log(`   inherited call resolutions: ${chalk.white(String(inheritedResolvedCalls.length))}`);
if (inheritedResolvedCalls.length > 0) {
    for (const mapping of inheritedResolvedCalls) {
        log(`     ${chalk.green("↳")} ${chalk.white(`${mapping.unresolvedId} -> ${mapping.resolvedId}`)}`);
    }
}

const resolvedMapList = Array.from(resolvedInterfaceMap);
log(`   resolved interface calls: ${chalk.white(String(resolvedMapList.length))}`);
for (const mapping of resolvedMapList) {
    log(`     ${chalk.yellow("↳")} ${chalk.white(mapping)}`);
}

if (relationTargetId) {
    const inheritanceDisplay = inheritanceChain.length > 0
        ? `${relationTargetId} -> ${inheritanceChain.join(" -> ")}`
        : `${relationTargetId}`;
    log(`   inheritance_chain: ${chalk.white(inheritanceDisplay)}`);
}

if (directImplements.length > 0) {
    log(`   implements: ${chalk.white(directImplements.map(item => item.to_id).join(", "))}`);
}

if (containedMethods.length > 0) {
    log(`   contained_methods: ${chalk.white(String(containedMethods.length))}`);
}

if (topNeighbors.length > 0) {
    log(`   Most connected nodes:`);
    for (const [neighborId, stats] of topNeighbors) {
        log(
            `     ${chalk.yellow("•")} ${chalk.white(neighborId)} ` +
            `${chalk.gray("(score=")}${chalk.white(stats.score)}${chalk.gray(", in=")}${chalk.white(stats.in)}` +
            `${chalk.gray(", out=")}${chalk.white(stats.out)}${chalk.gray(")")}`
        );
    }
}

if (changeImpact) {
    const whatUsesHeading = changeImpact.targetType === "method"
        ? "What this method uses"
        : changeImpact.targetType === "class"
            ? "What this class uses"
            : "What this node uses";
    log("");
    log(chalk.red.bold("💥 Change impact scoring"));
    log(chalk.red("────────────────────────────────────────────────────"));
    log(`   risk: ${chalk.white.bold(String(changeImpact.risk))}`);
    log(`   score: ${chalk.white(String(changeImpact.score))} ${chalk.gray("(relative impact score)")}`);
    log(`   upstream consumers: ${chalk.white(String(changeImpact.affectedCallers))} ${chalk.gray(`(entry points: ${changeImpact.components.directEntryPoints}, call-chain: ${changeImpact.components.directCallChainCallers})`)}`);
    log(`   methods used by target: ${chalk.white(String(changeImpact.methodsUsedByTarget ?? changeImpact.usedDependencies))}`);
    log(`   affected files: ${chalk.white(String(changeImpact.affectedFiles))}`);
    if (verbose && changeImpact.affectedFilesList.length > 0) {
        for (const file of changeImpact.affectedFilesList) {
            log(`     - ${chalk.gray(path.basename(file))}`);
        }
    }
    log(`   depth: ${chalk.white(String(changeImpact.depth))}`);
    log("   components:");
    log(`     ${chalk.gray("direct callers:")} ${chalk.white(changeImpact.components.directCallers)} ${chalk.gray("(score:")} ${chalk.white(changeImpact.components.directCallerScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("entry points:")} ${chalk.white(changeImpact.components.directEntryPoints)} ${chalk.gray("call-chain:")} ${chalk.white(changeImpact.components.directCallChainCallers)}`);
    log(`     ${chalk.gray("indirect callers:")} ${chalk.white(changeImpact.components.indirectCallers)} ${chalk.gray("(score:")} ${chalk.white(changeImpact.components.indirectCallerScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("direct callees:")} ${chalk.white(changeImpact.components.directCallees)} ${chalk.gray("(score:")} ${chalk.white(changeImpact.components.directCalleeScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("dependency links:")} ${chalk.white(changeImpact.components.dependencyLinks)} ${chalk.gray("(score:")} ${chalk.white(changeImpact.components.dependencyScore)}${chalk.gray(")")}`);
    log(`     ${chalk.gray("inheritance links:")} ${chalk.white(changeImpact.components.inheritanceLinks)} ${chalk.gray("(score:")} ${chalk.white(changeImpact.components.inheritanceScore)}${chalk.gray(")")}`);
    log("   technical details:");
    log(`     ${chalk.gray("inspected edges:")} ${chalk.white(String(changeImpact.inspectedEdges))}`);

    log("");
    log(chalk.red.bold("Upstream consumers"));
    log(chalk.red("────────────────────────────────────────────────────"));
    if (changeImpact.affectedCallersList.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const item of changeImpact.affectedCallersList) {
            log(`   ${chalk.red("•")} ${chalk.white(item.id)}`);
            log(`     ${chalk.gray("relation:")} ${chalk.white(item.relationType)} ${chalk.gray("distance:")} ${chalk.white(item.distance)} ${chalk.gray("score:")} ${chalk.white(item.score)}`);
        }
    }

    log("");
    log(chalk.red.bold(whatUsesHeading));
    log(chalk.red("────────────────────────────────────────────────────"));
    if (changeImpact.usedByTargetList.length === 0) {
        log(chalk.gray("   -"));
    } else {
        for (const item of changeImpact.usedByTargetList) {
            log(`   ${chalk.red("•")} ${chalk.white(item.id)}`);
            log(`     ${chalk.gray("relation:")} ${chalk.white(item.relationType)} ${chalk.gray("score:")} ${chalk.white(item.score)}`);
        }
    }
}

if (
    !hasIncomingUsage &&
    target.type === "method" &&
    target.visibility === "public"
) {
    log("");
    log(chalk.yellow.bold("⚠️  Potentially unused public method"));
    log(chalk.yellow("   No internal callers, routes, or blade actions found in this codebase."));
    log(chalk.gray("   Note: public methods may be called from outside the scanned scope"));
    log(chalk.gray("   (e.g. framework routing, external consumers, tests)."));
}

log("");

// ── Cycles ──────────────────────────────────────────────────────────────────
if (cycles.length > 0) {
    log(chalk.red.bold("🔄 Cycles detected"));
    log(chalk.red("────────────────────────────────────────────────────"));
    for (const cycle of cycles.slice(0, limit)) {
        log(`   ${chalk.red("↻")} ${chalk.white(cycle.join(chalk.gray(" → ")))}`);
    }
    if (cycles.length > limit) {
        log(chalk.gray(`   ... ${cycles.length - limit} more cycles omitted`));
    }
    log("");
}

// ── Architectural violations ─────────────────────────────────────────────────
if (archViolations.length > 0) {
    log(chalk.yellow.bold("⚠️  Architectural violations"));
    log(chalk.yellow("────────────────────────────────────────────────────"));
    for (const v of archViolations.slice(0, limit)) {
        log(`   ${chalk.yellow("!")} ${chalk.white(v)}`);

        const [fromId, toId] = v.split("  [")[0].split(" → ");
        const fromLayer = detectLayer(fromId?.trim() ?? "");
        const toLayer   = detectLayer(toId?.trim() ?? "");

        if (fromLayer && toLayer) {
            log(chalk.gray(`   Suggested fix:`));
            log(chalk.gray(`     Move shared logic into a ${fromLayer} or a UseCase.`));
            log(chalk.gray(`     ${toLayer} should call ${fromLayer}, not ${fromLayer} → ${toLayer}.`));
        }
        log("");
    }
    if (archViolations.length > limit) {
        log(chalk.gray(`   ... ${archViolations.length - limit} more violations omitted`));
        log("");
    }
}

if (extendsRelations.length > 0 || implementsRelations.length > 0) {
    log(chalk.magenta.bold("📦 Relationships"));
    log(chalk.magenta("────────────────────────────────────────────────────"));

    if (extendsRelations.length > 0) {
        log(chalk.cyan("   EXTENDS:"));
        for (const relation of extendsRelations) {
            log(
                `     ↳ ${chalk.white.bold(relation.to_id)}`
            );
            if (relation.name) {
                log(
                    `       ${chalk.gray("name:")} ${chalk.white(relation.name)}`
                );
            }
            if (relation.file) {
                log(
                    `       ${chalk.gray("location:")} ${chalk.gray(relation.file)}`
                );
            }
        }
    }

    if (implementsRelations.length > 0) {
        log(chalk.cyan("   IMPLEMENTS:"));
        for (const relation of implementsRelations) {
            log(
                `     ↳ ${chalk.white.bold(relation.to_id)}`
            );
            if (relation.name) {
                log(
                    `       ${chalk.gray("name:")} ${chalk.white(relation.name)}`
                );
            }
            if (relation.file) {
                log(
                    `       ${chalk.gray("location:")} ${chalk.gray(relation.file)}`
                );
            }
        }
    }

    log("");
}

if (dependsOnOutgoing.length > 0 || dependsOnIncoming.length > 0) {
    log(chalk.magenta.bold("🧩 Dependencies (DEPENDS_ON)"));
    log(chalk.magenta("────────────────────────────────────────────────────"));

    if (dependsOnOutgoing.length > 0) {
        log(chalk.cyan("   OUTGOING DEPENDS_ON:"));
        for (const relation of dependsOnOutgoing) {
            log(`     ↳ ${chalk.white.bold(relation.to_id)}`);
            if (relation.name) {
                log(`       ${chalk.gray("name:")} ${chalk.white(relation.name)}`);
            }
            if (relation.file) {
                log(`       ${chalk.gray("location:")} ${chalk.gray(relation.file)}`);
            }
        }
    }

    if (dependsOnIncoming.length > 0) {
        log(chalk.cyan("   INCOMING DEPENDS_ON:"));
        for (const relation of dependsOnIncoming) {
            log(`     ↳ ${chalk.white.bold(relation.from_id)}`);
            if (relation.name) {
                log(`       ${chalk.gray("name:")} ${chalk.white(relation.name)}`);
            }
            if (relation.file) {
                log(`       ${chalk.gray("location:")} ${chalk.gray(relation.file)}`);
            }
        }
    }

    log("");
}

if (containedMethods.length > 0) {
    log(chalk.magenta.bold("🧱 Contained methods"));
    log(chalk.magenta("────────────────────────────────────────────────────"));
    for (const method of containedMethods.slice(0, limit)) {
        log(`   - ${chalk.white(method.name)} ${chalk.gray(`(${method.id})`)}`);
    }
    if (containedMethods.length > limit) {
        log(chalk.gray(`   ... ${containedMethods.length - limit} more methods omitted`));
    }
    log("");
}

if (mostImportantMethods.length > 0) {
    log(chalk.magenta.bold("⭐ Most important methods"));
    log(chalk.magenta("────────────────────────────────────────────────────"));
    for (const method of mostImportantMethods) {
        const score = Number(method.incoming ?? 0) + Number(method.outgoing ?? 0);
        log(`   - ${chalk.white(method.name)} ${chalk.gray(`score=${score}, in=${method.incoming}, out=${method.outgoing}`)}`);
    }
    log("");
}

log("");

if (target.type === "class") {
    log(chalk.green.bold("⬅️  Incoming usage"));
} else {
    log(chalk.green.bold("⬅️  Who uses me?"));
}
log(chalk.green("────────────────────────────────────────────────────"));

if (!hasIncomingUsage) {
    log(chalk.gray("   No incoming CALLS, ROUTES_TO, or BLADE_USES_ACTION found."));
    if (target.type === "class" && includeDependsOn) {
        log(chalk.gray(`   Incoming DEPENDS_ON found: ${dependsOnIncoming.length}`));
    }
} else {
    for (const entry of entryPoints.slice(0, limit)) {
        log(
            `   ${chalk.green("←")} ${chalk.white.bold(formatGraphEntryLabel(entry))}`,
        );
        log(
            `     ${chalk.gray("entry type:")} ${chalk.white(entry.kind === "route" ? "ROUTES_TO" : "BLADE_USES_ACTION")}`,
        );
        log("");
    }

    for (const row of usages.slice(0, limit)) {
        log(
            `   ${chalk.green("←")} ${chalk.white.bold(
                row.from_id
            )}`
        );

        if (row.call_type) {
            log(
                `     ${chalk.gray("call type:")} ${chalk.white(
                    row.call_type
                )}`
            );
        }

        if (row.via) {
            log(
                `     ${chalk.gray("via:")} ${chalk.white(
                    row.via
                )}`
            );
        }

        if (row.node_type || row.name) {
            log(
                `     ${chalk.gray("type:")} ${chalk.magenta(
                    row.node_type ?? "unknown"
                )} ${chalk.gray("name:")} ${chalk.white(
                    row.name ?? "-"
                )}`
            );
        }

        if (row.file) {
            log(
                `     ${chalk.gray("location:")} ${chalk.gray(
                    `${row.file}:${row.start_row}-${row.end_row}`
                )}`
            );
        }

        log("");
    }
    if (usages.length > limit) {
        log(chalk.gray(`   ... ${usages.length - limit} more incoming calls omitted`));
    }
    if (entryPoints.length > limit) {
        log(chalk.gray(`   ... ${entryPoints.length - limit} more entry points omitted`));
    }
}

log("");

log(chalk.yellow.bold("➡️  What do I use?"));
log(chalk.yellow("────────────────────────────────────────────────────"));

if (visibleDependencies.length === 0) {
    log(chalk.gray("   No outgoing CALLS found."));
} else {
    for (const row of visibleDependencies.slice(0, limit)) {
        log(
            `   ${chalk.yellow("→")} ${chalk.white.bold(
                row.to_id
            )}`
        );

        if (row.call_type) {
            log(
                `     ${chalk.gray("call type:")} ${chalk.white(
                    row.call_type
                )}`
            );
        }

        if (row.node_type || row.name) {
            log(
                `     ${chalk.gray("type:")} ${chalk.magenta(
                    row.node_type ?? "unknown"
                )} ${chalk.gray("name:")} ${chalk.white(
                    row.name ?? "-"
                )}`
            );
        }

        if (row.file) {
            log(
                `     ${chalk.gray("location:")} ${chalk.gray(
                    `${row.file}:${row.start_row}-${row.end_row}`
                )}`
            );
        }

        const resolvedForThisCall = resolvedDependencies.filter(
            resolved => resolved.via === row.to_id
        );

        if (resolvedForThisCall.length > 0) {
            log(`     ${chalk.gray("resolved to:")}`);

            for (const resolved of resolvedForThisCall) {
                log(
                    `       ${chalk.yellow("↳")} ${chalk.white.bold(
                        resolved.to_id
                    )}`
                );

                if (resolved.node_type || resolved.name) {
                    log(
                        `         ${chalk.gray("type:")} ${chalk.magenta(
                            resolved.node_type ?? "unknown"
                        )} ${chalk.gray("name:")} ${chalk.white(
                            resolved.name ?? "-"
                        )}`
                    );
                }

                if (resolved.file) {
                    log(
                        `         ${chalk.gray("location:")} ${chalk.gray(
                            `${resolved.file}:${resolved.start_row}-${resolved.end_row}`
                        )}`
                    );
                }
            }
        }

        log("");
    }
    if (visibleDependencies.length > limit) {
        log(chalk.gray(`   ... ${visibleDependencies.length - limit} more outgoing calls omitted`));
    }
}
log(chalk.cyan.bold("════════════════════════════════════════════════════"));
log("");

fs.writeFileSync(
    outputPath,
    report,
    "utf8"
);

db.close();