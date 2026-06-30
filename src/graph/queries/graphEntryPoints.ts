/** Edge types that mark HTTP/view entry into a controller method (not call-chain callers). */
export const INCOMING_ENTRY_EDGE_TYPES = [
    "ROUTES_TO",
    "BLADE_USES_ACTION",
] as const;

export type IncomingEntryEdgeType = (typeof INCOMING_ENTRY_EDGE_TYPES)[number];

const INCOMING_ENTRY_EDGE_SQL = INCOMING_ENTRY_EDGE_TYPES.map(type => `'${type}'`).join(", ");

export function isIncomingEntryEdgeType(type: string): type is IncomingEntryEdgeType {
    return (INCOMING_ENTRY_EDGE_TYPES as readonly string[]).includes(type);
}

/** SQL fragment: `type IN ('ROUTES_TO', 'BLADE_USES_ACTION')` */
export function incomingEntryEdgeTypesSql(): string {
    return `type IN (${INCOMING_ENTRY_EDGE_SQL})`;
}

/** SQL fragment for counting incoming usage links (calls + optional entry points + depends_on). */
export function incomingUsageEdgeWhereSql(options: {
    includeInterfaceResolved: boolean;
    includeDependsOn: boolean;
    includeEntryPoints?: boolean;
}): string {
    const includeEntryPoints = options.includeEntryPoints ?? true;
    const entryClause = includeEntryPoints ? `OR ${incomingEntryEdgeTypesSql()}` : "";

    return `(
        (
            type = 'CALLS'
            AND (
                ? = 1
                OR call_type IS NULL
                OR call_type != 'INTERFACE_RESOLVED'
            )
        )
        ${entryClause}
        OR (? = 1 AND type = 'DEPENDS_ON')
    )`;
}
