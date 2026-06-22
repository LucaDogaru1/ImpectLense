import Database from "better-sqlite3";
import { analyzeHotspots } from "../../analyzers/hotspots/HotspotAnalyzer";
import { analyzeChangeImpact } from "../../analyzers/impact/ImpactScoringAnalyzer";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface RankedRiskItem {
    id: string;
    hotspotScore: number;
    impactScore: number;
    combinedScore: number;
    risk: RiskLevel;
    riskRank: number;
    percentileTop: number;
}

export interface RiskRankingResult {
    candidatePool: number;
    population: number;
    items: RankedRiskItem[];
}

export interface RiskRankingOptions {
    includeDependsOn: boolean;
    includeInterfaceResolved: boolean;
    depth: number;
    impactLimit: number;
    candidatePool: number;
}

const riskOrder: Record<RiskLevel, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
};

export function buildRiskRanking(db: SQLiteDatabase, options: RiskRankingOptions): RiskRankingResult {
    const hotspotResult = analyzeHotspots(db, {
        includeDependsOn: options.includeDependsOn,
        includeInterfaceResolved: options.includeInterfaceResolved,
        limit: options.candidatePool,
    });

    const hotspotCandidates = new Map<string, number>();
    const candidateSets = [
        hotspotResult.methodHotspots,
        hotspotResult.classHotspots,
        hotspotResult.fanOutHotspots,
    ];

    for (const set of candidateSets) {
        for (const item of set) {
            const current = hotspotCandidates.get(item.id) ?? 0;
            hotspotCandidates.set(item.id, Math.max(current, item.score));
        }
    }

    const items: RankedRiskItem[] = [];
    for (const [id, hotspotScore] of hotspotCandidates) {
        const impact = analyzeChangeImpact(db, id, {
            includeDependsOn: options.includeDependsOn,
            includeInterfaceResolved: options.includeInterfaceResolved,
            depth: options.depth,
            limit: options.impactLimit,
        });

        const combinedScore = Number((impact.score * 3 + hotspotScore).toFixed(2));

        items.push({
            id,
            hotspotScore,
            impactScore: impact.score,
            combinedScore,
            risk: impact.risk,
            riskRank: 0,
            percentileTop: 0,
        });
    }

    items.sort((a, b) => {
        const riskDelta = riskOrder[a.risk] - riskOrder[b.risk];
        if (riskDelta !== 0) {
            return riskDelta;
        }
        if (b.combinedScore !== a.combinedScore) {
            return b.combinedScore - a.combinedScore;
        }
        if (b.hotspotScore !== a.hotspotScore) {
            return b.hotspotScore - a.hotspotScore;
        }
        return a.id.localeCompare(b.id);
    });

    const population = Math.max(1, hotspotResult.inspectedNodes);
    items.forEach((item, index) => {
        const rank = index + 1;
        item.riskRank = rank;
        item.percentileTop = Number(((rank / population) * 100).toFixed(2));
    });

    return {
        candidatePool: options.candidatePool,
        population,
        items,
    };
}

