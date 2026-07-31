import Database from "better-sqlite3";
import {
    findOutgoingCalls,
    resolveMethodThroughInheritance,
    type CallRow,
} from "./GraphQueries";
import {
    filterFrameworkNoise,
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

function resolveCallTraversalTarget(db: SQLiteDatabase, call: CallRow): string {
    if (call.id.includes("Interface")) {
        return resolveInterfaceMethodImplementation(db, call.id) ?? call.id;
    }

    if (!call.file) {
        return resolveMethodThroughInheritance(db, call.id) ?? call.id;
    }

    return call.id;
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
        depth: number;
        path: Set<string>;
    };

    const queue: QueueItem[] = [{
        nodeId: startId,
        depth: 0,
        path: new Set([startId]),
    }];

    while (queue.length > 0 && results.length < totalLimit) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) {
            continue;
        }

        const rawCalls = findOutgoingCalls(db, current.nodeId, {
            includeInterfaceResolved,
            limit: perHopLimit,
        });

        const calls = filterFrameworkNoise(preferConcreteCallTargets(rawCalls));

        if (rawCalls.length >= perHopLimit) {
            truncated = true;
        }

        for (const call of calls) {
            if (results.length >= totalLimit) {
                truncated = true;
                break;
            }

            const traversalId = resolveCallTraversalTarget(db, call);
            if (current.path.has(traversalId)) {
                continue;
            }

            if (seenTargets.has(call.id)) {
                continue;
            }

            seenTargets.add(call.id);
            results.push({
                ...call,
                depth: current.depth + 1,
            });

            if (current.depth + 1 < maxDepth) {
                const nextPath = new Set(current.path);
                nextPath.add(traversalId);
                queue.push({
                    nodeId: traversalId,
                    depth: current.depth + 1,
                    path: nextPath,
                });
            }
        }
    }

    if (results.length >= totalLimit && queue.length > 0) {
        truncated = true;
    }

    return { calls: results, truncated };
}
