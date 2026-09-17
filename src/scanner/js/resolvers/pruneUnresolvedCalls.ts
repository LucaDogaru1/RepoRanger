import { graph } from "../../../graph/graph";

/** Remove JS call edges that cannot navigate to any scanned symbol. */
export function pruneUnresolvedJsCalls(): number {
    let pruned = 0;

    for (const [edgeId, edge] of graph.edges) {
        if (
            edge.type !== "CALLS"
            || !edge.from.startsWith("js:")
            || graph.nodes.has(edge.to)
        ) {
            continue;
        }

        graph.edges.delete(edgeId);
        pruned += 1;
    }

    return pruned;
}
