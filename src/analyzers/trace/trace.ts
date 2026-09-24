import Database from "better-sqlite3";
import { gatherNavigationContext, type NavigationContext } from "../navigation/gatherNavigationContext";
import { analyzeChangeImpact, type ChangeImpactResult } from "../impact/ImpactScoringAnalyzer";
import {
    findIncomingCalls,
    findNode,
    findSfcModule,
    resolveMethodThroughInheritance,
    GraphNodeRow,
} from "../../graph/queries/GraphQueries";
import {
    findOutgoingCallChain,
    findRenderedComponentFlows,
    type CallChainRow,
    type RenderedComponentRow,
} from "../../graph/queries/callChainQueries";
import {
    findRouteControllerMethod,
    formatGraphEntryLabel,
    findInterfaceMethodImplementations,
    isAbstractCallTarget,
    shortNavigationLabel,
    type GraphEntryRow,
    type NavigationEdgeRow,
} from "../../graph/queries/navigationQueries";
import { searchNodes } from "../../graph/queries/searchNodes";
import { formatLocation } from "../../shared/formatting/text";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface TraceCallRow {
    id: string;
    depth: number;
    resolvedTo?: string;
    dynamicImplementations?: number;
    receiver?: string;
    file: string | null;
}

export type TraceRenderedComponent = Omit<RenderedComponentRow, "calls"> & { calls: TraceCallRow[] };

export interface TraceCoverage {
    complete: string[];
    partial: string[];
    missing: string[];
}

export interface TraceResult {
    query: string;
    target: GraphNodeRow;
    matchReason: string;
    resolvesTo: string | null;
    analysisNodeId: string;
    navigation: NavigationContext;
    changeImpact: ChangeImpactResult;
    incomingCalls: TraceCallRow[];
    outgoingCalls: TraceCallRow[];
    outgoingCallsTruncated: boolean;
    renderedComponents: TraceRenderedComponent[];
    flowLines: string[];
    coverage: TraceCoverage;
    reads: NavigationEdgeRow[];
}

export interface TraceOptions {
    depth?: number;
    limit?: number;
    includeInterfaceResolved?: boolean;
}

export type TraceBuildResult =
    | { ok: true; data: TraceResult }
    | { ok: false; error: string };

function resolveTarget(db: SQLiteDatabase, query: string): { target: GraphNodeRow; matchReason: string } | null {
    const exact = findNode(db, query);
    if (exact) {
        return { target: findSfcModule(db, exact) ?? exact, matchReason: "exact graph id" };
    }

    const matches = searchNodes(db, query, { limit: 5 });
    if (matches.length === 0) {
        return null;
    }

    const top = matches[0]!;
    const target = findNode(db, top.id);
    if (!target) {
        return null;
    }

    return { target: findSfcModule(db, target) ?? target, matchReason: top.matchReason };
}

function buildOutgoingCalls(
    db: SQLiteDatabase,
    analysisNodeId: string,
    options: TraceOptions,
): { calls: TraceCallRow[]; truncated: boolean } {
    const limit = options.limit ?? 20;
    const depth = options.depth ?? 2;
    const chain = findOutgoingCallChain(db, analysisNodeId, {
        depth,
        limit,
        includeInterfaceResolved: options.includeInterfaceResolved,
    });

    return {
        calls: chain.calls.map(call => mapCallChainRow(db, call)),
        truncated: chain.truncated,
    };
}

function mapCallChainRow(db: SQLiteDatabase, call: CallChainRow): TraceCallRow {
    const abstract = call.callType !== "STATIC" && isAbstractCallTarget(db, call.id);
    const implementations = abstract ? findInterfaceMethodImplementations(db, call.id) : [];
    const resolvedTo = call.callType === "STATIC"
        ? undefined
        : abstract
        ? (implementations.length === 1 ? implementations[0] : undefined)
            ?? (call.file ? undefined : resolveMethodThroughInheritance(db, call.id) ?? undefined)
        : !call.file
            ? resolveMethodThroughInheritance(db, call.id) ?? undefined
            : undefined;

    return {
        id: call.id,
        depth: call.depth,
        file: call.file,
        resolvedTo: resolvedTo && resolvedTo !== call.id ? resolvedTo : undefined,
        ...(implementations.length > 1 ? { dynamicImplementations: implementations.length } : {}),
        ...(call.callType === "STATIC" && call.via && !call.via.includes("::") ? { receiver: call.via } : {}),
    };
}

export function callLabel(call: TraceCallRow, label: (id: string) => string): string {
    if (call.receiver) {
        const methodName = call.id.slice(call.id.lastIndexOf("::") + 2);
        return `${label(call.receiver)}::${methodName}`;
    }
    return `${label(call.resolvedTo ?? call.id)}${dynamicDispatchSuffix(call)}`;
}

export function dynamicDispatchSuffix(call: TraceCallRow): string {
    return call.dynamicImplementations
        ? ` [dynamic: ${call.dynamicImplementations} implementations]`
        : "";
}

export function renderedComponentFlowLines(
    components: TraceRenderedComponent[],
    label: (id: string) => string,
    options: { callPrefix?: string; callsPerComponent?: number } = {},
): string[] {
    const callPrefix = options.callPrefix ?? "";
    const lines: string[] = [];
    const printed = new Set<string>();
    for (const component of components) {
        component.path.forEach((hop, index) => {
            if (printed.has(hop.id)) return;
            printed.add(hop.id);
            lines.push(`${"  ".repeat(index + 1)}→ ${label(hop.id)} [renders${hop.via ? ` <${hop.via}>` : ""}]`);
        });
        const indent = "  ".repeat(component.depth + 1);
        for (const call of component.calls.slice(0, options.callsPerComponent ?? 2)) {
            lines.push(`${indent}→ ${callPrefix}${callLabel(call, label)}`);
        }
        const request = component.http[0];
        if (request) {
            const handler = request.controllerMethod ? ` → ${label(request.controllerMethod)}` : "";
            lines.push(`${indent}→ ${shortNavigationLabel(request.endpointId)} [HTTP]${handler}`);
        }
    }
    return lines;
}

function buildFlowLines(input: {
    target: GraphNodeRow;
    resolvesTo: string | null;
    navigation: NavigationContext;
    outgoingCalls: TraceCallRow[];
    renderedComponents: TraceRenderedComponent[];
}): string[] {
    const lines: string[] = [];
    const methodLabel = shortNavigationLabel(input.resolvesTo ?? input.target.id);

    const primaryRoute = input.navigation.routeEntries[0];
    if (primaryRoute) {
        lines.push(`${shortNavigationLabel(primaryRoute.endpointId)} → ${shortNavigationLabel(primaryRoute.controllerMethod)}`);
    } else if (input.target.type === "api_endpoint") {
        lines.push(shortNavigationLabel(input.target.id));
        if (input.resolvesTo) {
            lines.push(`  → ${methodLabel}`);
        }
    } else {
        lines.push(methodLabel);
    }

    const requestFields = input.navigation.fieldAssignments
        .filter(edge => edge.from.startsWith("request_field:"))
        .map(edge => shortNavigationLabel(edge.from));

    if (requestFields.length > 0) {
        lines.push(`  ← ${requestFields.join(", ")}`);
    }

    if (input.navigation.validates.length > 0) {
        const fields = input.navigation.validates.map(edge => shortNavigationLabel(edge.to));
        lines.push(`  → validates ${fields.join(", ")}`);
    }

    for (const call of input.outgoingCalls.slice(0, 10)) {
        const indent = "  ".repeat(call.depth);
        lines.push(`${indent}→ calls ${callLabel(call, shortNavigationLabel)}`);
    }
    lines.push(...renderedComponentFlowLines(input.renderedComponents, shortNavigationLabel, { callPrefix: "calls " }));

    for (const request of input.navigation.httpDownstream.slice(0, 5)) {
        lines.push(`  → ${shortNavigationLabel(request.endpointId)} [HTTP_REQUEST]`);
        if (request.controllerMethod) {
            lines.push(`    → ${shortNavigationLabel(request.controllerMethod)}`);
        }
    }

    for (const edge of input.navigation.fieldFlowsOut.slice(0, 4)) {
        lines.push(`  → ${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type})`);
    }

    for (const edge of input.navigation.persists.slice(0, 3)) {
        lines.push(`  → persists ${shortNavigationLabel(edge.to)}`);
    }

    return lines;
}

function buildCoverage(input: {
    navigation: NavigationContext;
    outgoingCalls: TraceCallRow[];
    reads: NavigationEdgeRow[];
    renderedComponents: TraceRenderedComponent[];
}): TraceCoverage {
    const complete: string[] = [];
    const partial: string[] = [];
    const missing: string[] = [];

    if (input.navigation.routeEntries.length > 0 || input.navigation.bladeEntries.length > 0) {
        complete.push("entry");
    } else if (input.navigation.graphEntries.length > 0) {
        complete.push("entry");
    } else {
        missing.push("entry");
    }

    if (input.navigation.fieldAssignments.length > 0) {
        complete.push("intake");
    } else {
        missing.push("intake");
    }

    if (input.navigation.validates.length > 0) {
        complete.push("validation");
    } else {
        missing.push("validation");
    }

    if (
        input.outgoingCalls.length > 0
        || input.navigation.httpDownstream.length > 0
        || input.renderedComponents.some(component => component.calls.length > 0)
    ) {
        complete.push("calls");
    } else {
        missing.push("calls");
    }

    if (input.renderedComponents.length > 0) {
        complete.push("rendered components");
    }

    if (input.navigation.httpDownstream.length > 0) {
        complete.push("HTTP downstream");
    }

    if (input.navigation.fieldFlowsOut.length > 0) {
        complete.push("field flow to callees");
    } else if (input.outgoingCalls.length > 0 && input.navigation.fieldAssignments.length > 0) {
        partial.push("field flow to callees");
    }

    if (input.navigation.persists.length > 0) {
        complete.push("persistence");
    }

    if (input.reads.length > 0) {
        complete.push("reads");
    }

    return { complete, partial, missing };
}

function findReadsForMethod(db: SQLiteDatabase, methodId: string, limit: number): NavigationEdgeRow[] {
    const prefix = `${methodId.replace(/[%_\\]/g, "\\$&")}::`;
    const rows = db.prepare(`
        SELECT e.type, e.from_id, e.to_id, e.via
        FROM edges e
        WHERE e.type = 'READS_FIELD'
          AND (
              e.from_id = ?
              OR e.from_id LIKE ? ESCAPE '\\'
              OR e.to_id LIKE ? ESCAPE '\\'
          )
        ORDER BY e.from_id ASC
        LIMIT ?
    `).all(methodId, `${prefix}%`, `${prefix}%`, limit) as Array<{
        type: string;
        from_id: string;
        to_id: string;
        via: string | null;
    }>;

    return rows.map(row => ({
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        via: row.via,
    }));
}

export function buildTrace(
    db: SQLiteDatabase,
    query: string,
    options?: TraceOptions,
): TraceBuildResult {
    const limit = options?.limit ?? 20;
    const depth = options?.depth ?? 2;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;

    const resolved = resolveTarget(db, query);
    if (!resolved) {
        return { ok: false, error: `No nodes found for symbol: ${query}` };
    }

    const { target, matchReason } = resolved;
    const controllerMethodId = target.type === "api_endpoint" || target.type === "http_endpoint"
        ? findRouteControllerMethod(db, target.id)
        : null;
    const analysisNodeId = controllerMethodId ?? target.id;

    const isVueComponentModule = target.type === "js_module" && Boolean(target.file?.endsWith(".vue"));
    const { calls: outgoingCalls, truncated: outgoingCallsTruncated } = target.type === "method" || controllerMethodId || isVueComponentModule
        ? buildOutgoingCalls(db, analysisNodeId, { depth, limit, includeInterfaceResolved })
        : { calls: [], truncated: false };

    const renderedComponents: TraceRenderedComponent[] = isVueComponentModule
        ? findRenderedComponentFlows(db, target.id, {
            knownCallIds: outgoingCalls.flatMap(call => [call.id, call.resolvedTo ?? call.id]),
        }).map(component => ({ ...component, calls: component.calls.map(call => mapCallChainRow(db, call)) }))
        : [];

    const incomingRaw = findIncomingCalls(db, analysisNodeId, { limit, includeInterfaceResolved });
    const incomingCalls: TraceCallRow[] = incomingRaw.map(call => ({
        id: call.id,
        depth: 1,
        file: call.file,
    }));

    const navigation = gatherNavigationContext(db, target, {
        limit,
        callersCount: incomingCalls.length,
        callees: [
            ...outgoingCalls.map(call => call.resolvedTo ?? call.id),
            ...renderedComponents.flatMap(component => component.calls.map(call => call.resolvedTo ?? call.id)),
        ],
        includeInterfaceResolved,
    });

    const changeImpact = analyzeChangeImpact(db, analysisNodeId, {
        includeInterfaceResolved,
        depth,
        limit,
    });

    const reads = controllerMethodId || target.type === "method"
        ? findReadsForMethod(db, analysisNodeId, limit)
        : [];

    const flowLines = buildFlowLines({
        target,
        resolvesTo: controllerMethodId,
        navigation,
        outgoingCalls,
        renderedComponents,
    });

    const coverage = buildCoverage({ navigation, outgoingCalls, reads, renderedComponents });

    return {
        ok: true,
        data: {
            query,
            target,
            matchReason,
            resolvesTo: controllerMethodId,
            analysisNodeId,
            navigation,
            changeImpact,
            incomingCalls,
            outgoingCalls,
            outgoingCallsTruncated,
            renderedComponents,
            flowLines,
            coverage,
            reads,
        },
    };
}

export function formatGraphEntries(entries: GraphEntryRow[]): string[] {
    return entries.map(entry => {
        const fileSuffix = entry.file ? ` (${entry.file})` : "";
        return `${formatGraphEntryLabel(entry)}${fileSuffix}`;
    });
}

export function formatTargetLocation(target: GraphNodeRow): string | null {
    return formatLocation(target.file, target.start_row, target.end_row);
}
