import Database from "better-sqlite3";
import { findOutgoingCallChain, isDataLayerNodeId } from "../../graph/queries/callChainQueries";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface ContinuationCall {
    id: string;
    depth: number;
    file: string | null;
    seedId: string;
}

export function findDataLayerContinuation(
    db: SQLiteDatabase,
    seedIds: string[],
    options?: { extraDepth?: number; limit?: number },
): ContinuationCall[] {
    const extraDepth = Math.max(1, options?.extraDepth ?? 2);
    const limit = Math.max(1, options?.limit ?? 3);
    const found: ContinuationCall[] = [];
    const seen = new Set<string>();

    for (const seedId of seedIds) {
        if (found.length >= limit) break;

        const { calls } = findOutgoingCallChain(db, seedId, {
            depth: extraDepth,
            limit: 12,
            perHopLimit: 12,
        });

        for (const call of calls) {
            if (found.length >= limit) break;
            if (!isDataLayerNodeId(call.id) || seen.has(call.id)) continue;
            seen.add(call.id);
            found.push({ id: call.id, depth: call.depth, file: call.file, seedId });
        }
    }

    return found;
}
