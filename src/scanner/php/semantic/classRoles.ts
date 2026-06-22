import { graph } from "../../../graph/graph";

export type ClassSemanticRole =
    | "sqs_consumer"
    | "queue_listener"
    | "queue_job"
    | "artisan_command"
    | "import_handler"
    | "api_controller";

const ROLE_KEYWORDS: Record<ClassSemanticRole, string[]> = {
    sqs_consumer: ["sqs", "consumer", "queue", "message", "handler", "receivemessage"],
    queue_listener: ["listener", "queue", "event", "sqs"],
    queue_job: ["job", "queue", "async", "background", "message"],
    artisan_command: ["command", "console", "artisan"],
    import_handler: ["import", "parser", "transformer", "feed", "ingest"],
    api_controller: ["controller", "api", "endpoint"],
};

function normalizePath(file: string): string {
    return file.replace(/\\/g, "/").toLowerCase();
}

/** API-key / HTTP consumer classes — not SQS queue handlers. */
export function isApiConsumerClass(className: string, file: string): boolean {
    const lowerClass = className.toLowerCase();
    const lowerFile = normalizePath(file);

    if (lowerFile.includes("/consumer/") || lowerClass.includes("\\consumer\\")) {
        return true;
    }

    return /validateconsumerkey|apikeygenerator|consumerrepository|generateapikeyforconsumer|generateconsumer$/i.test(
        lowerClass
    );
}

function isExpiredVodQueueHandler(className: string, file: string): boolean {
    const lowerClass = className.toLowerCase();
    const lowerFile = normalizePath(file);

    return (
        /expiredvod|expired_vod|expired-vod/i.test(lowerClass) ||
        /expired[_-]?vod/i.test(lowerFile)
    );
}

export function inferClassRoles(className: string, file: string): ClassSemanticRole[] {
    const lowerClass = className.toLowerCase();
    const lowerFile = normalizePath(file);
    const roles = new Set<ClassSemanticRole>();
    const apiConsumer = isApiConsumerClass(className, file);

    if (
        !apiConsumer &&
        (/consumer|listener/i.test(className) ||
            /\/consumers\//i.test(lowerFile) ||
            /\/listeners\//i.test(lowerFile))
    ) {
        roles.add(/listener/i.test(className) ? "queue_listener" : "sqs_consumer");
    }

    if (isExpiredVodQueueHandler(className, file)) {
        const isQueueEntrypoint =
            /listener|command|job$/i.test(className) ||
            /\/jobs\//i.test(lowerFile) ||
            /\/console\/commands\//i.test(lowerFile);

        if (isQueueEntrypoint) {
            roles.add("sqs_consumer");
            roles.add("queue_listener");
        }

        if (/\/jobs\//i.test(lowerFile) || /job$/i.test(className)) {
            roles.add("queue_job");
        }

        if (/\/console\/commands\//i.test(lowerFile) || /command$/i.test(className)) {
            roles.add("artisan_command");
        }
    }

    if (
        /\/jobs\//i.test(lowerFile) ||
        /\\jobs\\/i.test(file) ||
        /job$/i.test(className)
    ) {
        roles.add("queue_job");
    }

    if (
        /\/console\/commands\//i.test(lowerFile) ||
        /\\console\\commands\\/i.test(file) ||
        /command$/i.test(className)
    ) {
        roles.add("artisan_command");
    }

    if (
        /import|parser|transformer|feed|ingest/i.test(className) ||
        /\/import\//i.test(lowerFile)
    ) {
        roles.add("import_handler");
    }

    if (
        /controller$/i.test(className) ||
        /\/controllers\//i.test(lowerFile)
    ) {
        roles.add("api_controller");
    }

    if (!apiConsumer && /sqs|queue/i.test(lowerClass) && /handle|process|consume|listen/i.test(lowerClass)) {
        roles.add("sqs_consumer");
    }

    if (roles.size === 0 && !apiConsumer && /queue/i.test(lowerFile) && /handle/i.test(lowerClass)) {
        roles.add("sqs_consumer");
    }

    return [...roles];
}

export function attachClassRole(classId: string, file: string, role: ClassSemanticRole): void {
    const roleNodeId = `integration:${classId}:${role}`;

    if (graph.nodes.has(roleNodeId)) {
        return;
    }

    graph.nodes.set(roleNodeId, {
        id: roleNodeId,
        type: "integration_entrypoint",
        name: role,
        parent: classId,
        file,
        keywords: ROLE_KEYWORDS[role],
    });

    graph.edges.set(`${classId}->${roleNodeId}`, {
        from: classId,
        to: roleNodeId,
        type: "HAS_ROLE",
        confidence: 0.9,
        reason: `Class classified as ${role} from path/name heuristics`,
    });
}

export function attachClassRoles(classId: string, file: string): void {
    for (const role of inferClassRoles(classId, file)) {
        attachClassRole(classId, file, role);
    }
}

export function ensureSqsConsumerRole(classId: string, file: string): void {
    attachClassRole(classId, file, "sqs_consumer");

    if (/\/console\/commands\//i.test(normalizePath(file)) || /command$/i.test(classId)) {
        attachClassRole(classId, file, "queue_listener");
    }
}
