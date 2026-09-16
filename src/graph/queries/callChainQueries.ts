import Database from "better-sqlite3";
import {
    findOutgoingCalls,
    resolveMethodThroughInheritance,
    type CallRow,
} from "./GraphQueries";
import {
    filterFrameworkNoise,
    isAbstractCallTarget,
    preferConcreteCallTargets,
    resolveInterfaceMethodImplementation,
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

function resolveCallTraversalTarget(db: SQLiteDatabase, call: CallRow, callerId: string): string {
    if (isAbstractCallTarget(db, call.id)) {
        const implementation = resolveInterfaceMethodImplementation(db, call.id, { preferNear: callerId });
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
                const traversalTarget = resolveCallTraversalTarget(db, call, current.traversalId);
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
