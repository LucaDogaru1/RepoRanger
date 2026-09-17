export const INCOMING_ENTRY_EDGE_TYPES = [
    "ROUTES_TO",
    "BLADE_USES_ACTION",
] as const;

export type IncomingEntryEdgeType = (typeof INCOMING_ENTRY_EDGE_TYPES)[number];

const INCOMING_ENTRY_EDGE_SQL = INCOMING_ENTRY_EDGE_TYPES.map(type => `'${type}'`).join(", ");

export function isIncomingEntryEdgeType(type: string): type is IncomingEntryEdgeType {
    return (INCOMING_ENTRY_EDGE_TYPES as readonly string[]).includes(type);
}

export function incomingEntryEdgeTypesSql(): string {
    return `type IN (${INCOMING_ENTRY_EDGE_SQL})`;
}

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
                OR call_type NOT IN ('INTERFACE_RESOLVED', 'EXTENDS_RESOLVED', 'OVERRIDE_RESOLVED')
            )
        )
        ${entryClause}
        OR (? = 1 AND type = 'DEPENDS_ON')
    )`;
}
