import { FieldLayerStatus } from "./ticketClaims";
import { DbEdgeRow } from "./ticketGraphContext";
import { TicketMatchedNode } from "./ticketAnalyzerV3";
import {
    countTokenOverlap,
    extractDistinctiveTicketTokens,
    extractFieldPathTerms,
    pathSegmentTokenOverlap,
} from "./ticketTextTokens";
import { DominantWorkflow, isWorkflowAlignedEntrypoint } from "./ticketWorkflow";

const GENERIC_CONTROLLER_TOKENS = new Set([
    "url",
    "string",
    "example",
    "https",
    "accepts",
    "existing",
    "which",
    "used",
    "session",
    "user",
    "index",
    "name",
    "returns",
    "stored",
]);

export function applyWorkflowTargetRerank(
    items: TicketMatchedNode[],
    workflow: DominantWorkflow,
    ticketText: string,
    fieldTerms: string[]
): TicketMatchedNode[] {
    const distinctiveTokens = extractDistinctiveTicketTokens(ticketText);
    const fieldPaths = extractFieldPathTerms(ticketText);
    const ticketLower = ticketText.toLowerCase();
    const cmsUiImport = /\b(cms|detail page|display in|show in the cms|detail view)\b/i.test(ticketLower);

    return items
        .map(item => {
            let boost = pathSegmentTokenOverlap(item.file, distinctiveTokens) * 15;
            let penalty = 0;
            const haystack = `${item.id} ${item.file ?? ""} ${item.name}`.toLowerCase();
            const strongOverlap = countTokenOverlap(
                haystack,
                distinctiveTokens.filter(token => token.length >= 6)
            );
            const genericOverlap = countTokenOverlap(haystack, [...GENERIC_CONTROLLER_TOKENS]);
            const genericOnlyController =
                /controller/i.test(haystack) &&
                genericOverlap > 0 &&
                strongOverlap === 0;

            if (workflow.type === "api") {
                if (/parser|serializer|resource|transformer|requestparser|storecontent/i.test(haystack)) {
                    boost += 220;
                }

                if (
                    /\/access\/|::access\b|access\/\{param\}/i.test(haystack) &&
                    fieldPaths.length > 0 &&
                    !/\/access\b|\bcheck-access\b/i.test(ticketLower)
                ) {
                    penalty += 450;
                }

                if (genericOnlyController) {
                    penalty += 150;
                }

                for (const path of fieldPaths) {
                    const compact = path.replace(/\./g, "").toLowerCase();
                    if (haystack.includes(compact) || haystack.includes(path.toLowerCase())) {
                        boost += 180;
                    }
                }

                for (const term of fieldTerms) {
                    if (haystack.includes(term.toLowerCase())) {
                        boost += 120;
                    }
                }
            }

            if (workflow.type === "import") {
                if (/packages\/.*\/import|\/content\/import|externalmatch|importjob|importer|feedintegration|serviceprovider/i.test(haystack)) {
                    boost += 140;
                }

                if (/subtitle|webvtt/i.test(haystack) && /\b(xml|provider|event|feed)\b/i.test(ticketLower)) {
                    penalty += 130;
                }

                if (/\/views\/.*\/import/i.test(haystack) && !cmsUiImport) {
                    penalty += 120;
                }
            }

            if (workflow.type === "ui") {
                if (/\/cells\//.test(haystack)) {
                    boost += 40;
                }

                if (
                    distinctiveTokens.some(token => token.includes("heroteaser")) &&
                    /\/hero\/index\.vue/i.test(haystack) &&
                    !/heroteaser/i.test(haystack)
                ) {
                    penalty += 80;
                }
            }

            if (workflow.type === "queue") {
                if (/controller/i.test(haystack) && !/job|listener|command|sqs|process/i.test(haystack)) {
                    penalty += 100;
                }
            }

            if (boost === 0 && penalty === 0) {
                return item;
            }

            return {
                ...item,
                score: Math.max(0, item.score + boost - penalty),
                reason: `${item.reason}${boost ? ` | Target boost: +${boost}` : ""}${penalty ? ` | Target penalty: -${penalty}` : ""}`,
            };
        })
        .sort((left, right) => right.score - left.score);
}

export function buildRelatedSymbols(
    readFirstIds: string[],
    fieldStatuses: FieldLayerStatus[],
    edges: DbEdgeRow[],
    limit = 5
): Array<{ id: string; file: string | null; reason: string }> {
    const seen = new Set<string>();
    const related: Array<{ id: string; file: string | null; reason: string }> = [];
    const topId = readFirstIds[0];

    if (topId) {
        for (const edge of edges) {
            if (edge.type !== "CALLS") {
                continue;
            }

            if (edge.from_id === topId && !seen.has(edge.to_id)) {
                seen.add(edge.to_id);
                related.push({
                    id: edge.to_id,
                    file: null,
                    reason: "Called from read-first entrypoint",
                });
            }

            if (edge.to_id === topId && !seen.has(edge.from_id)) {
                seen.add(edge.from_id);
                related.push({
                    id: edge.from_id,
                    file: null,
                    reason: "Calls read-first entrypoint",
                });
            }

            if (related.length >= limit) {
                return related;
            }
        }
    }

    for (const status of fieldStatuses) {
        for (const [layer, nodeIds] of Object.entries(status.layers)) {
            for (const nodeId of nodeIds ?? []) {
                if (seen.has(nodeId)) {
                    continue;
                }

                seen.add(nodeId);
                related.push({
                    id: nodeId,
                    file: null,
                    reason: `Field '${status.field}' in ${layer}`,
                });

                if (related.length >= limit) {
                    return related;
                }
            }
        }
    }

    return related;
}

export function calculateEntrypointConfidence(
    investigationTargets: TicketMatchedNode[],
    workflow: DominantWorkflow
): number {
    const top = investigationTargets[0];
    if (!top) {
        return 0;
    }

    let score = 0.45;

    if (isWorkflowAlignedEntrypoint(top.id, top.file, workflow.type)) {
        score += 0.25;
    }

    if (top.score >= 500) {
        score += 0.1;
    }

    if (top.score >= 900) {
        score += 0.1;
    }

    return Number(Math.min(score, 0.95).toFixed(2));
}

export function calculateGraphCoverageConfidence(fieldStatuses: FieldLayerStatus[]): number {
    if (fieldStatuses.length === 0) {
        return 0.55;
    }

    const foundCount = fieldStatuses.filter(status => !status.summary.includes("not found")).length;
    const completeCount = fieldStatuses.filter(status => status.missingLayers.length === 0).length;

    const score =
        0.25 +
        (foundCount / fieldStatuses.length) * 0.35 +
        (completeCount / fieldStatuses.length) * 0.35;

    return Number(Math.min(score, 0.95).toFixed(2));
}
