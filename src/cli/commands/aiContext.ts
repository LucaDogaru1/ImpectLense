import Database from "better-sqlite3";
import fs from "node:fs";
import { analyzeArchitecture } from "../../analyzers/architecture/ArchitectureAnalyzer";
import { detectCycles } from "../../analyzers/cycles/CycleAnalyzer";
import { analyzeChangeImpact } from "../../analyzers/impact/ImpactScoringAnalyzer";
import {
    findDependsOnRelations,
    findIncomingCalls,
    findInheritanceChain,
    findMethodsByParent,
    findNode,
    findOutgoingCalls,
    getRelationTargetId,
    resolveMethodThroughInheritance,
} from "../../graph/queries/GraphQueries";
import { formatLocation, toBulletList } from "../../shared/formatting/text";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import { buildRiskRanking } from "../shared/riskRanking";

type CallItem = {
    id: string;
    callType: string | null;
    via: string | null;
    file: string | null;
    resolvedTo?: string;
};

type DependencyItem = {
    direction: "outgoing" | "incoming";
    id: string;
    file: string | null;
};

type AiContextPayload = {
    target: {
        id: string;
        type: string;
        location: string | null;
    };
    summary: {
        changeRisk: string;
        impactScore: number;
        riskRank: number | null;
        riskPopulation: number;
        riskPercentileTop: number | null;
        riskCandidatePool: number;
        affectedCallers: number;
        methodsUsedByTarget: number;
        affectedFiles: number;
    };
    purposeGuess: {
        likelyResponsibility: string;
        primaryConsumers: string[];
        mainDependencies: string[];
        riskDrivers: string[];
    };
    callers: CallItem[];
    callees: CallItem[];
    dependencies: DependencyItem[];
    inheritance: string[];
    architecture: Array<{
        severity: string;
        fromId: string;
        toId: string;
        reason: string;
        expected: string;
        detected: string;
        isLikelyFalsePositive: boolean;
        falsePositiveReason: string | null;
    }>;
    cycles: Array<{
        nodes: string[];
        files: string[];
        edgeTypes: string[];
        length: number;
    }>;
    affectedFiles: string[];
};

function toShortName(id: string): string {
    const classPart = id.includes("::") ? id.split("::")[0] : id;
    const className = classPart.split("\\").pop() ?? classPart;
    const method = id.includes("::") ? id.split("::")[1] : "";
    return method ? `${className}::${method}` : className;
}

function dedupeCalls(items: CallItem[], limit: number): CallItem[] {
    const seen = new Set<string>();
    const result: CallItem[] = [];

    for (const item of items) {
        const key = `${item.id}|${item.callType ?? ""}|${item.via ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
        if (result.length >= limit) {
            break;
        }
    }

    return result;
}

function guessPurpose(
    targetId: string,
    targetType: string,
    callers: CallItem[],
    dependencies: DependencyItem[],
    summary: AiContextPayload["summary"],
): AiContextPayload["purposeGuess"] {
    const lower = targetId.toLowerCase();
    let likelyResponsibility = "Application/domain service orchestration";

    if (lower.includes("interface") && (lower.includes("connector") || lower.includes("api"))) {
        likelyResponsibility = "API connector contract / external API read operation";
    } else if (targetType === "interface" || lower.includes("interface")) {
        likelyResponsibility = "Contract/interface definition";
    } else if (lower.includes("connector") || lower.includes("api")) {
        likelyResponsibility = "External API integration";
    } else if (lower.includes("repository")) {
        likelyResponsibility = "Persistence / data access";
    } else if (lower.includes("controller")) {
        likelyResponsibility = "HTTP/API request handling and orchestration";
    } else if (lower.includes("parser")) {
        likelyResponsibility = "Parsing / transformation";
    } else if (lower.includes("provider")) {
        likelyResponsibility = "Framework / bootstrap configuration";
    } else if (lower.includes("content") && lower.includes("service")) {
        likelyResponsibility = "Content retrieval and filtering service";
    } else if (lower.includes("service")) {
        likelyResponsibility = "Business / application logic";
    } else if (lower.includes("job")) {
        likelyResponsibility = "Background job processing";
    }

    const primaryConsumers = Array.from(new Set(callers.map(item => toShortName(item.id)))).slice(0, 5);
    const mainDependencies = Array.from(new Set(
        dependencies
            .filter(dep => dep.direction === "outgoing")
            .map(dep => toShortName(dep.id)),
    )).slice(0, 5);

    const riskDrivers = [
        `${summary.affectedCallers} affected callers`,
        `${summary.affectedFiles} affected files`,
    ];

    return {
        likelyResponsibility,
        primaryConsumers,
        mainDependencies,
        riskDrivers,
    };
}

const dbPath = process.argv[2];
const targetId = process.argv[3];
const args = process.argv.slice(4);

const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const compactOutput = hasFlag(args, "--compact");

const depth = getIntOption(args, "--depth", 2, 1);
const limit = getIntOption(args, "--limit", 20, 1);
const riskCandidatePool = 100;
const outputPath = getOptionValue(args, "--output");

if (!dbPath || !targetId) {
    console.log('Usage: npx tsx src/cli/commands/aiContext.ts Graph.sqlite "ClassOrMethodId" [--depth=2] [--limit=20] [--include-depends-on] [--include-interface-resolved] [--json] [--compact] [--output=report.md]');
    process.exit(2);
}

const db = new Database(dbPath);

function renderDefaultMarkdown(payload: AiContextPayload): string {
    const calls = payload.callees.map(item => {
        if (item.resolvedTo) {
            return `${item.id}\n  resolves to: ${item.resolvedTo}`;
        }
        return item.file ? `${item.id} (${item.file})` : item.id;
    });

    return [
        "# AI Context",
        "",
        "## Target",
        `- id: ${payload.target.id}`,
        `- type: ${payload.target.type}`,
        `- location: ${payload.target.location ?? "unknown"}`,
        "",
        "## Summary",
        `- change risk: ${payload.summary.changeRisk}`,
        `- risk rank: ${payload.summary.riskRank !== null
            ? `${payload.summary.riskRank}/${payload.summary.riskPopulation}`
            : `outside top ${payload.summary.riskCandidatePool} hotspot candidates`
        }`,
        `- percentile: ${payload.summary.riskPercentileTop !== null
            ? `top ${payload.summary.riskPercentileTop}%`
            : "n/a (outside candidate pool)"
        }`,
        `- impact score: ${payload.summary.impactScore}`,
        `- candidate pool: top ${payload.summary.riskCandidatePool} hotspot candidates`,
        `- population: ${payload.summary.riskPopulation} nodes`,
        `- affected callers: ${payload.summary.affectedCallers}`,
        `- methods used by target: ${payload.summary.methodsUsedByTarget}`,
        `- affected files: ${payload.summary.affectedFiles}`,
        "",
        "## Purpose Guess",
        `Likely Responsibility: ${payload.purposeGuess.likelyResponsibility}`,
        "",
        "Primary Consumers:",
        payload.purposeGuess.primaryConsumers.length === 0 ? "- None" : toBulletList(payload.purposeGuess.primaryConsumers),
        "",
        "Main Dependencies:",
        payload.purposeGuess.mainDependencies.length === 0 ? "- None" : toBulletList(payload.purposeGuess.mainDependencies),
        "",
        "Risk Drivers:",
        payload.purposeGuess.riskDrivers.length === 0 ? "- None" : toBulletList(payload.purposeGuess.riskDrivers),
        "",
        "## Called By",
        payload.callers.length === 0
            ? "- None"
            : toBulletList(payload.callers.map(item => item.file ? `${item.id} (${item.file})` : item.id)),
        "",
        "## Calls",
        payload.callees.length === 0
            ? "- None"
            : toBulletList(calls),
        "",
        "## Dependencies",
        payload.dependencies.length === 0
            ? "- None"
            : toBulletList(payload.dependencies.map(dep => dep.file
                ? `${dep.direction}: ${dep.id} (${dep.file})`
                : `${dep.direction}: ${dep.id}`,
            )),
        "",
        "## Inheritance",
        payload.inheritance.length === 0
            ? "- None"
            : toBulletList(payload.inheritance),
        "",
        "## Architecture Notes",
        payload.architecture.length === 0
            ? "- No violations detected"
            : toBulletList(payload.architecture.map(item => {
                const fpMarker = item.isLikelyFalsePositive ? " [likely false positive]" : "";
                const fpNote = item.falsePositiveReason ? ` (${item.falsePositiveReason})` : "";
                return `${item.severity}: ${item.reason} (detected: ${item.detected})${fpMarker}${fpNote}`;
            })),
        "",
        "## Cycles",
        payload.cycles.length === 0
            ? "- No cycles detected"
            : toBulletList(payload.cycles.map(cycle => cycle.nodes.join(" -> "))),
        "",
        "## Suggested Review Scope",
        payload.affectedFiles.length === 0
            ? "- None"
            : toBulletList(payload.affectedFiles),
        "",
        "## Suggested AI Instruction",
        "Use this context to review the target method. Focus on breaking changes, affected callers, dependencies, architecture risks, and files that should be inspected.",
        "",
    ].join("\n");
}

function renderCompactMarkdown(payload: AiContextPayload): string {
    const callerIds = payload.callers.map(item => item.id);
    const calleeIds = payload.callees.map(item => item.resolvedTo ? `${item.id} -> ${item.resolvedTo}` : item.id);
    const dependencyIds = payload.dependencies.map(item => `${item.direction}: ${item.id}`);
    const architectureIds = payload.architecture.map(item => {
        const fpMarker = item.isLikelyFalsePositive ? " [likely false positive]" : "";
        return `${item.severity}: ${item.detected}${fpMarker}`;
    });
    const cyclePaths = payload.cycles.map(cycle => cycle.nodes.join(" -> "));

    return [
        "# AI Context",
        "",
        `- target: ${payload.target.id} (${payload.target.type})`,
        `- location: ${payload.target.location ?? "unknown"}`,
        `- risk: ${payload.summary.changeRisk}`,
        `- risk rank: ${payload.summary.riskRank !== null
            ? `${payload.summary.riskRank}/${payload.summary.riskPopulation}`
            : `outside top ${payload.summary.riskCandidatePool} hotspot candidates`
        }`,
        `- percentile: ${payload.summary.riskPercentileTop !== null
            ? `top ${payload.summary.riskPercentileTop}%`
            : "n/a (outside candidate pool)"
        }`,
        `- impact score: ${payload.summary.impactScore}`,
        `- candidate pool: top ${payload.summary.riskCandidatePool} hotspot candidates`,
        `- population: ${payload.summary.riskPopulation} nodes`,
        `- affected callers: ${payload.summary.affectedCallers}`,
        `- methods used by target: ${payload.summary.methodsUsedByTarget}`,
        `- affected files: ${payload.summary.affectedFiles}`,
        "",
        "## Purpose Guess",
        `- likely responsibility: ${payload.purposeGuess.likelyResponsibility}`,
        `- primary consumers: ${payload.purposeGuess.primaryConsumers.join(", ") || "None"}`,
        `- main dependencies: ${payload.purposeGuess.mainDependencies.join(", ") || "None"}`,
        `- risk drivers: ${payload.purposeGuess.riskDrivers.join(", ") || "None"}`,
        "",
        "## Called By",
        callerIds.length === 0 ? "- None" : toBulletList(callerIds),
        "",
        "## Calls",
        calleeIds.length === 0 ? "- None" : toBulletList(calleeIds),
        "",
        "## Dependencies",
        dependencyIds.length === 0 ? "- None" : toBulletList(dependencyIds),
        "",
        "## Architecture Notes",
        architectureIds.length === 0 ? "- No violations detected" : toBulletList(architectureIds),
        "",
        "## Cycles",
        cyclePaths.length === 0 ? "- No cycles detected" : toBulletList(cyclePaths),
        "",
        "## Suggested Review Scope",
        payload.affectedFiles.length === 0 ? "- None" : toBulletList(payload.affectedFiles),
        "",
        "## Suggested AI Instruction",
        "Use this context to review the target method. Focus on breaking changes, affected callers, dependencies, architecture risks, and files that should be inspected.",
        "",
    ].join("\n");
}

try {
    const target = findNode(db, targetId);

    if (!target) {
        console.log(`Target not found: ${targetId}`);
        process.exit(1);
    }

    const callers = target.type === "class"
        ? dedupeCalls(
            findMethodsByParent(db, target.id)
                .flatMap(methodId => findIncomingCalls(db, methodId, { includeInterfaceResolved, limit })),
            limit,
        )
        : findIncomingCalls(db, target.id, { includeInterfaceResolved, limit });

    const callees = target.type === "class"
        ? dedupeCalls(
            findMethodsByParent(db, target.id)
                .flatMap(methodId => findOutgoingCalls(db, methodId, { includeInterfaceResolved, limit })),
            limit,
        )
        : findOutgoingCalls(db, target.id, { includeInterfaceResolved, limit });
    const relationTargetId = getRelationTargetId(target);
    const inheritance = relationTargetId ? findInheritanceChain(db, relationTargetId) : [];
    const dependencies: DependencyItem[] = includeDependsOn && relationTargetId
        ? findDependsOnRelations(db, relationTargetId, limit)
        : [];

    const changeImpact = analyzeChangeImpact(db, target.id, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        limit,
    });

    const riskRanking = buildRiskRanking(db, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        impactLimit: limit,
        candidatePool: riskCandidatePool,
    });
    const riskPosition = riskRanking.items.find(item => item.id === target.id);

    const architecture = analyzeArchitecture(db, {
        includeDependsOn,
        includeInterfaceResolved,
    });

    const cycles = detectCycles(db, {
        includeDependsOn,
        includeInterfaceResolved,
    });

    const isTargetRelatedNode = (nodeId: string): boolean => {
        return nodeId === target.id
            || (target.type === "class" && nodeId.startsWith(`${target.id}::`))
            || (target.type === "method" && nodeId === relationTargetId);
    };

    const filteredArchitecture = architecture.violations
        .filter(violation => isTargetRelatedNode(violation.fromId) || isTargetRelatedNode(violation.toId))
        .slice(0, limit)
        .map(violation => ({
            severity: violation.severity,
            fromId: violation.fromId,
            toId: violation.toId,
            reason: violation.reason,
            expected: violation.expected,
            detected: violation.detected,
            isLikelyFalsePositive: violation.isLikelyFalsePositive,
            falsePositiveReason: violation.falsePositiveReason,
        }));

    const filteredCycles = cycles.cycles
        .filter(cycle => cycle.nodes.some(nodeId => isTargetRelatedNode(nodeId)))
        .slice(0, limit)
        .map(cycle => ({
            nodes: cycle.nodes,
            files: cycle.files,
            edgeTypes: cycle.edgeTypes,
            length: cycle.length,
        }));

    const payload: AiContextPayload = {
        target: {
            id: target.id,
            type: target.type,
            location: formatLocation(target.file, target.start_row, target.end_row),
        },
        summary: {
            changeRisk: changeImpact.risk,
            impactScore: changeImpact.score,
            riskRank: riskPosition?.riskRank ?? null,
            riskPopulation: riskRanking.population,
            riskPercentileTop: riskPosition?.percentileTop ?? null,
            riskCandidatePool,
            affectedCallers: changeImpact.affectedCallers,
            methodsUsedByTarget: changeImpact.methodsUsedByTarget,
            affectedFiles: changeImpact.affectedFiles,
        },
        purposeGuess: guessPurpose(
            target.id,
            target.type,
            callers.map(item => ({ id: item.id, callType: item.callType, via: item.via, file: item.file })),
            dependencies,
            {
                changeRisk: changeImpact.risk,
                impactScore: changeImpact.score,
                riskRank: riskPosition?.riskRank ?? null,
                riskPopulation: riskRanking.population,
                riskPercentileTop: riskPosition?.percentileTop ?? null,
                riskCandidatePool,
                affectedCallers: changeImpact.affectedCallers,
                methodsUsedByTarget: changeImpact.methodsUsedByTarget,
                affectedFiles: changeImpact.affectedFiles,
            },
        ),
        callers: callers.map(item => ({
            id: item.id,
            callType: item.callType,
            via: item.via,
            file: item.file,
        })),
        callees: callees.map(item => {
            const isMissingTarget = !item.file;
            const resolvedTo = isMissingTarget ? resolveMethodThroughInheritance(db, item.id) : null;
            return {
                id: item.id,
                callType: item.callType,
                via: item.via,
                file: item.file,
                resolvedTo: resolvedTo && resolvedTo !== item.id ? resolvedTo : undefined,
            };
        }),
        dependencies,
        inheritance,
        architecture: filteredArchitecture,
        cycles: filteredCycles,
        affectedFiles: changeImpact.affectedFilesList,
    };

    if (jsonOutput) {
        const output = JSON.stringify(payload, null, 2);
        console.log(output);
        if (outputPath) {
            fs.writeFileSync(outputPath, output, "utf8");
        }
        process.exit(0);
    }

    const markdown = compactOutput ? renderCompactMarkdown(payload) : renderDefaultMarkdown(payload);

    console.log(markdown);
    if (outputPath) {
        fs.writeFileSync(outputPath, markdown, "utf8");
    }
} finally {
    db.close();
}

