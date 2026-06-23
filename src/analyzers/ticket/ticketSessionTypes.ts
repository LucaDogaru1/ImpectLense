import { DominantWorkflow, WorkflowType } from "./ticketWorkflow";
import { TicketAnalyzerResult } from "./ticketAnalyzerV3";
import { FieldLayerStatus } from "./ticketClaims";
import { TicketChangeArea } from "./ticketIntent";
import type { TicketRankingHints } from "./ticketRankingHints";

/** Graph surfaces included in analysis. JS will be added when frontend scanning lands. */
export type GraphScope = "php" | "js";

export type SessionPhase = "intent" | "scan";

export type ImplementationMode = "extend_existing" | "net_new" | "unsure";

/** Where ticket changes likely apply — helps future JS scan routing. */
export type TicketSurfaceScope =
    | "backend_only"
    | "backend_api"
    | "cms_ui"
    | "public_frontend"
    | "full_stack"
    | "unsure";

export interface GraphScopeCoverage {
    scope: GraphScope;
    nodeCount: number;
    edgeCount: number;
    loaded: boolean;
}

export interface TicketSessionResolved {
    lockedWorkflow?: WorkflowType;
    implementationMode?: ImplementationMode;
    surfaceScope?: TicketSurfaceScope;
    scopes: GraphScope[];
    truncatedAcknowledged?: boolean;
    /** User-confirmed primary topic before graph scan. */
    confirmedTopic?: WorkflowType | "mixed" | "unsure";
    /** What areas the change touches — set before graph scan. */
    changeIncludes?: TicketChangeArea;
    intentConfirmed?: boolean;
}

export interface TicketQuestionOption {
    id: string;
    label: string;
}

export interface TicketQuestion {
    id: string;
    prompt: string;
    options: TicketQuestionOption[];
    reason: string;
    guidance?: string;
    required: boolean;
}

export interface StructuralCandidate {
    id: string;
    type: string;
    file: string | null;
    role: string;
    reason: string;
}

export interface TicketProbeResult {
    dominantWorkflow: DominantWorkflow;
    truncated: boolean;
    structuralCandidates: StructuralCandidate[];
    infrastructureGaps: string[];
    fieldStatuses: FieldLayerStatus[];
    graphCoverage: GraphScopeCoverage[];
    autoResolved: Partial<TicketSessionResolved>;
    readinessScore: number;
    readinessReasons: string[];
}

export interface TicketBriefing {
    markdown: string;
    readFirst: Array<{ id: string; file: string | null; reason: string }>;
    flowPaths: Array<{ path: string; complete: boolean; gap?: string }>;
    relatedSymbols: Array<{ id: string; file: string | null; reason: string }>;
    skip: Array<{ id: string; reason: string }>;
    verify: string[];
    warnings: string[];
}

export interface TicketSessionInput {
    ticketText: string;
    /** Active graph scopes. Defaults to php-only until JS scanner exists. */
    scopes?: GraphScope[];
    answers?: Record<string, string>;
    limit?: number;
    includeDebug?: boolean;
    rankingHints?: TicketRankingHints;
    /** Skip intent questions and infer from ticket text (--non-interactive). */
    skipIntent?: boolean;
}

export interface TicketSessionState {
    ticketText: string;
    scopes: GraphScope[];
    resolved: TicketSessionResolved;
    answers: Record<string, string>;
    phase: SessionPhase;
    probe?: TicketProbeResult;
    round: number;
}

export type TicketSessionStartResult =
    | {
          status: "needs_input";
          session: TicketSessionState;
          questions: TicketQuestion[];
      }
    | {
          status: "ready";
          session: TicketSessionState;
          analysis: TicketAnalyzerResult;
          briefing: TicketBriefing;
      };

export type TicketSessionContinueResult = TicketSessionStartResult;
