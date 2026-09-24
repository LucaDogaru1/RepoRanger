import Database from "better-sqlite3";
import {
    findOutgoingCalls,
    resolveMethodThroughInheritance,
    type CallRow,
} from "./GraphQueries";
import {
    filterFrameworkNoise,
    findHttpDownstream,
    isAbstractCallTarget,
    preferConcreteCallTargets,
    resolveInterfaceMethodImplementation,
    type HttpDownstreamRow,
} from "./navigationQueries";

type SQLiteDatabase = InstanceType<typeof Database>;

export type CallChainRow = CallRow & {
    depth: number;
};

export interface CallChainQueryResult {
    calls: CallChainRow[];
    truncated: boolean;
}

export interface CallChainQueryOptions {
    depth?: number;
    limit?: number;
    includeInterfaceResolved?: boolean;
    perHopLimit?: number;
}

function resolveCallTraversalTarget(db: SQLiteDatabase, call: CallRow): string {
    if (call.callType === "STATIC") {
        return call.id;
    }

    if (isAbstractCallTarget(db, call.id)) {
        const implementation = resolveInterfaceMethodImplementation(db, call.id);
        if (implementation) {
            return implementation;
        }
    }

    if (!call.file) {
        return resolveMethodThroughInheritance(db, call.id) ?? call.id;
    }

    return call.id;
}

const LAYER_PRIORITY: Array<{ pattern: RegExp; weight: number }> = [
    { pattern: /Quer(?:y|ies)|Repositor(?:y|ies)|Finder|Dao|Builder|Persist/i, weight: 100 },
    { pattern: /Service|UseCase|Action|Handler|Interactor|Manager/i, weight: 80 },
    { pattern: /Factory|Provider|Resolver/i, weight: 70 },
    { pattern: /Generator|Transformer|Resource|Serializer|Presenter/i, weight: 60 },
    { pattern: /Dto|Request|Validator|Rule/i, weight: 50 },
];

const TRIVIAL_ACCESSOR = /::(?:get|set|is|has|to|from|with)[A-Z_]?\w*$/;

export function isDataLayerNodeId(nodeId: string): boolean {
    const className = nodeId.split("::")[0] ?? nodeId;
    return LAYER_PRIORITY[0]!.pattern.test(className);
}

function layerPriority(nodeId: string): number {
    const className = nodeId.split("::")[0] ?? nodeId;
    let weight = 20;

    for (const layer of LAYER_PRIORITY) {
        if (layer.pattern.test(className)) {
            weight = layer.weight;
            break;
        }
    }

    if (TRIVIAL_ACCESSOR.test(nodeId)) {
        weight -= 15;
    }

    return weight;
}

function selectWithinBudget(calls: CallChainRow[], cap: number): { selected: CallChainRow[]; dropped: boolean } {
    if (calls.length <= cap) {
        return { selected: calls, dropped: false };
    }

    const selected = [...calls]
        .sort((left, right) =>
            layerPriority(right.id) - layerPriority(left.id) || left.id.localeCompare(right.id))
        .slice(0, cap)
        .sort((left, right) => left.id.localeCompare(right.id));

    return { selected, dropped: true };
}

export function findOutgoingCallChain(
    db: SQLiteDatabase,
    startId: string,
    options?: CallChainQueryOptions,
): CallChainQueryResult {
    const maxDepth = options?.depth ?? 1;
    const totalLimit = options?.limit ?? 20;
    const perHopLimit = options?.perHopLimit ?? totalLimit;
    const includeInterfaceResolved = options?.includeInterfaceResolved ?? false;

    if (maxDepth < 1) {
        return { calls: [], truncated: false };
    }

    const results: CallChainRow[] = [];
    const seenTargets = new Set<string>();
    let truncated = false;

    type QueueItem = {
        nodeId: string;
        traversalId: string;
        path: Set<string>;
    };

    let frontier: QueueItem[] = [{
        nodeId: startId,
        traversalId: startId,
        path: new Set([startId]),
    }];

    const RESERVE_PER_REMAINING_DEPTH = 2;

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
        const remaining = totalLimit - results.length;
        if (remaining <= 0) {
            truncated = true;
            break;
        }

        const remainingDepths = maxDepth - depth - 1;
        const reserve = Math.min(remaining - 1, remainingDepths * RESERVE_PER_REMAINING_DEPTH);
        const levelCap = Math.max(1, remaining - Math.max(0, reserve));

        const levelCalls: Array<CallChainRow & { item: QueueItem; traversalTarget: string }> = [];

        for (const current of frontier) {
            const rawCalls = findOutgoingCalls(db, current.traversalId, {
                includeInterfaceResolved,
                limit: perHopLimit,
            });

            if (rawCalls.length >= perHopLimit) {
                truncated = true;
            }

            const calls = filterFrameworkNoise(preferConcreteCallTargets(
                rawCalls,
                id => isAbstractCallTarget(db, id),
            ));

            for (const call of calls) {
                const traversalTarget = resolveCallTraversalTarget(db, call);
                if (current.path.has(traversalTarget) || seenTargets.has(call.id)) {
                    continue;
                }

                seenTargets.add(call.id);
                levelCalls.push({
                    ...call,
                    depth: depth + 1,
                    item: current,
                    traversalTarget,
                });
            }
        }

        const { selected, dropped } = selectWithinBudget(
            levelCalls.sort((left, right) => left.id.localeCompare(right.id)),
            levelCap,
        );
        if (dropped) {
            truncated = true;
        }

        const nextFrontier: QueueItem[] = [];
        for (const call of selected as Array<CallChainRow & { item: QueueItem; traversalTarget: string }>) {
            results.push({
                id: call.id,
                callType: call.callType,
                via: call.via,
                file: call.file,
                depth: call.depth,
            });

            const nextPath = new Set(call.item.path);
            nextPath.add(call.traversalTarget);
            nextFrontier.push({
                nodeId: call.id,
                traversalId: call.traversalTarget,
                path: nextPath,
            });
        }

        frontier = nextFrontier;
    }

    return { calls: results, truncated };
}

export interface RenderedComponentRow {
    id: string;
    depth: number;
    path: Array<{ id: string; via: string | null }>;
    calls: CallChainRow[];
    http: HttpDownstreamRow[];
}

export interface RenderedComponentOptions {
    maxDepth?: number;
    maxComponents?: number;
    callDepth?: number;
    callLimit?: number;
    knownCallIds?: Iterable<string>;
}

const GENERIC_RENDER_FAN_IN = 8;
const MAX_CHILDREN_PER_LEVEL = 12;

function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
}

function findRenderedChildren(db: SQLiteDatabase, moduleId: string): Array<{ id: string; via: string | null }> {
    return db.prepare(`
        SELECT e.to_id AS id, MIN(e.via) AS via
        FROM edges e
        JOIN nodes t ON t.id = e.to_id
        WHERE e.type = 'RENDERS_COMPONENT'
          AND (e.from_id = ? OR e.from_id LIKE ? ESCAPE '\\')
          AND t.file LIKE '%.vue'
        GROUP BY e.to_id
        ORDER BY e.to_id ASC
    `).all(moduleId, `${escapeLike(moduleId)}::%`) as Array<{ id: string; via: string | null }>;
}

function renderFanIn(db: SQLiteDatabase, moduleId: string): number {
    const row = db.prepare(`
        SELECT COUNT(DISTINCT n.file) AS parents
        FROM edges e
        JOIN nodes n ON n.id = e.from_id
        WHERE e.type = 'RENDERS_COMPONENT' AND e.to_id = ?
    `).get(moduleId) as { parents: number } | undefined;
    return row?.parents ?? 0;
}

function isComposableOrStore(nodeId: string): boolean {
    const name = nodeId.slice(nodeId.lastIndexOf("::") + 2);
    return /^use[A-Z]/.test(name) || /\/(?:composables|stores)\//.test(nodeId);
}

export function findRenderedComponentFlows(
    db: SQLiteDatabase,
    startId: string,
    options?: RenderedComponentOptions,
): RenderedComponentRow[] {
    const maxDepth = options?.maxDepth ?? 2;
    const maxComponents = options?.maxComponents ?? 3;
    const callDepth = options?.callDepth ?? 2;
    const callLimit = options?.callLimit ?? 6;
    const known = new Set(options?.knownCallIds ?? []);

    const visited = new Set([startId]);
    const candidates: Array<RenderedComponentRow & { score: number }> = [];
    let frontier: Array<{ id: string; path: RenderedComponentRow["path"] }> = [{ id: startId, path: [] }];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
        const level: Array<{ id: string; path: RenderedComponentRow["path"]; fanIn: number }> = [];
        for (const parent of frontier) {
            for (const child of findRenderedChildren(db, parent.id)) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                level.push({ id: child.id, path: [...parent.path, child], fanIn: renderFanIn(db, child.id) });
            }
        }
        level.sort((a, b) => a.fanIn - b.fanIn || a.id.localeCompare(b.id));

        const nextFrontier: typeof frontier = [];
        for (const child of level.slice(0, MAX_CHILDREN_PER_LEVEL)) {
            const generic = child.fanIn >= GENERIC_RENDER_FAN_IN;
            if (!generic) nextFrontier.push({ id: child.id, path: child.path });

            const calls = findOutgoingCallChain(db, child.id, { depth: callDepth, limit: callLimit }).calls
                .filter(call => !known.has(call.id));
            const http = uniqueEndpoints([child.id, ...calls.map(call => call.id)]
                .flatMap(id => findHttpDownstream(db, id, 2)));
            const stateful = calls.filter(call => isComposableOrStore(call.id)).length;
            if (http.length === 0 && (generic || stateful === 0)) continue;

            candidates.push({
                id: child.id,
                depth,
                path: child.path,
                calls,
                http,
                score: http.length * 100 + stateful * 20 + calls.length * 5 - depth * 40,
            });
        }
        frontier = nextFrontier;
    }

    const shown = new Set(known);
    return candidates
        .sort((a, b) => b.score - a.score || a.depth - b.depth || a.id.localeCompare(b.id))
        .slice(0, maxComponents)
        .map(({ score: _score, ...component }) => {
            const calls = component.calls.filter(call => !shown.has(call.id));
            calls.forEach(call => shown.add(call.id));
            return { ...component, calls };
        });
}

function uniqueEndpoints(rows: HttpDownstreamRow[]): HttpDownstreamRow[] {
    const byEndpoint = new Map<string, HttpDownstreamRow>();
    for (const row of rows) {
        if (!byEndpoint.has(row.endpointId) || (!byEndpoint.get(row.endpointId)!.controllerMethod && row.controllerMethod)) {
            byEndpoint.set(row.endpointId, row);
        }
    }
    return [...byEndpoint.values()];
}
