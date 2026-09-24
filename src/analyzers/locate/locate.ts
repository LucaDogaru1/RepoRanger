import Database from "better-sqlite3";
import { findNode, findSfcModule, type GraphNodeRow } from "../../graph/queries/GraphQueries";
import { isDataLayerNodeId } from "../../graph/queries/callChainQueries";
import { readGraphFreshness, type GraphFreshness } from "../../graph/queries/graphFreshness";
import { findRouteHandlers, isRouteActionDefined, shortNavigationLabel } from "../../graph/queries/navigationQueries";
import { findRelatedTests, type RelatedTestRow } from "../../graph/queries/relatedTests";
import {
    searchNodes,
    type SearchKind,
    type SearchMatch,
} from "../../graph/queries/searchNodes";
import { classifyFileRole, fileRolePenalty } from "../../shared/classification/fileRole";
import { buildTrace, callLabel, renderedComponentFlowLines, type TraceResult } from "../trace/trace";
import { scoreConfidence, type LocateConfidence } from "./confidence";
import { findDataLayerContinuation } from "./dataLayerContinuation";
import {
    applyOutputBudget,
    DEFAULT_MAX_TOKENS,
    type BudgetSection,
} from "./outputBudget";
import { formatLineRange, readSourceSnippet } from "./sourceSnippet";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface LocateOptions {
    kind?: SearchKind;
    depth?: number;
    limit?: number;
    maxFiles?: number;
    sourceRoot?: string;
    dbPath?: string;
    maxTokens?: number;
    includeTests?: boolean;
}

export interface LocateFile {
    file: string;
    startRow: number | null;
    endRow: number | null;
    nodeId: string;
    reason: string;
    role: ReturnType<typeof classifyFileRole>;
    snippet?: string[];
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
    tests: RelatedTestRow[];
    coverage: TraceResult["coverage"];
    warnings: string[];
    graph: GraphFreshness;
    confidence: LocateConfidence;
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

type RankedFile = LocateFile & { score: number; order: number; role: LocateFile["role"] };

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
    const top = matches[0];
    if (!top) return null;
    const sfcModule = findSfcModule(db, top);
    const match = sfcModule ? { ...top, id: sfcModule.id, type: sfcModule.type, name: sfcModule.name } : top;
    const sameSfc = (item: SearchMatch) => Boolean(match.file?.endsWith(".vue")) && item.file === match.file
        && (item.type === "js_module" || item.type === "vue_component");
    return { match, alternatives: matches.slice(1).filter(item => item.id !== match.id && !sameSfc(item)) };
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
    if (
        nodeId.startsWith("api:")
        || nodeId.startsWith("http:")
        || nodeId.startsWith("request_field:")
        || nodeId.startsWith("model_field:")
    ) {
        return shortNavigationLabel(nodeId);
    }

    const withoutJsPrefix = nodeId.startsWith("js:") ? nodeId.slice(3) : nodeId;
    const namespaceTail = withoutJsPrefix.split("\\").pop() ?? withoutJsPrefix;
    const pathParts = namespaceTail.split("/");
    return pathParts[pathParts.length - 1] ?? namespaceTail;
}

function compactLocation(node: GraphNodeRow | undefined): string | null {
    if (!node?.file) return null;
    return formatLineRange(node.file, node.start_row, node.end_row);
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
    continuation: ReturnType<typeof findDataLayerContinuation>,
): LocateFile[] {
    const candidates: RankedFile[] = [];
    let order = 0;
    const matchedRole = classifyFileRole(matchedNode.file);

    const add = (nodeId: string, reason: string, score: number): void => {
        const node = findNearestSourceNode(db, nodeId);
        if (!node) return;
        const role = classifyFileRole(node.file);
        const penalty = node.id === matchedNode.id || matchedRole !== "source"
            ? 0
            : fileRolePenalty(node.file);
        candidates.push({
            file: node.file,
            startRow: node.start_row,
            endRow: node.end_row,
            nodeId: node.id,
            reason,
            role,
            score: score + semanticBonus(node) - penalty,
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
        if (call.receiver) {
            add(call.receiver, `receiver of ${callLabel(call, compactLabel)}`, 870 - Math.min(call.depth, 4) * 10);
        }
        add(nodeId, `call depth ${call.depth}`, 800 - Math.min(call.depth, 4) * 10);
        const node = findNode(db, nodeId);
        if (node) {
            for (const dependencyId of findFactoryDependencies(db, node)) {
                add(dependencyId, `factory dependency of ${compactLabel(node.id)}`, 860);
            }
        }
    }
    for (const component of trace.renderedComponents) {
        const base = 780 - component.depth * 20;
        const hop = component.path[component.path.length - 1];
        const httpBonus = component.http.length > 0 ? 50 : 0;
        add(component.id, `renders ${hop?.via ? `<${hop.via}>` : compactLabel(component.id)}`, base - 20 + httpBonus);
        for (const call of component.calls) {
            const nodeId = call.resolvedTo ?? call.id;
            const issuesHttp = component.http.some(request => request.componentId === nodeId);
            add(nodeId, `call depth ${call.depth} via ${compactLabel(component.id)}`, base - call.depth * 10 + (issuesHttp ? 150 : 0));
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
    for (const call of continuation) {
        add(call.id, `data layer via ${compactLabel(call.seedId)}`, 900);
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
    continuation: ReturnType<typeof findDataLayerContinuation>,
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
        lines.push(`${"  ".repeat(Math.max(1, call.depth + 1))}→ ${callLabel(call, compactLabel)}`);
    }
    lines.push(...renderedComponentFlowLines(trace.renderedComponents.slice(0, 2), compactLabel, { callsPerComponent: 1 }));
    for (const edge of trace.navigation.fieldAssignments.slice(0, 3)) {
        lines.push(`  → ${compactLabel(edge.to)} [${edge.type}]`);
    }
    for (const edge of trace.navigation.fieldFlowsOut.slice(0, 3)) {
        lines.push(`  → ${compactLabel(edge.to)} [${edge.type}]`);
    }
    for (const call of continuation) {
        lines.push(`    → ${compactLabel(call.id)} [data layer, +${call.depth} from ${compactLabel(call.seedId)}]`);
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
    const routeEntryId = trace.navigation.routeEntries[0]?.endpointId;
    const entryNode = routeEntryId
        ? findNode(db, routeEntryId)
        : trace.target.type === "api_endpoint"
            ? trace.target
            : null;
    const middleware = entryNode ? findRouteMiddleware(db, entryNode.id) : [];
    const entryLocation = entryNode && !(httpBridge && entryNode.file === matchedNode.file)
        ? compactLocation(entryNode)
        : null;
    const warnings: string[] = [];
    const ambiguous = resolved.alternatives.find(item => item.score >= resolved.match.score - 40);
    if (ambiguous) {
        warnings.push(`Ambiguous match; next candidate is ${compactLabel(ambiguous.id)} (score ${ambiguous.score}).`);
    }
    const routeHandlers = entryNode ? findRouteHandlers(db, entryNode.id) : [];
    const shownHandler = trace.resolvesTo ?? routeHandlers[0];
    const missingRouteAction = shownHandler && !isRouteActionDefined(db, shownHandler)
        ? shownHandler
        : undefined;
    if (routeHandlers.length > 1) {
        const handlerLabel = (id: string): string => {
            const root = id.split("\\")[0];
            return root && root !== id && id.includes("\\") ? `${root}\\…\\${compactLabel(id)}` : compactLabel(id);
        };
        warnings.push(`Route is defined ${routeHandlers.length} times (${routeHandlers.map(handlerLabel).join(", ")}); showing ${handlerLabel(trace.resolvesTo ?? routeHandlers[0]!)}. Check which app/route file serves this request.`);
    }
    if (httpBridges.length > 1) {
        warnings.push(`Multiple outbound HTTP endpoints found; showing ${compactLabel(httpBridge!.endpointId)}. Query a method to narrow the flow.`);
    }
    if (trace.outgoingCallsTruncated) {
        warnings.push(`Call graph truncated at ${limit} calls; increase --limit for more.`);
    }
    warnings.push(...trace.navigation.warnings.slice(0, Math.max(0, 2 - warnings.length)));

    const reachesDataLayer = trace.outgoingCalls.some(call =>
        isDataLayerNodeId(call.resolvedTo ?? call.id));
    const continuation = reachesDataLayer
        ? []
        : findDataLayerContinuation(db, deepestCallIds(trace), { extraDepth: 2, limit: 2 });

    const files = rankFiles(db, matchedNode, trace, maxFiles, continuation);
    const tests = options?.includeTests === false
        ? []
        : findRelatedTests(db, testAnchorIds(matchedNode, trace, files), 3);

    if (options?.sourceRoot) {
        attachSnippets(files, options.sourceRoot);
    }

    const graph = readGraphFreshness(db, options?.dbPath);
    const confidence = scoreConfidence({
        query,
        match: resolved.match,
        fileCount: files.length,
        hasEntry: Boolean(entryNode) || trace.coverage.complete.includes("entry"),
        missingCoverage: trace.coverage.missing,
        ambiguous: Boolean(ambiguous),
        routeHandlerCount: routeHandlers.length,
        missingRouteAction: missingRouteAction ? compactLabel(missingRouteAction) : undefined,
        freshness: graph,
    });

    return {
        ok: true,
        data: {
            query,
            match: resolved.match,
            entry: entryNode ? { id: entryNode.id, location: entryLocation } : null,
            resolvesTo: trace.resolvesTo,
            httpBridge,
            middleware,
            flow: buildFlow(matchedNode, trace, httpBridge, middleware, continuation),
            files,
            tests,
            coverage: trace.coverage,
            warnings,
            graph,
            confidence,
        },
    };
}

function deepestCallIds(trace: TraceResult): string[] {
    if (trace.outgoingCalls.length === 0) {
        return trace.resolvesTo ? [trace.resolvesTo] : [trace.analysisNodeId];
    }

    const maxDepth = Math.max(...trace.outgoingCalls.map(call => call.depth));
    return trace.outgoingCalls
        .filter(call => call.depth >= maxDepth - 1)
        .map(call => call.resolvedTo ?? call.id)
        .slice(0, 4);
}

function testAnchorIds(
    matchedNode: GraphNodeRow,
    trace: TraceResult,
    files: LocateFile[],
): string[] {
    const ids = [matchedNode.id];
    if (matchedNode.parent) ids.push(matchedNode.parent);
    if (trace.resolvesTo) {
        ids.push(trace.resolvesTo);
        const classId = trace.resolvesTo.split("::")[0];
        if (classId) ids.push(classId);
    }
    for (const file of files) {
        if (file.role !== "source") continue;
        ids.push(file.nodeId);
        const classId = file.nodeId.split("::")[0];
        if (classId) ids.push(classId);
    }
    return ids;
}

function attachSnippets(files: LocateFile[], sourceRoot: string): void {
    files.slice(0, 3).forEach((file, index) => {
        const snippet = readSourceSnippet(file.file, file.startRow, {
            sourceRoot,
            maxLines: index === 0 ? 3 : 2,
        });
        if (snippet) {
            file.snippet = snippet;
        }
    });
}

function formatLocateFile(file: LocateFile): string {
    const location = formatLineRange(file.file, file.startRow, file.endRow);
    const role = file.role === "source" ? "" : ` [${file.role}]`;
    return `${location}${role} — ${file.reason}`;
}

export function renderLocate(data: LocateResult, maxTokens: number = DEFAULT_MAX_TOKENS): string {
    const header: string[] = [
        `# Locate: ${data.query}`,
        `Match: ${data.match.id} (${data.match.type}; ${data.match.matchReason}; score ${data.match.score})`,
        `Graph: ${data.graph.summary}`,
    ];
    if (data.entry) {
        header.push(`Entry: ${compactLabel(data.entry.id)}${data.entry.location ? ` — ${data.entry.location}` : ""}`);
    }

    const inspect: string[] = ["", `Inspect first (${data.files.length}/5):`];
    if (data.files.length === 0) {
        inspect.push("  (no source locations recorded)");
    } else {
        data.files.forEach((file, index) => {
            inspect.push(`  ${index + 1}. ${formatLocateFile(file)}`);
            for (const snippetLine of file.snippet ?? []) {
                inspect.push(`       ${snippetLine}`);
            }
        });
    }

    const tests: string[] = data.tests.length > 0
        ? [
            "",
            `Tests (${data.tests.length}):`,
            ...data.tests.map(test =>
                `  ${formatLineRange(test.file, test.startRow, test.endRow)} — ${test.reason}`),
        ]
        : [];

    const flow: string[] = ["", "Flow:", ...data.flow.map(line => `  ${line}`)];

    const { complete, partial, missing } = data.coverage;
    const coverage: string[] = ["", "Coverage:", `  known: ${complete.join(", ") || "none"}`];
    if (partial.length > 0) coverage.push(`  partial: ${partial.join(", ")}`);
    if (missing.length > 0) coverage.push(`  missing: ${missing.join(", ")}`);

    const verdict: string[] = [
        "",
        `Confidence: ${data.confidence.level}${
            data.confidence.reasons.length > 0 ? ` (${data.confidence.reasons.join("; ")})` : ""
        }`,
    ];
    if (data.confidence.fallback) {
        verdict.push(data.confidence.level === "low"
            ? `Low confidence — use rg: ${data.confidence.fallback}`
            : `Verify with rg: ${data.confidence.fallback}`);
    }

    const warnings: string[] = data.warnings.map(warning => `  warning: ${warning}`);

    const sections: BudgetSection[] = [
        { priority: 100, lines: header, keepLines: 3, droppable: false },
        { priority: 90, lines: verdict, keepLines: 2, droppable: false },
        { priority: 80, lines: inspect, keepLines: 2 },
        { priority: 60, lines: tests, keepLines: 2 },
        { priority: 50, lines: flow, keepLines: 2 },
        { priority: 40, lines: coverage, keepLines: 2 },
        { priority: 10, lines: warnings },
    ];

    const { text, trimmed } = applyOutputBudget(sections, maxTokens);
    return trimmed ? `${text}\n  (output trimmed to fit ${maxTokens} tokens)\n` : `${text}\n`;
}
