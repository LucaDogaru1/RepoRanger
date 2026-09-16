import { graph } from "../../../graph/graph";
import {
    httpClientEndpointId,
    normalizeEndpointPath,
    parseApiEndpointId,
    parseHttpEndpointId,
} from "../resolvers/endpointNormalizer";

export interface CrossLanguageLinkStats {
    canonicalized: number;
    /** Kept for CLI compatibility; endpoint identities are no longer merged. */
    merged: number;
    backendLinked: number;
}

function hasRoutesTo(endpointId: string): boolean {
    for (const edge of graph.edges.values()) {
        if (edge.from === endpointId && edge.type === "ROUTES_TO") {
            return true;
        }
    }
    return false;
}

function rebuildEdgeMap(): void {
    const edges = [...graph.edges.values()];
    graph.edges.clear();

    for (const edge of edges) {
        const key = `${edge.from}->${edge.to}:${edge.type}:${edge.via ?? ""}`;
        graph.edges.set(key, edge);
    }
}

function canonicalizeHttpEndpointIds(): number {
    let canonicalized = 0;

    for (const [id, node] of [...graph.nodes.entries()]) {
        if (node.type !== "http_endpoint") {
            continue;
        }

        const parsed = parseHttpEndpointId(id);
        if (!parsed) {
            continue;
        }

        const canonicalId = httpClientEndpointId(parsed.method, parsed.path);
        if (canonicalId === id) {
            continue;
        }

        const existing = graph.nodes.get(canonicalId);
        if (existing) {
            existing.keywords = [...new Set([...(existing.keywords ?? []), ...(node.keywords ?? [])])];
        } else {
            node.id = canonicalId;
            graph.nodes.set(canonicalId, node);
        }
        graph.nodes.delete(id);

        for (const edge of graph.edges.values()) {
            if (edge.from === id) edge.from = canonicalId;
            if (edge.to === id) edge.to = canonicalId;
        }
        canonicalized += 1;
    }

    if (canonicalized > 0) {
        rebuildEdgeMap();
    }
    return canonicalized;
}

function stripConventionalApiPrefix(path: string): string {
    const normalized = normalizeEndpointPath(path);
    const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return normalizeEndpointPath(
        withLeadingSlash.replace(/^\/api(?:\/v\d+)?(?=\/|$)/i, "") || "/",
    );
}

function endpointPathsMatch(clientPath: string, routePath: string): {
    matches: boolean;
    confidence: number;
    reason: string;
} {
    const client = normalizeEndpointPath(clientPath).toLowerCase();
    const route = normalizeEndpointPath(routePath).toLowerCase();
    if (client === route) {
        return { matches: true, confidence: 1, reason: "identical normalized endpoint path" };
    }

    if (stripConventionalApiPrefix(client) === stripConventionalApiPrefix(route)) {
        return {
            matches: true,
            confidence: 0.9,
            reason: "endpoint paths match after conventional API/version prefix normalization",
        };
    }

    return { matches: false, confidence: 0, reason: "different endpoint paths" };
}

function linkHttpEndpointsToRoutes(): number {
    const routes = [...graph.nodes.entries()]
        .filter(([id, node]) => node.type === "api_endpoint" && hasRoutesTo(id))
        .flatMap(([id]) => {
            const parsed = parseApiEndpointId(id);
            return parsed ? [{ id, ...parsed }] : [];
        });

    let linked = 0;
    for (const [clientId, node] of graph.nodes) {
        if (node.type !== "http_endpoint") {
            continue;
        }

        const client = parseHttpEndpointId(clientId);
        if (!client) {
            continue;
        }

        for (const route of routes) {
            if (route.method !== client.method) {
                continue;
            }

            const pathMatch = endpointPathsMatch(client.path, route.path);
            if (!pathMatch.matches) {
                continue;
            }

            graph.edges.set(`${clientId}->${route.id}:RESOLVES_TO`, {
                from: clientId,
                to: route.id,
                type: "RESOLVES_TO",
                confidence: pathMatch.confidence,
                reason: `HTTP client request resolves to backend route: ${pathMatch.reason}`,
            });
            linked += 1;
        }
    }

    return linked;
}

/**
 * Link frontend HTTP requests to backend routes without collapsing their nodes.
 * A request site and a route provider have different files, runtimes and roles;
 * RESOLVES_TO preserves that distinction while keeping navigation connected.
 */
export function linkCrossLanguageEndpoints(): CrossLanguageLinkStats {
    const canonicalized = canonicalizeHttpEndpointIds();
    const backendLinked = linkHttpEndpointsToRoutes();

    return { canonicalized, merged: 0, backendLinked };
}
