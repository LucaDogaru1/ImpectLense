import Database from "better-sqlite3";

export interface ArchitectureViolation {
    fromId: string;
    toId: string;
    edgeType: string;
    severity: "HIGH" | "MEDIUM";
    fromLayer: string;
    toLayer: string;
    reason: string;
    expected: string;
    detected: string;
    isLikelyFalsePositive: boolean;
    falsePositiveReason: string | null;
}

export interface ArchitectureResult {
    inspectedEdges: number;
    violationCount: number;
    likelyFalsePositiveCount: number;
    actionableViolationCount: number;
    includeDependsOn: boolean;
    includeInterfaceResolved: boolean;
    bySourceLayer: Record<string, number>;
    byTargetLayer: Record<string, number>;
    violations: ArchitectureViolation[];
}

export interface ArchitectureLayerRule {
    fromLayer?: string;
    toLayer?: string;
    edgeType?: string;
}

export interface ArchitectureRuleConfig {
    ignorePatterns?: string[];
    allow?: Array<string | ArchitectureLayerRule>;
}

type SQLiteDatabase = InstanceType<typeof Database>;

interface ArchitectureOptions {
    includeDependsOn?: boolean;
    includeInterfaceResolved?: boolean;
    ruleConfig?: ArchitectureRuleConfig;
}

const ARCH_LAYERS: Record<string, number> = {
    Presentation: 0,
    Http: 0,
    Controller: 0,
    UseCase: 1,
    UseCases: 1,
    Service: 2,
    Services: 2,
    Repository: 3,
    Repositories: 3,
    Domain: 4,
    Infrastructure: 5,
};

const LAYER_PATTERNS: Array<{ key: keyof typeof ARCH_LAYERS; regex: RegExp }> = [
    { key: "Infrastructure", regex: /(^|\\)Infrastructure(\\|$)/ },
    { key: "Domain", regex: /(^|\\)Domain(\\|$)/ },
    { key: "Presentation", regex: /(^|\\)Presentation(\\|$)/ },
    { key: "Http", regex: /(^|\\)Http(\\|$)/ },
    { key: "Controller", regex: /(^|\\)Controllers?(\\|$)/ },
    { key: "UseCases", regex: /(^|\\)UseCases(\\|$)/ },
    { key: "UseCase", regex: /(^|\\)UseCase(\\|$)/ },
    { key: "Services", regex: /(^|\\)Services(\\|$)/ },
    { key: "Service", regex: /(^|\\)Service(\\|$)/ },
    { key: "Repositories", regex: /(^|\\)Repositories(\\|$)/ },
    { key: "Repository", regex: /(^|\\)Repository(\\|$)/ },
];

function detectLayer(id: string): string | undefined {
    const classId = id.includes("::") ? id.split("::")[0] : id;
    for (const pattern of LAYER_PATTERNS) {
        if (pattern.regex.test(classId)) {
            return pattern.key;
        }
    }
    return undefined;
}

const LAYER_CANONICAL: Record<string, string> = {
    Presentation:   "Controller",
    Http:           "Controller",
    Controller:     "Controller",
    UseCase:        "UseCase",
    UseCases:       "UseCase",
    Service:        "Service",
    Services:       "Service",
    Repository:     "Repository",
    Repositories:   "Repository",
    Domain:         "Domain",
    Infrastructure: "Infrastructure",
};

interface ViolationRule {
    expected: string;
}

const VIOLATION_RULES: Partial<Record<string, Partial<Record<string, ViolationRule>>>> = {
    Infrastructure: {
        Controller:  { expected: "Controller → Service → Repository ← Infrastructure" },
        UseCase:     { expected: "UseCase → Service → Repository ← Infrastructure" },
        Service:     { expected: "Service → Repository ← Infrastructure" },
        Repository:  { expected: "Service → Repository ← Infrastructure" },
    },
    Domain: {
        Controller:  { expected: "Controller → UseCase → Service → Domain" },
        UseCase:     { expected: "UseCase → Service → Domain" },
        Service:     { expected: "Service → Repository → Domain" },
        Repository:  { expected: "Service → Repository → Domain" },
    },
    Repository: {
        Controller:  { expected: "Controller → Service → Repository" },
        UseCase:     { expected: "UseCase → Service → Repository" },
        Service:     { expected: "Service → Repository" },
    },
    Service: {
        Controller:  { expected: "Controller → Service → Repository" },
        UseCase:     { expected: "UseCase → Service → Repository" },
    },
    UseCase: {
        Controller:  { expected: "Controller → UseCase → Service → Repository" },
    },
};

function buildViolation(
    fromLayer: string,
    toLayer: string,
    edgeType: string,
): { reason: string; expected: string; detected: string } {
    const fromCanon = LAYER_CANONICAL[fromLayer] ?? fromLayer;
    const toCanon   = LAYER_CANONICAL[toLayer]   ?? toLayer;
    const verb      = edgeType === "DEPENDS_ON" ? "depend on" : "call";
    const rule      = VIOLATION_RULES[fromCanon]?.[toCanon];
    return {
        reason:   `${fromLayer} code should not ${verb} ${toLayer} code.`,
        expected: rule?.expected ?? `${toLayer} → ... → ${fromLayer}`,
        detected: `${fromLayer} → ${toLayer}`,
    };
}

const HTTP_FRAMEWORK_PREFIXES: RegExp[] = [
    /^Illuminate\\Http(\\|$)/,
    /^Illuminate\\Support\\Facades\\Http(::|\\|$)/,
    /^Psr\\Http(\\|$)/,
    /^Symfony\\Component\\HttpFoundation(\\|$)/,
    /^GuzzleHttp(\\|$)/,
];

const REQUEST_MEMBER_NAMES = new Set([
    "all",
    "cookie",
    "filled",
    "get",
    "getClientIp",
    "getHost",
    "getMethod",
    "getPathInfo",
    "has",
    "hasHeader",
    "header",
    "input",
    "is",
    "path",
    "query",
    "route",
    "userAgent",
]);

interface CompiledPatternRule {
    raw: string;
    from?: RegExp;
    to?: RegExp;
    fromLayer?: string;
    toLayer?: string;
    edgeType?: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
    const escaped = escapeRegExp(pattern.trim())
        .replace(/\\\*/g, ".*")
        .replace(/\\\?/g, ".");
    return new RegExp(`^${escaped}$`);
}

function parseEdgePattern(pattern: string): { from: RegExp; to: RegExp } | null {
    const parts = pattern.split(/\s*->\s*/);
    if (parts.length !== 2) {
        return null;
    }

    return {
        from: globToRegExp(parts[0]),
        to: globToRegExp(parts[1]),
    };
}

function compileArchitectureRules(ruleConfig?: ArchitectureRuleConfig): CompiledPatternRule[] {
    const compiled: CompiledPatternRule[] = [];

    for (const pattern of ruleConfig?.ignorePatterns ?? []) {
        const edgePattern = parseEdgePattern(pattern);
        if (edgePattern) {
            compiled.push({ raw: pattern, from: edgePattern.from, to: edgePattern.to });
        }
    }

    for (const rule of ruleConfig?.allow ?? []) {
        if (typeof rule === "string") {
            const edgePattern = parseEdgePattern(rule);
            if (!edgePattern) {
                continue;
            }

            compiled.push({ raw: rule, from: edgePattern.from, to: edgePattern.to });
            continue;
        }

        compiled.push({
            raw: `${rule.fromLayer ?? "*"} -> ${rule.toLayer ?? "*"}${rule.edgeType ? ` [${rule.edgeType}]` : ""}`,
            fromLayer: rule.fromLayer,
            toLayer: rule.toLayer,
            edgeType: rule.edgeType,
        });
    }

    return compiled;
}

function matchesRulePattern(rule: CompiledPatternRule, fromId: string, toId: string, fromLayer: string, toLayer: string, edgeType: string): boolean {
    if (rule.edgeType && rule.edgeType !== edgeType) {
        return false;
    }

    if (rule.fromLayer && rule.fromLayer !== fromLayer) {
        return false;
    }

    if (rule.toLayer && rule.toLayer !== toLayer) {
        return false;
    }

    if (rule.from && rule.to) {
        return rule.from.test(fromId) && rule.to.test(toId);
    }

    return Boolean(rule.fromLayer || rule.toLayer || rule.edgeType);
}

function classifyArchitectureFalsePositive(
    fromId: string,
    toId: string,
    fromLayer: string,
    toLayer: string,
    edgeType: string,
    compiledRules: CompiledPatternRule[],
): string | null {
    for (const rule of compiledRules) {
        if (matchesRulePattern(rule, fromId, toId, fromLayer, toLayer, edgeType)) {
            return `Matched architecture rule: ${rule.raw}`;
        }
    }

    if (toLayer === "Http") {
        const isFrameworkHttp = HTTP_FRAMEWORK_PREFIXES.some(pattern => pattern.test(toId));
        if (isFrameworkHttp) {
            const memberName = toId.split("::").pop() ?? "";
            const isRequestMember = REQUEST_MEMBER_NAMES.has(memberName);
            const isRequestNamespace = /Request(::|\\|$)/.test(toId);
            const isClientHttp = /^(Illuminate\\Http\\Client|Psr\\Http|Symfony\\Component\\HttpFoundation|GuzzleHttp)/.test(toId);

            if (isRequestMember || isRequestNamespace || isClientHttp) {
                return `${fromLayer} -> Http targets framework/request or HTTP-client namespaces and is often integration code, not presentation coupling.`;
            }
        }
    }

    const sourceLooksLikeRepository = /Repository/.test(fromId);
    if (sourceLooksLikeRepository && /::query$/.test(toId)) {
        return "Repository -> Eloquent/ORM query access is often a normal persistence boundary crossing, not an architectural layer violation.";
    }

    return null;
}

function isArchitecturalViolation(
    from: string,
    to: string,
    edgeType: string,
    compiledRules: CompiledPatternRule[],
): ArchitectureViolation | null {
    const fromLayer = detectLayer(from);
    const toLayer = detectLayer(to);

    if (!fromLayer || !toLayer) {
        return null;
    }

    const fromRank = ARCH_LAYERS[fromLayer];
    const toRank = ARCH_LAYERS[toLayer];

    if (fromRank > toRank) {
        const severity = edgeType === "DEPENDS_ON" ? "MEDIUM" : "HIGH";
        const { reason, expected, detected } = buildViolation(fromLayer, toLayer, edgeType);
        const falsePositiveReason = classifyArchitectureFalsePositive(from, to, fromLayer, toLayer, edgeType, compiledRules);
        return {
            fromId: from,
            toId: to,
            edgeType,
            severity,
            fromLayer,
            toLayer,
            reason,
            expected,
            detected,
            isLikelyFalsePositive: Boolean(falsePositiveReason),
            falsePositiveReason,
        };
    }

    return null;
}

export function analyzeArchitecture(db: SQLiteDatabase, options?: ArchitectureOptions): ArchitectureResult {
    const includeDependsOn = options?.includeDependsOn ?? false;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;
    const compiledRules = compileArchitectureRules(options?.ruleConfig);

    const edgeRows = db.prepare(`
        SELECT from_id, to_id, type, call_type
        FROM edges
        WHERE (
            type = 'CALLS'
            AND (
                ? = 1
                OR call_type IS NULL
                OR call_type != 'INTERFACE_RESOLVED'
            )
        )
        OR (
            ? = 1
            AND type = 'DEPENDS_ON'
        )
        ORDER BY from_id ASC, to_id ASC
    `).all(includeInterfaceResolved ? 1 : 0, includeDependsOn ? 1 : 0) as Array<{ from_id: string; to_id: string; type: string; call_type: string | null }>;

    const violations: ArchitectureViolation[] = [];
    const bySourceLayer: Record<string, number> = {};
    const byTargetLayer: Record<string, number> = {};

    for (const edge of edgeRows) {
        const violation = isArchitecturalViolation(edge.from_id, edge.to_id, edge.type, compiledRules);
        if (violation) {
            violations.push(violation);
            bySourceLayer[violation.fromLayer] = (bySourceLayer[violation.fromLayer] ?? 0) + 1;
            byTargetLayer[violation.toLayer] = (byTargetLayer[violation.toLayer] ?? 0) + 1;
        }
    }

    violations.sort((a, b) => {
        const severityRankA = a.severity === "HIGH" ? 0 : 1;
        const severityRankB = b.severity === "HIGH" ? 0 : 1;
        if (severityRankA !== severityRankB) {
            return severityRankA - severityRankB;
        }
        return `${a.fromId}->${a.toId}`.localeCompare(`${b.fromId}->${b.toId}`);
    });

    const likelyFalsePositiveCount = violations.filter(item => item.isLikelyFalsePositive).length;
    const actionableViolationCount = violations.length - likelyFalsePositiveCount;

    return {
        inspectedEdges: edgeRows.length,
        violationCount: violations.length,
        likelyFalsePositiveCount,
        actionableViolationCount,
        includeDependsOn,
        includeInterfaceResolved,
        bySourceLayer,
        byTargetLayer,
        violations,
    };
}

