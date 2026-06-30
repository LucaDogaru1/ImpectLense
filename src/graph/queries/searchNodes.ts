import Database from "better-sqlite3";

type SQLiteDatabase = InstanceType<typeof Database>;

export type SearchKind = "auto" | "symbol" | "route" | "field" | "config" | "all";

export interface SearchMatch {
    id: string;
    type: string;
    name: string | null;
    file: string | null;
    score: number;
    matchReason: string;
}

export interface SearchOptions {
    kind?: SearchKind;
    limit?: number;
}

const SYMBOL_TYPES = new Set([
    "class",
    "method",
    "interface",
    "trait",
    "vue_component",
    "js_module",
    "blade_view",
    "property",
    "parameter",
]);

const FIELD_TYPES = new Set([
    "request_field",
    "model_field",
    "variable_field",
    "response_field",
]);

function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
}

function normalizeQuery(raw: string): string {
    return raw.trim().replace(/\\/g, "\\");
}

function detectKind(query: string, explicit?: SearchKind): SearchKind {
    if (explicit && explicit !== "auto") {
        return explicit;
    }

    const lower = query.toLowerCase();
    if (query.startsWith("api:") || /^(get|post|put|patch|delete)\s+\//i.test(query)) {
        return "route";
    }
    if (query.startsWith("request_field:") || query.startsWith("model_field:")) {
        return "field";
    }
    if (query.startsWith("config_key:")) {
        return "config";
    }
    if (lower.includes("/") && /\b(get|post|put|patch|delete)\b/i.test(query)) {
        return "route";
    }
    return "symbol";
}

function typesForKind(kind: SearchKind): string[] | null {
    switch (kind) {
        case "symbol":
            return [...SYMBOL_TYPES];
        case "route":
            return ["api_endpoint", "route_name"];
        case "field":
            return [...FIELD_TYPES];
        case "config":
            return ["config_literal"];
        case "all":
            return null;
        default:
            return null;
    }
}

function scoreMatch(
    query: string,
    row: { id: string; type: string; name: string | null; file: string | null },
): { score: number; matchReason: string } {
    const q = query.toLowerCase();
    const id = row.id.toLowerCase();
    const name = (row.name ?? "").toLowerCase();
    const file = (row.file ?? "").toLowerCase();

    if (row.id === query) {
        return { score: 1000, matchReason: "exact id" };
    }

    if (id.endsWith(`::${q}`) || id.endsWith(`\\${q}`)) {
        return { score: 900, matchReason: "exact symbol suffix" };
    }

    if (id === q || name === q) {
        return { score: 850, matchReason: "exact name" };
    }

    if (id.includes(q)) {
        return { score: 700, matchReason: "id contains query" };
    }

    if (name.includes(q)) {
        return { score: 600, matchReason: "name contains query" };
    }

    if (file.includes(q)) {
        return { score: 400, matchReason: "file path contains query" };
    }

    const tokens = q.split(/[\s/:.\\_-]+/).filter(token => token.length >= 2);
    let tokenHits = 0;
    for (const token of tokens) {
        if (id.includes(token) || name.includes(token) || file.includes(token)) {
            tokenHits += 1;
        }
    }

    if (tokenHits > 0) {
        return { score: 200 + tokenHits * 50, matchReason: `${tokenHits} token(s) matched` };
    }

    return { score: 0, matchReason: "weak match" };
}

function routeQueryVariants(query: string): string[] {
    const variants = new Set<string>();
    variants.add(query);

    const verbPath = query.match(/^(get|post|put|patch|delete)\s+(\S+)/i);
    if (verbPath) {
        variants.add(`${verbPath[1]!.toUpperCase()}:${verbPath[2]}`);
        variants.add(verbPath[2]!);
    }

    if (query.startsWith("/")) {
        variants.add(`%:${query.slice(1)}%`);
        variants.add(`%${query}%`);
    }

    return [...variants];
}

export function searchNodes(
    db: SQLiteDatabase,
    rawQuery: string,
    options?: SearchOptions,
): SearchMatch[] {
    const query = normalizeQuery(rawQuery);
    if (!query) {
        return [];
    }

    const kind = detectKind(query, options?.kind);
    const limit = options?.limit ?? 20;
    const types = typesForKind(kind);
    const like = `%${escapeLike(query)}%`;

    let rows: Array<{ id: string; type: string; name: string | null; file: string | null }>;

    if (kind === "route") {
        const routePatterns = routeQueryVariants(query).map(v => `%${escapeLike(v)}%`);
        const clauses = routePatterns.map(() => "id LIKE ? ESCAPE '\\'").join(" OR ");
        rows = db.prepare(`
            SELECT id, type, name, file
            FROM nodes
            WHERE type IN ('api_endpoint', 'route_name')
              AND (${clauses})
            LIMIT 200
        `).all(...routePatterns) as typeof rows;
    } else {
        const typeClause = types
            ? `AND type IN (${types.map(() => "?").join(", ")})`
            : "";
        rows = db.prepare(`
            SELECT id, type, name, file
            FROM nodes
            WHERE (
                id LIKE ? ESCAPE '\\'
                OR IFNULL(name, '') LIKE ? ESCAPE '\\'
                OR IFNULL(file, '') LIKE ? ESCAPE '\\'
            )
            ${typeClause}
            LIMIT 300
        `).all(
            ...(types ? [like, like, like, ...types] : [like, like, like]),
        ) as typeof rows;
    }

    const exact = db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        WHERE id = ?
        LIMIT 1
    `).get(query) as typeof rows[number] | undefined;

    if (exact) {
        rows = [exact, ...rows.filter(row => row.id !== exact.id)];
    }

    const scored = rows
        .map(row => {
            const { score, matchReason } = scoreMatch(query, row);
            return { ...row, score, matchReason };
        })
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const seen = new Set<string>();
    const result: SearchMatch[] = [];
    for (const row of scored) {
        if (seen.has(row.id)) {
            continue;
        }
        seen.add(row.id);
        result.push(row);
        if (result.length >= limit) {
            break;
        }
    }

    return result;
}
