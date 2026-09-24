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

const CONVENTIONAL_API_PREFIX = /^\/api(?:\/v\d+)?(?=\/|$)/i;

function comparablePath(path: string): string {
    const withoutQuery = path.replace(/[?#].*$/, "");
    const normalized = normalizeEndpointPath(withoutQuery).toLowerCase();
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function endpointPathsMatch(clientPath: string, routePath: string, routeMount?: string): {
    matches: boolean;
    confidence: number;
    reason: string;
} {
    const client = comparablePath(clientPath);
    const route = comparablePath(routePath);
    if (client === route) {
        return { matches: true, confidence: 1, reason: "identical normalized endpoint path" };
    }

    const clientHasApiPrefix = CONVENTIONAL_API_PREFIX.test(client);

    if (routeMount !== undefined) {
        if (!clientHasApiPrefix && route === comparablePath(`/api${client}`)) {
            return {
                matches: true,
                confidence: 0.8,
                reason: "client path is relative to the /api base URL",
            };
        }
        return { matches: false, confidence: 0, reason: "different endpoint paths" };
    }

    if (clientHasApiPrefix && comparablePath(client.replace(CONVENTIONAL_API_PREFIX, "") || "/") === route) {
        return {
            matches: true,
            confidence: 0.7,
            reason: "route file mount unknown; assumed conventional API/version prefix",
        };
    }

    return { matches: false, confidence: 0, reason: "different endpoint paths" };
}

function linkHttpEndpointsToRoutes(): number {
    const routes = [...graph.nodes.entries()]
        .filter(([id, node]) => node.type === "api_endpoint" && hasRoutesTo(id))
        .flatMap(([id, node]) => {
            const parsed = parseApiEndpointId(id);
            return parsed ? [{ id, routeMount: node.routeMount, ...parsed }] : [];
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

        const candidates = routes.flatMap(route => {
            if (route.method !== client.method) {
                return [];
            }

            const pathMatch = endpointPathsMatch(client.path, route.path, route.routeMount);
            if (!pathMatch.matches) {
                return [];
            }

            return [{ route, pathMatch }];
        });

        const bestConfidence = Math.max(0, ...candidates.map(candidate => candidate.pathMatch.confidence));
        const best = candidates.filter(candidate => candidate.pathMatch.confidence >= bestConfidence);
        const ambiguity = best.length > 1 ? `; ambiguous between ${best.length} routes` : "";
        for (const { route, pathMatch } of best) {
            graph.edges.set(`${clientId}->${route.id}:RESOLVES_TO`, {
                from: clientId,
                to: route.id,
                type: "RESOLVES_TO",
                confidence: best.length > 1 ? Math.min(pathMatch.confidence, 0.5) : pathMatch.confidence,
                reason: `HTTP client request resolves to backend route: ${pathMatch.reason}${ambiguity}`,
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
