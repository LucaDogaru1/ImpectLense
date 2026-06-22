import { GraphScopeCoverage, TicketProbeResult, TicketQuestion, TicketSessionResolved } from "./ticketSessionTypes";
import { WorkflowType } from "./ticketWorkflow";

const READINESS_THRESHOLD = 0.72;
const MAX_QUESTIONS = 3;

function mentionsUi(ticketText: string): boolean {
    const lower = ticketText.toLowerCase();
    return /\bcms\b|editor|dashboard|screen|display|frontend|component|react|vue|ui\b/i.test(lower);
}

export function graphHasJsNodes(graphCoverage: GraphScopeCoverage[]): boolean {
    return graphCoverage.some(item => item.scope === "js" && item.nodeCount > 0);
}

export function autoExpandScopesForUiTicket(
    resolved: TicketSessionResolved,
    graphCoverage: GraphScopeCoverage[],
    ticketText: string
): TicketSessionResolved {
    if (resolved.scopes.includes("js") || !graphHasJsNodes(graphCoverage)) {
        return resolved;
    }

    const uiTicket =
        mentionsUi(ticketText) ||
        resolved.lockedWorkflow === "ui" ||
        resolved.confirmedTopic === "ui" ||
        resolved.changeIncludes === "cms_ui" ||
        resolved.surfaceScope === "cms_ui" ||
        resolved.surfaceScope === "public_frontend" ||
        resolved.surfaceScope === "full_stack";

    if (!uiTicket) {
        return resolved;
    }

    return {
        ...resolved,
        scopes: [...resolved.scopes, "js"],
    };
}

export function inferAutoAnswersForQuestions(
    questions: TicketQuestion[],
    probe?: TicketProbeResult,
    ticketText?: string
): Record<string, string> {
    const answers: Record<string, string> = {};

    for (const question of questions) {
        switch (question.id) {
            case "truncated_ack":
                answers.truncated_ack = "yes";
                break;
            case "missing_js_graph":
                answers.missing_js_graph = "continue";
                break;
            case "workflow_primary":
                answers.workflow_primary = probe?.dominantWorkflow.type ?? question.options[0]?.id ?? "unsure";
                break;
            case "implementation_mode":
                answers.implementation_mode =
                    question.options.find(option => option.id === "extend_existing")?.id ??
                    question.options[0]?.id ??
                    "unsure";
                break;
            case "surface_scope":
                if (probe?.dominantWorkflow.type === "ui" || (ticketText && mentionsUi(ticketText))) {
                    answers.surface_scope =
                        question.options.find(option => option.id === "cms_ui")?.id ??
                        question.options.find(option => option.id === "full_stack")?.id ??
                        "unsure";
                } else {
                    answers.surface_scope = question.options.find(option => option.id === "unsure")?.id ?? "unsure";
                }
                break;
            case "include_frontend_scope":
                answers.include_frontend_scope = "yes";
                break;
            default:
                if (question.options[0]?.id) {
                    answers[question.id] = question.options[0].id;
                }
        }
    }

    return answers;
}

function effectiveLockedWorkflow(resolved: TicketSessionResolved): WorkflowType | undefined {
    if (resolved.lockedWorkflow) {
        return resolved.lockedWorkflow;
    }

    if (
        resolved.confirmedTopic &&
        resolved.confirmedTopic !== "mixed" &&
        resolved.confirmedTopic !== "unsure"
    ) {
        return resolved.confirmedTopic;
    }

    return undefined;
}

export function isSessionReady(
    probe: TicketProbeResult,
    resolved: TicketSessionResolved
): boolean {
    const merged: TicketSessionResolved = {
        scopes: ["php"],
        ...probe.autoResolved,
        ...resolved,
    };

    let score = probe.readinessScore;
    const lockedWorkflow = effectiveLockedWorkflow(merged);

    if (lockedWorkflow) score += 0.05;
    if (merged.implementationMode) score += 0.1;
    if (merged.surfaceScope) score += 0.03;
    if (merged.truncatedAcknowledged) score += 0.1;
    if (merged.intentConfirmed) score += 0.08;

    if (probe.truncated && !merged.truncatedAcknowledged) {
        return false;
    }

    if (
        probe.dominantWorkflow.type === "queue" &&
        !merged.implementationMode &&
        merged.changeIncludes !== "queue_job" &&
        merged.changeIncludes !== "infra_new"
    ) {
        return false;
    }

    const runnerUp = probe.dominantWorkflow.secondary[0];
    if (
        runnerUp &&
        runnerUp.confidence >= 0.5 &&
        probe.dominantWorkflow.confidence - runnerUp.confidence < 0.12 &&
        !lockedWorkflow
    ) {
        return false;
    }

    return score >= READINESS_THRESHOLD;
}

export function buildFollowUpQuestions(
    ticketText: string,
    probe: TicketProbeResult,
    resolved: TicketSessionResolved,
    graphCoverage: GraphScopeCoverage[]
): TicketQuestion[] {
    const questions: TicketQuestion[] = [];
    const lower = ticketText.toLowerCase();

    if (probe.truncated && !resolved.truncatedAcknowledged) {
        questions.push({
            id: "truncated_ack",
            prompt: "The ticket text looks truncated. Continue with partial requirements?",
            options: [
                { id: "yes", label: "Yes — analyze with warnings" },
                { id: "no", label: "No — I will paste the full ticket first" },
            ],
            reason: "Truncated tickets produce unreliable implementation confidence.",
            guidance: "Choose no if you can paste the full ticket; otherwise continue with warnings.",
            required: true,
        });
    }

    const runnerUp = probe.dominantWorkflow.secondary[0];
    const lockedWorkflow = effectiveLockedWorkflow(resolved);

    if (
        runnerUp &&
        runnerUp.confidence >= 0.5 &&
        probe.dominantWorkflow.confidence - runnerUp.confidence < 0.12 &&
        !lockedWorkflow
    ) {
        questions.push({
            id: "workflow_primary",
            prompt: "Which workflow is primary for this ticket?",
            options: [
                {
                    id: probe.dominantWorkflow.type,
                    label: `${probe.dominantWorkflow.type} (${probe.dominantWorkflow.confidence})`,
                },
                {
                    id: runnerUp.type,
                    label: `${runnerUp.type} (${runnerUp.confidence})`,
                },
                { id: "unsure", label: "Unsure / mixed" },
            ],
            reason: `Ambiguous workflow: ${probe.dominantWorkflow.type} vs ${runnerUp.type}.`,
            guidance: "Pick unsure if both apply equally — graph ranking will stay broad.",
            required: true,
        });
    }

    if (
        probe.dominantWorkflow.type === "queue" &&
        !resolved.implementationMode &&
        resolved.changeIncludes !== "queue_job" &&
        resolved.changeIncludes !== "infra_new"
    ) {
        const hasHandlers = probe.structuralCandidates.some(candidate =>
            /sqs_consumer|queue_listener|queue_job/.test(candidate.role)
        );

        questions.push({
            id: "implementation_mode",
            prompt: hasHandlers
                ? "Is this extending existing queue/SQS infrastructure or net-new?"
                : "Should ImpactLens assume net-new queue infrastructure?",
            options: hasHandlers
                ? [
                      { id: "extend_existing", label: "Extend existing queue flow" },
                      { id: "net_new", label: "Net-new infrastructure" },
                      { id: "unsure", label: "Unsure" },
                  ]
                : [
                      { id: "net_new", label: "Net-new infrastructure" },
                      { id: "extend_existing", label: "Extend something existing" },
                      { id: "unsure", label: "Unsure" },
                  ],
            reason: "Queue tickets need to know whether to start from an existing consumer/listener.",
            guidance: "Pick unsure if you do not know yet — existing handlers in the graph will be preferred when found.",
            required: true,
        });
    }

    const jsLoaded = graphCoverage.some(item => item.scope === "js" && item.loaded);
    const jsAvailable = graphHasJsNodes(graphCoverage);

    if (mentionsUi(ticketText) && !resolved.surfaceScope && resolved.changeIncludes !== "cms_ui") {
        questions.push({
            id: "surface_scope",
            prompt: "Where do changes primarily apply?",
            options: [
                { id: "backend_only", label: "Backend / services only" },
                { id: "backend_api", label: "Backend API contract" },
                { id: "cms_ui", label: "CMS / admin UI" },
                { id: "public_frontend", label: "Public frontend app" },
                { id: "full_stack", label: "API + UI together" },
                { id: "unsure", label: "Unsure" },
            ],
            reason: "Surface scope helps route analysis across backend and frontend graph nodes.",
            guidance: "Pick full_stack if backend and UI both change. Pick unsure or press Enter if unclear.",
            required: false,
        });
    } else if (mentionsUi(ticketText) && !jsLoaded && !jsAvailable) {
        questions.push({
            id: "missing_js_graph",
            prompt: "Ticket mentions UI/CMS but the graph has no JS/Vue nodes. Continue with PHP-only analysis?",
            options: [
                { id: "continue", label: "Yes — continue with PHP graph only" },
                { id: "stop", label: "No — I will rescan with --lang=both first" },
            ],
            reason: "UI tickets need a JS/Vue scan (`npm run scan -- ... --lang=both`) for component-level matches.",
            guidance: "Rescan the repo with --lang=both if you have not already.",
            required: true,
        });
    }

    return questions.slice(0, MAX_QUESTIONS);
}

export function applyQuestionAnswer(
    resolved: TicketSessionResolved,
    questionId: string,
    answerId: string
): TicketSessionResolved {
    const next = { ...resolved, scopes: [...resolved.scopes] };

    switch (questionId) {
        case "ticket_topic":
            if (answerId === "mixed" || answerId === "unsure") {
                next.confirmedTopic = answerId;
                delete next.lockedWorkflow;
                if (answerId === "unsure") {
                    delete next.implementationMode;
                }
            } else {
                next.confirmedTopic = answerId as TicketSessionResolved["lockedWorkflow"];
                next.lockedWorkflow = answerId as TicketSessionResolved["lockedWorkflow"];
            }
            break;
        case "change_includes":
            next.changeIncludes = answerId as TicketSessionResolved["changeIncludes"];
            if (answerId === "cms_ui") {
                next.surfaceScope = "cms_ui";
            } else if (answerId === "api_field") {
                next.surfaceScope = "backend_api";
            } else if (answerId === "backend_logic" || answerId === "queue_job" || answerId === "persistence") {
                next.surfaceScope = next.surfaceScope ?? "backend_only";
            } else if (answerId === "mixed") {
                next.surfaceScope = next.surfaceScope ?? "full_stack";
            } else if (answerId === "unsure") {
                delete next.implementationMode;
            }
            if (answerId === "infra_new") {
                next.implementationMode = "net_new";
            } else if (answerId === "queue_job" && !next.implementationMode) {
                next.implementationMode = "extend_existing";
            }
            next.intentConfirmed = true;
            break;
        case "truncated_ack":
            next.truncatedAcknowledged = answerId === "yes";
            break;
        case "workflow_primary":
            if (answerId !== "unsure") {
                next.lockedWorkflow = answerId as TicketSessionResolved["lockedWorkflow"];
            } else {
                delete next.lockedWorkflow;
            }
            break;
        case "implementation_mode":
            next.implementationMode = answerId as TicketSessionResolved["implementationMode"];
            break;
        case "surface_scope":
            next.surfaceScope = answerId as TicketSessionResolved["surfaceScope"];
            break;
        case "include_frontend_scope":
            if (answerId === "yes" && !next.scopes.includes("js")) {
                next.scopes.push("js");
            }
            if (answerId === "no" && next.surfaceScope === undefined) {
                next.surfaceScope = "backend_api";
            }
            break;
        case "missing_js_graph":
            if (answerId === "stop") {
                next.surfaceScope = "backend_only";
            }
            break;
    }

    return next;
}

export function mergeResolved(
    probe: TicketProbeResult,
    resolved: Partial<TicketSessionResolved> = {}
): TicketSessionResolved {
    return {
        ...probe.autoResolved,
        ...resolved,
        scopes: resolved.scopes ?? probe.autoResolved.scopes ?? ["php"],
    };
}
