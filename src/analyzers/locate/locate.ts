import Database from "better-sqlite3";
import { findNode, type GraphNodeRow } from "../../graph/queries/GraphQueries";
import { shortNavigationLabel } from "../../graph/queries/navigationQueries";
import {
    searchNodes,
    type SearchKind,
    type SearchMatch,
} from "../../graph/queries/searchNodes";
import { buildTrace, type TraceResult } from "../trace/trace";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface LocateOptions {
    kind?: SearchKind;
    depth?: number;
    limit?: number;
    maxFiles?: number;
}

export interface LocateFile {
    file: string;
    startRow: number | null;
    endRow: number | null;
    nodeId: string;
    reason: string;
}

export interface LocateEntry {
    id: string;
    location: string | null;
}

export interface LocateResult {
    query: string;
    match: SearchMatch;
    entry: LocateEntry | null;
    resolvesTo: string | null;
    httpBridge: { fromId: string; endpointId: string } | null;
    middleware: string[];
    flow: string[];
    files: LocateFile[];
    coverage: TraceResult["coverage"];
    warnings: string[];
}

function findRouteMiddleware(db: SQLiteDatabase, endpointId: string): string[] {
    const rows = db.prepare(`
        SELECT e.to_id
        FROM edges e
        WHERE e.from_id = ?
          AND e.type = 'USES_MIDDLEWARE'
        ORDER BY e.to_id ASC
        LIMIT 12
    `).all(endpointId) as Array<{ to_id: string }>;

    return rows.map(row => row.to_id.replace(/^middleware:/, ""));
}

export type LocateBuildResult =
    | { ok: true; data: LocateResult }
    | { ok: false; error: string };

type RankedFile = LocateFile & { score: number; order: number };

function resolveMatch(
    db: SQLiteDatabase,
    query: string,
    kind: SearchKind,
): { match: SearchMatch; alternatives: SearchMatch[] } | null {
    const exact = findNode(db, query);
    if (exact) {
        return {
            match: {
                id: exact.id,
                type: exact.type,
                name: exact.name,
                file: exact.file,
                score: 1000,
                matchReason: "exact graph id",
            },
            alternatives: [],
        };
    }

    const matches = searchNodes(db, query, { kind, limit: 3 });
    const match = matches[0];
    return match ? { match, alternatives: matches.slice(1) } : null;
}

function findOutboundHttpBridges(
    db: SQLiteDatabase,
    target: GraphNodeRow,
): Array<{ fromId: string; endpointId: string }> {
    const escapedPrefix = `${target.id.replace(/[%_\\]/g, "\\$&")}::%`;
    const rows = db.prepare(`
        SELECT e.from_id, e.to_id
        FROM edges e
        WHERE e.type = 'HTTP_REQUEST'
          AND (e.from_id = ? OR e.from_id LIKE ? ESCAPE '\\')
        ORDER BY CASE WHEN e.from_id = ? THEN 0 ELSE 1 END, e.to_id ASC
        LIMIT 4
    `).all(target.id, escapedPrefix, target.id) as Array<{ from_id: string; to_id: string }>;

    return rows.map(item => ({ fromId: item.from_id, endpointId: item.to_id }));
}

function compactLabel(nodeId: string): string {
    if (nodeId.startsWith("api:") || nodeId.startsWith("request_field:") || nodeId.startsWith("model_field:")) {
        return shortNavigationLabel(nodeId);
    }

    const withoutJsPrefix = nodeId.startsWith("js:") ? nodeId.slice(3) : nodeId;
    const namespaceTail = withoutJsPrefix.split("\\").pop() ?? withoutJsPrefix;
    const pathParts = namespaceTail.split("/");
    return pathParts[pathParts.length - 1] ?? namespaceTail;
}

function compactLocation(node: GraphNodeRow | undefined): string | null {
    if (!node?.file) return null;
    if (node.start_row === null) return node.file;
    if (node.end_row === null || node.end_row === node.start_row) {
        return `${node.file}:${node.start_row}`;
    }
    return `${node.file}:${node.start_row}-${node.end_row}`;
}

function semanticBonus(node: GraphNodeRow): number {
    const fileName = node.file?.split("/").pop() ?? "";
    const text = `${compactLabel(node.id)} ${fileName}`.toLowerCase();
    if (/query|repository|filter/.test(text)) return 150;
    if (/request|dto|validator/.test(text)) return 100;
    if (/service|usecase|action/.test(text)) return 80;
    if (/generator|transformer|resource/.test(text)) return 60;
    if (/controller/.test(text)) return 40;
    return 0;
}

function findFactoryDependencies(db: SQLiteDatabase, methodNode: GraphNodeRow): string[] {
    if (!methodNode.parent || !/factory/i.test(compactLabel(methodNode.parent))) {
        return [];
    }

    const rows = db.prepare(`
        SELECT e.to_id
        FROM edges e
        WHERE e.from_id = ?
          AND e.type = 'DEPENDS_ON'
        ORDER BY e.to_id ASC
        LIMIT 6
    `).all(methodNode.parent) as Array<{ to_id: string }>;

    return rows.map(row => row.to_id);
}

function findNearestSourceNode(
    db: SQLiteDatabase,
    nodeId: string,
): (GraphNodeRow & { file: string }) | undefined {
    const seen = new Set<string>();
    let currentId: string | null = nodeId;

    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const node = findNode(db, currentId);
        if (node?.file) return node as GraphNodeRow & { file: string };
        if (node?.parent) {
            currentId = node.parent;
            continue;
        }

        const separator = currentId.lastIndexOf("::");
        currentId = separator > 0 ? currentId.slice(0, separator) : null;
    }

    return undefined;
}

function rankFiles(
    db: SQLiteDatabase,
    matchedNode: GraphNodeRow,
    trace: TraceResult,
    maxFiles: number,
): LocateFile[] {
    const candidates: RankedFile[] = [];
    let order = 0;

    const add = (nodeId: string, reason: string, score: number): void => {
        const node = findNearestSourceNode(db, nodeId);
        if (!node) return;
        candidates.push({
            file: node.file,
            startRow: node.start_row,
            endRow: node.end_row,
            nodeId: node.id,
            reason,
            score: score + semanticBonus(node),
            order: order++,
        });
    };

    if (matchedNode.type !== "api_endpoint") {
        add(matchedNode.id, "best match", 1400);
    }
    if (trace.resolvesTo) {
        add(trace.resolvesTo, "route handler", 1250);
    } else if (trace.analysisNodeId !== matchedNode.id) {
        add(trace.analysisNodeId, "analysis target", 1200);
    }

    for (const call of trace.outgoingCalls) {
        const nodeId = call.resolvedTo ?? call.id;
        add(nodeId, `call depth ${call.depth}`, 800 - Math.min(call.depth, 4) * 10);
        const node = findNode(db, nodeId);
        if (node) {
            for (const dependencyId of findFactoryDependencies(db, node)) {
                add(dependencyId, `factory dependency of ${compactLabel(node.id)}`, 860);
            }
        }
    }
    for (const upstream of trace.navigation.httpUpstream) {
        add(upstream.componentId, "HTTP client", 690);
    }
    for (const edge of trace.navigation.persists) {
        add(edge.to, "persistence target", 720);
    }
    for (const edge of trace.reads) {
        add(edge.to, "read dependency", 680);
    }
    for (const edge of trace.navigation.fieldAssignments) {
        add(edge.to, "field assignment target", 1050);
    }
    for (const edge of trace.navigation.fieldFlowsOut) {
        add(edge.to, "field flow target", 1020);
    }

    const bestByFile = new Map<string, RankedFile>();
    for (const candidate of candidates) {
        const existing = bestByFile.get(candidate.file);
        if (!existing || candidate.score > existing.score) {
            bestByFile.set(candidate.file, candidate);
        }
    }

    return [...bestByFile.values()]
        .sort((a, b) => b.score - a.score || a.order - b.order || a.file.localeCompare(b.file))
        .slice(0, Math.min(5, Math.max(1, maxFiles)))
        .map(({ score: _score, order: _order, ...file }) => file);
}

function buildFlow(
    matchedNode: GraphNodeRow,
    trace: TraceResult,
    bridge: LocateResult["httpBridge"],
    middleware: string[],
): string[] {
    const lines: string[] = [];
    if (bridge) {
        lines.push(compactLabel(matchedNode.id));
        lines.push(`  → ${compactLabel(bridge.endpointId)} [HTTP]`);
    } else {
        lines.push(compactLabel(trace.target.id));
    }
    if (middleware.length > 0) {
        lines.push(`  → ${middleware.join(", ")} [middleware]`);
    }
    if (trace.resolvesTo) {
        lines.push(`  → ${compactLabel(trace.resolvesTo)} [handler]`);
    }
    for (const call of trace.outgoingCalls.slice(0, 10)) {
        lines.push(`${"  ".repeat(Math.max(1, call.depth + 1))}→ ${compactLabel(call.resolvedTo ?? call.id)}`);
    }
    for (const edge of trace.navigation.fieldAssignments.slice(0, 3)) {
        lines.push(`  → ${compactLabel(edge.to)} [${edge.type}]`);
    }
    for (const edge of trace.navigation.fieldFlowsOut.slice(0, 3)) {
        lines.push(`  → ${compactLabel(edge.to)} [${edge.type}]`);
    }
    return lines;
}

export function buildLocate(
    db: SQLiteDatabase,
    query: string,
    options?: LocateOptions,
): LocateBuildResult {
    const kind = options?.kind ?? "auto";
    const depth = Math.max(1, options?.depth ?? 3);
    const limit = Math.max(1, options?.limit ?? 12);
    const maxFiles = Math.min(5, Math.max(1, options?.maxFiles ?? 5));
    const resolved = resolveMatch(db, query, kind);

    if (!resolved) return { ok: false, error: `No nodes found for: ${query}` };

    const matchedNode = findNode(db, resolved.match.id);
    if (!matchedNode) {
        return { ok: false, error: `Matched node is missing from graph: ${resolved.match.id}` };
    }

    const httpBridges = findOutboundHttpBridges(db, matchedNode);
    const httpBridge = httpBridges[0] ?? null;
    const traceResult = buildTrace(db, httpBridge?.endpointId ?? matchedNode.id, { depth, limit });
    if (!traceResult.ok) return traceResult;

    const trace = traceResult.data;
    const entryNode = trace.target.type === "api_endpoint" ? trace.target : null;
    const middleware = entryNode ? findRouteMiddleware(db, entryNode.id) : [];
    const entryLocation = entryNode && !(httpBridge && entryNode.file === matchedNode.file)
        ? compactLocation(entryNode)
        : null;
    const warnings: string[] = [];
    const ambiguous = resolved.alternatives.find(item => item.score >= resolved.match.score - 40);
    if (ambiguous) {
        warnings.push(`Ambiguous match; next candidate is ${compactLabel(ambiguous.id)} (score ${ambiguous.score}).`);
    }
    if (httpBridges.length > 1) {
        warnings.push(`Multiple outbound HTTP endpoints found; showing ${compactLabel(httpBridge!.endpointId)}. Query a method to narrow the flow.`);
    }
    if (trace.outgoingCallsTruncated) {
        warnings.push(`Call graph truncated at ${limit} calls; increase --limit for more.`);
    }
    warnings.push(...trace.navigation.warnings.slice(0, Math.max(0, 2 - warnings.length)));

    return {
        ok: true,
        data: {
            query,
            match: resolved.match,
            entry: entryNode ? { id: entryNode.id, location: entryLocation } : null,
            resolvesTo: trace.resolvesTo,
            httpBridge,
            middleware,
            flow: buildFlow(matchedNode, trace, httpBridge, middleware),
            files: rankFiles(db, matchedNode, trace, maxFiles),
            coverage: trace.coverage,
            warnings,
        },
    };
}

function formatLocateFile(file: LocateFile): string {
    const location = file.startRow === null
        ? file.file
        : file.endRow === null || file.endRow === file.startRow
            ? `${file.file}:${file.startRow}`
            : `${file.file}:${file.startRow}-${file.endRow}`;
    return `${location} — ${file.reason}`;
}

export function renderLocate(data: LocateResult): string {
    const lines = [
        `# Locate: ${data.query}`,
        `Match: ${data.match.id} (${data.match.type}; ${data.match.matchReason}; score ${data.match.score})`,
    ];

    if (data.entry) {
        lines.push(`Entry: ${compactLabel(data.entry.id)}${data.entry.location ? ` — ${data.entry.location}` : ""}`);
    }
    lines.push("", "Flow:", ...data.flow.map(line => `  ${line}`));
    lines.push("", `Inspect first (${data.files.length}/5):`);
    if (data.files.length === 0) {
        lines.push("  (no source locations recorded)");
    } else {
        data.files.forEach((file, index) => lines.push(`  ${index + 1}. ${formatLocateFile(file)}`));
    }

    const { complete, partial, missing } = data.coverage;
    lines.push("", "Coverage:", `  known: ${complete.join(", ") || "none"}`);
    if (partial.length > 0) lines.push(`  partial: ${partial.join(", ")}`);
    if (missing.length > 0) lines.push(`  missing: ${missing.join(", ")}`);
    for (const warning of data.warnings) lines.push(`  warning: ${warning}`);
    return `${lines.join("\n")}\n`;
}
