export type WorkflowType =
    | "api"
    | "import"
    | "queue"
    | "cron"
    | "ui"
    | "migration"
    | "background"
    | "unknown";

export interface WorkflowScore {
    type: WorkflowType;
    score: number;
    confidence: number;
    reasons: string[];
}

export interface DominantWorkflow {
    type: WorkflowType;
    score: number;
    confidence: number;
    reasons: string[];
    secondary: WorkflowScore[];
}

export interface FalsePositivePenalty {
    whenPrimaryWorkflow: WorkflowType;
    nodeIncludes: string[];
    unlessTicketIncludes?: string[];
    penalty: number;
    reason: string;
}

export interface WorkflowConfig {
    falsePositivePenalties: FalsePositivePenalty[];
}

const DEFAULT_FALSE_POSITIVE_PENALTIES: FalsePositivePenalty[] = [
    {
        whenPrimaryWorkflow: "import",
        nodeIncludes: ["controller", "http/controllers", "api/v3"],
        unlessTicketIncludes: ["post api/", "put api/", "patch api/", "delete api/", "request payload", "request body"],
        penalty: 70,
        reason: "API controller looks like side-effect, not primary import implementation",
    },
    {
        whenPrimaryWorkflow: "queue",
        nodeIncludes: ["controller", "http/controllers", "stream", "download"],
        penalty: 80,
        reason: "queue ticket should not start from playback/API controller",
    },
    {
        whenPrimaryWorkflow: "queue",
        nodeIncludes: ["vtdsync", "recordingneedstobedeleted", "unassignedfiles", "movefilestodeletefolder"],
        penalty: 150,
        reason: "matched tokens but known unrelated job for SQS/archive tickets",
    },
    {
        whenPrimaryWorkflow: "queue",
        nodeIncludes: ["\\consumer\\", "/consumer/", "validateconsumerkey", "apikeygenerator", "consumerrepository"],
        penalty: 220,
        reason: "API consumer/auth class, not an SQS queue handler",
    },
    {
        whenPrimaryWorkflow: "queue",
        nodeIncludes: ["syncservice", "recordingstatuscontroller"],
        unlessTicketIncludes: ["avcmp", "sync status", "recording status"],
        penalty: 120,
        reason: "AVCMP sync path is not the SQS expired-object archive flow",
    },
    {
        whenPrimaryWorkflow: "api",
        nodeIncludes: ["job", "consumer", "listener", "console/commands"],
        unlessTicketIncludes: ["queue", "sqs", "message", "background"],
        penalty: 60,
        reason: "API ticket should not start from background entrypoint",
    },
];

function normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreWorkflows(ticketText: string, tokens: string[]): WorkflowScore[] {
    const lower = normalize(ticketText);
    const keywordSet = new Set(tokens.map(token => token.toLowerCase()));
    const scores: WorkflowScore[] = [];

    const workflowSignals: Record<Exclude<WorkflowType, "unknown">, { strong: string[]; medium: string[]; weak: string[] }> = {
        import: {
            strong: ["nightly import", "xml feed", "csv import", "external provider", "import process"],
            medium: ["import", "imported", "feed", "provider", "transformer", "mapping", "ingest", "xml", "csv"],
            weak: ["parse", "sync", "batch"],
        },
        api: {
            strong: ["post api/", "put api/", "patch api/", "delete api/", "get api/", "request payload", "request body"],
            medium: ["api", "payload", "response", "field", "property", "endpoint"],
            weak: ["returns", "expose", "contract"],
        },
        queue: {
            strong: ["sqs message", "queue message", "consume the sqs", "sqs event"],
            medium: ["sqs", "queue", "consumer", "listener", "message", "filepath", "bucket"],
            weak: ["event received", "async", "notification"],
        },
        cron: {
            strong: ["nightly job", "scheduled job", "cron job"],
            medium: ["cron", "scheduled", "nightly", "daily", "hourly"],
            weak: ["periodic", "recurring"],
        },
        ui: {
            strong: ["cms editor", "display in cms", "visible in cms", "cms detail"],
            medium: ["ui", "cms", "editor", "dashboard", "screen", "display"],
            weak: ["visible", "filter", "review", "show"],
        },
        migration: {
            strong: ["database migration", "schema migration", "alter table"],
            medium: ["migration", "column", "table", "constraint"],
            weak: ["persisted", "stored"],
        },
        background: {
            strong: ["background job", "worker job"],
            medium: ["job", "worker", "background", "process"],
            weak: ["async", "task"],
        },
    };

    for (const [workflowType, signalConfig] of Object.entries(workflowSignals)) {
        const type = workflowType as Exclude<WorkflowType, "unknown">;
        let score = 0;
        const reasons: string[] = [];

        const addMatches = (signals: string[], weight: number, label: string): void => {
            for (const signal of signals) {
                const signalLower = signal.toLowerCase();
                if (lower.includes(signalLower) || keywordSet.has(signalLower)) {
                    score += weight;
                    reasons.push(`${label}: ${signal}`);
                }
            }
        };

        if (type === "queue" && /sqs|queue|arn:aws:sqs|notification/i.test(lower)) {
            score += 80;
            reasons.push("boost: explicit queue notification");
        }

        if (type === "queue" && /filepath|file path|s3|bucket|deleted|expired|recording/i.test(lower)) {
            score += 40;
            reasons.push("boost: storage deletion event payload");
        }

        if (
            type === "api" &&
            /sqs|queue|arn:aws:sqs|notification/i.test(lower) &&
            !/\b(post|put|patch|delete|get)\s+\/?api\//i.test(ticketText)
        ) {
            score -= 80;
            reasons.push("penalty: API mentioned only as side-effect in queue ticket");
        }

        if (
            type === "api" &&
            !/\b(post|put|patch|delete|get)\s+\/?api\//i.test(ticketText) &&
            !/request payload|request body|new property|new field/i.test(lower) &&
            /api returns|api response|content api|flag in content api|called\s+isarchived/i.test(lower)
        ) {
            score -= 35;
            reasons.push("penalty: API looks like response/contract side-effect");
        }

        if (type === "import" && /nightly\s+import|external\s+provider|xml feed/i.test(lower)) {
            score += 35;
            reasons.push("boost: explicit import lifecycle wording");
        }

        addMatches(signalConfig.strong, 35, "strong");
        addMatches(signalConfig.medium, 15, "medium");
        addMatches(signalConfig.weak, 6, "weak");

        scores.push({
            type,
            score,
            confidence: 0,
            reasons: [...new Set(reasons)].slice(0, 8),
        });
    }

    const sorted = scores.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
    const top = sorted[0]?.score ?? 0;
    const second = sorted[1]?.score ?? 0;

    return sorted.map(item => {
        if (item.score <= 0 || top <= 0) {
            return { ...item, confidence: 0 };
        }

        let confidence = 0.55;
        if (item.score === top && top >= second * 2.5) confidence = 0.95;
        else if (item.score === top && top >= second * 1.5) confidence = 0.8;
        else if (item.score === top && top > second) confidence = 0.65;
        else confidence = Math.max(0.25, (item.score / Math.max(top, 1)) * 0.6);

        return {
            ...item,
            confidence: Number(confidence.toFixed(2)),
        };
    });
}

export function calculateDominantWorkflow(scores: WorkflowScore[]): DominantWorkflow {
    const positive = scores.filter(item => item.score > 0);
    const primary = positive[0] ?? { type: "unknown" as const, score: 0, confidence: 0, reasons: [] };
    const secondary = positive.slice(1, 4);

    return {
        type: primary.type,
        score: primary.score,
        confidence: primary.confidence,
        reasons: primary.reasons,
        secondary,
    };
}

export type EntrypointRole = "job" | "queue" | "listener" | "consumer" | "handle" | "command" | "controller";

export function collectEntrypointRoles(nodeId: string, file: string | null): Set<EntrypointRole> {
    const roles = new Set<EntrypointRole>();
    const idLower = nodeId.toLowerCase();
    const fileLower = (file ?? "").toLowerCase();

    if (idLower.includes("job") || fileLower.includes("/jobs/") || fileLower.includes("\\jobs\\")) {
        roles.add("job");
    }
    if (idLower.includes("queue") || fileLower.includes("/queue/") || fileLower.includes("\\queue\\")) {
        roles.add("queue");
    }
    if (idLower.includes("listener") || fileLower.includes("/listeners/") || fileLower.includes("\\listeners\\")) {
        roles.add("listener");
    }
    if (idLower.includes("consumer") || fileLower.includes("/consumers/") || fileLower.includes("\\consumers\\")) {
        roles.add("consumer");
    }
    if (idLower.includes("::handle") || idLower.endsWith("handle")) {
        roles.add("handle");
    }
    if (
        idLower.includes("command") ||
        fileLower.includes("/console/") ||
        fileLower.includes("/commands/") ||
        fileLower.includes("\\console\\") ||
        fileLower.includes("\\commands\\")
    ) {
        roles.add("command");
    }
    if (
        idLower.includes("controller") ||
        fileLower.includes("/controllers/") ||
        fileLower.includes("\\controllers\\")
    ) {
        roles.add("controller");
    }

    return roles;
}

export function isWorkflowAlignedEntrypoint(
    nodeId: string,
    file: string | null,
    workflow: WorkflowType
): boolean {
    const lower = nodeId.toLowerCase();
    const roles = collectEntrypointRoles(nodeId, file);
    const methodName = lower.split("::").pop() ?? lower;

    switch (workflow) {
        case "queue": {
            const isQueueish =
                roles.has("consumer") ||
                roles.has("listener") ||
                roles.has("queue") ||
                (roles.has("handle") && (roles.has("job") || roles.has("command")));

            if (!isQueueish && !roles.has("job")) {
                return false;
            }

            const isUnrelatedJob =
                /vtdsync|recordingneedstobedeleted|unassignedfiles|movefilestodeletefolder|setcontentstodelivered/i.test(lower);

            const isHelper =
                methodName.startsWith("get") ||
                methodName.startsWith("set") && !lower.includes("::handle") ||
                methodName.startsWith("resolve") ||
                methodName.startsWith("map") ||
                methodName.startsWith("format") ||
                methodName.startsWith("build");

            return !isUnrelatedJob && !isHelper;
        }

        case "api":
            return roles.has("controller") || /::(store|update|create|destroy|show|index)/.test(lower);

        case "import":
            return /import|transformer|sync|parse|ingest|feed|mapping/i.test(lower);

        case "cron":
            return roles.has("handle") || roles.has("job") || roles.has("command");

        case "ui":
            return roles.has("controller");

        case "migration":
            return /migrate|migration/i.test(lower);

        case "background":
            return roles.has("job") || roles.has("handle") || lower.includes("worker");

        case "unknown":
            return true;
    }
}

export function applyFalsePositivePenalties(
    nodeId: string,
    file: string | null,
    ticketText: string,
    primaryWorkflow: WorkflowType,
    config: WorkflowConfig = { falsePositivePenalties: DEFAULT_FALSE_POSITIVE_PENALTIES }
): { penalty: number; reasons: string[] } {
    const haystack = `${nodeId} ${file ?? ""}`.toLowerCase();
    const lowerTicket = normalize(ticketText);
    let penalty = 0;
    const reasons: string[] = [];

    for (const rule of config.falsePositivePenalties) {
        if (rule.whenPrimaryWorkflow !== primaryWorkflow) continue;

        const matchesNode = rule.nodeIncludes.some(fragment => haystack.includes(fragment.toLowerCase()));
        if (!matchesNode) continue;

        const hasException = (rule.unlessTicketIncludes ?? []).some(fragment =>
            lowerTicket.includes(fragment.toLowerCase())
        );

        if (hasException) continue;

        penalty += rule.penalty;
        reasons.push(rule.reason);
    }

    return { penalty, reasons };
}

export function workflowAlignmentBoost(
    nodeId: string,
    file: string | null,
    workflow: WorkflowType
): { boost: number; reasons: string[] } {
    const lower = `${nodeId} ${file ?? ""}`.toLowerCase();
    const roles = collectEntrypointRoles(nodeId, file);
    let boost = 0;
    const reasons: string[] = [];

    if (workflow === "queue") {
        if (roles.has("consumer") || roles.has("listener")) {
            boost += 120;
            reasons.push("queue workflow boost: consumer/listener");
        } else if (nodeId.includes("integration_entrypoint") || lower.includes("integration:")) {
            boost += 110;
            reasons.push("queue workflow boost: integration entrypoint");
        } else if (roles.has("handle") && (roles.has("job") || roles.has("command"))) {
            boost += 90;
            reasons.push("queue workflow boost: handle entrypoint");
        } else if (/archive|expired|sqs|queue|filepath/i.test(lower)) {
            boost += 70;
            reasons.push("queue workflow boost: domain-specific handler");
        }

        if (roles.has("controller") || /stream|download|accesscheck/i.test(lower)) {
            boost -= 100;
            reasons.push("queue workflow penalty: API/playback side-effect");
        }

        if (/vtdsync|recordingneedstobedeleted|unassignedfiles/i.test(lower)) {
            boost -= 160;
            reasons.push("queue workflow penalty: unrelated job");
        }
    }

    if (workflow === "api" && roles.has("controller")) {
        boost += 60;
        reasons.push("api workflow boost: controller");
    }

    if (workflow === "import" && /import|transformer|parser|feed|mapping/i.test(lower)) {
        boost += 80;
        reasons.push("import workflow boost: import/parser");
    }

    if (workflow === "ui") {
        if (/\.vue::|\.vue@prop:|vue_component|vue_prop/i.test(nodeId)) {
            boost += 120;
            reasons.push("ui workflow boost: vue graph node");
        }

        if (/::setup\b/.test(nodeId)) {
            boost += 60;
            reasons.push("ui workflow boost: component setup");
        }

        if (/components\/|\/cells\/|\/views\/|pagemanager|frontend\/resources/i.test(lower)) {
            boost += 40;
            reasons.push("ui workflow boost: frontend path");
        }

        if (/search|query|tokenresolver|contentmust|indexdocument/i.test(lower)) {
            boost -= 90;
            reasons.push("ui workflow penalty: unrelated search/index code");
        }
    }

    return { boost, reasons };
}

export function isTicketTruncated(ticketText: string): boolean {
    const trimmed = ticketText.trim();
    if (trimmed.length === 0) return false;

    const lastLine = trimmed.split("\n").pop()?.trim() ?? "";
    if (/\.{3}$/.test(lastLine)) return true;
    if (/\b(to also|and then|should also|need to also)\b/i.test(lastLine) && !/[.!?]$/.test(lastLine)) {
        return true;
    }

    return false;
}
