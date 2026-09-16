const ROUTE_PATH_STOP_SEGMENTS = new Set([
    "api",
    "www",
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
]);

const SEGMENT_PATTERN_LIMIT = 40;
const FULL_PATH_PATTERN_LIMIT = 80;

export function normalizeRoutePath(path: string): string {
    const normalized = path
        .replace(/\{[^}]+\}/g, "{param}")
        .replace(/\/+/g, "/")
        .replace(/\/$/, "") || "/";

    if (normalized.startsWith("/") && normalized !== "/") {
        return normalized.slice(1);
    }

    return normalized;
}

export function stripApiPathPrefix(path: string): string {
    let normalized = path.replace(/\\/g, "/").trim();
    if (!normalized.startsWith("/")) {
        normalized = `/${normalized}`;
    }

    const apiPrefix = normalized.match(/^\/api(?:\/v\d+)?(?=\/|$)/i)?.[0];
    if (apiPrefix) {
        normalized = normalized.slice(apiPrefix.length) || "/";
    }

    return normalizeRoutePath(normalized);
}

export function parseRouteTicketQuery(query: string): { verb?: string; path: string } {
    const trimmed = query.trim();

    if (trimmed.startsWith("api:") || trimmed.startsWith("http:")) {
        const prefixLength = trimmed.startsWith("http:") ? 5 : 4;
        const colon = trimmed.indexOf(":", prefixLength);
        if (colon > 0) {
            const verb = trimmed.slice(4, colon);
            const path = trimmed.slice(colon + 1);
            return {
                verb: verb.toUpperCase(),
                path: stripApiPathPrefix(path),
            };
        }
    }

    const verbPath = trimmed.match(/^(get|post|put|patch|delete|head|options)\s+(\S+)/i);
    if (verbPath) {
        return {
            verb: verbPath[1]!.toUpperCase(),
            path: stripApiPathPrefix(verbPath[2]!),
        };
    }

    if (trimmed.includes("/")) {
        return { path: stripApiPathPrefix(trimmed) };
    }

    return { path: normalizeRoutePath(trimmed) };
}

export interface RouteEndpointIdentity {
    verb?: string;
    /** Path as written by the caller, including a leading API/version prefix. */
    requestedPath: string;
    /** Path form commonly stored by framework route scanners. */
    frameworkPath: string;
    requestedSegments: string[];
    frameworkSegments: string[];
}

function routePathFromQuery(query: string): { verb?: string; path: string } {
    const trimmed = query.trim();

    if (trimmed.startsWith("api:") || trimmed.startsWith("http:")) {
        const prefixLength = trimmed.startsWith("http:") ? 5 : 4;
        const colon = trimmed.indexOf(":", prefixLength);
        if (colon > 0) {
            return {
                verb: trimmed.slice(4, colon).toUpperCase(),
                path: normalizeRoutePath(trimmed.slice(colon + 1)),
            };
        }
    }

    const verbPath = trimmed.match(/^(get|post|put|patch|delete|head|options)\s+(\S+)/i);
    if (verbPath) {
        return {
            verb: verbPath[1]!.toUpperCase(),
            path: normalizeRoutePath(verbPath[2]!),
        };
    }

    return { path: normalizeRoutePath(trimmed) };
}

export function routePathSegments(path: string): string[] {
    return normalizeRoutePath(path)
        .split("/")
        .filter(Boolean)
        .map(segment => segment.toLowerCase());
}

/**
 * Keep both the public endpoint path and the framework-local route path.
 * Frameworks often register `/contents` in a versioned `/api/v3` route group;
 * collapsing those paths into one string loses information needed for ranking.
 */
export function buildRouteEndpointIdentity(query: string): RouteEndpointIdentity {
    const requested = routePathFromQuery(query);
    const frameworkPath = stripApiPathPrefix(requested.path);

    return {
        verb: requested.verb,
        requestedPath: requested.path,
        frameworkPath,
        requestedSegments: routePathSegments(requested.path),
        frameworkSegments: routePathSegments(frameworkPath),
    };
}

function segmentIsParameter(segment: string): boolean {
    return segment === "{param}";
}

/** Compare complete path segments; never match a static substring such as
 * `contents` inside `baseConfigEventContents`. */
export function routePathsStructurallyEqual(left: string, right: string): boolean {
    const leftSegments = routePathSegments(left);
    const rightSegments = routePathSegments(right);
    if (leftSegments.length !== rightSegments.length) {
        return false;
    }

    return leftSegments.every((segment, index) => {
        const candidate = rightSegments[index]!;
        return segment === candidate
            || (segmentIsParameter(segment) && segmentIsParameter(candidate));
    });
}

/**
 * Infer conventional API prefixes from route filenames. This is deliberately
 * framework-generic: `routes/api.php` maps to `api`, while `api.v3.php` maps to
 * `api/v3`. It does not depend on project names or endpoint vocabulary.
 */
export function inferRouteFilePrefix(file: string | null): string | null {
    if (!file) {
        return null;
    }

    const normalized = file.replace(/\\/g, "/").toLowerCase();
    const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
    const stem = baseName.replace(/\.(?:php|ts|js)$/, "");
    const parts = stem.split(/[._-]+/).filter(Boolean);
    const apiIndex = parts.indexOf("api");
    if (apiIndex < 0) {
        return null;
    }

    const version = parts[apiIndex + 1];
    return version && /^v\d+$/.test(version)
        ? `api/${version}`
        : "api";
}

export function candidateRoutePaths(endpointId: string, file: string | null): string[] {
    const prefixLength = endpointId.startsWith("http:") ? 5 : 4;
    const colon = endpointId.indexOf(":", prefixLength);
    const storedPath = normalizeRoutePath(
        (endpointId.startsWith("api:") || endpointId.startsWith("http:")) && colon > 0
            ? endpointId.slice(colon + 1)
            : endpointId,
    );
    const paths = new Set<string>([storedPath]);
    const prefix = inferRouteFilePrefix(file);

    if (prefix && storedPath !== prefix && !storedPath.startsWith(`${prefix}/`)) {
        paths.add(normalizeRoutePath(`${prefix}/${storedPath}`));
    }

    return [...paths];
}

export function buildRouteEndpointId(verb: string | undefined, path: string): string {
    const normalizedPath = normalizeRoutePath(path);
    if (verb) {
        return `api:${verb.toUpperCase()}:${normalizedPath}`;
    }
    return normalizedPath;
}

export function normalizedPathVariants(path: string): string[] {
    const normalized = normalizeRoutePath(path);
    const variants = new Set<string>([normalized]);

    if (normalized !== "/") {
        variants.add(`/${normalized}`);
    }

    return [...variants];
}

export interface RouteSearchPlan {
    verb?: string;
    explicitEndpointId?: string;
    requestedPath: string;
    normalizedPath: string;
    requestedPaths: string[];
    normalizedPaths: string[];
    exactIds: string[];
    fullPathPatterns: string[];
    segmentPatterns: string[];
    pathTerms: string[];
}

function addPathSegments(
    pathVariant: string,
    pathTerms: Set<string>,
    segmentPatterns: Set<string>,
): void {
    const segments = pathVariant
        .split("/")
        .map(segment => segment.replace(/^\{.*\}$/, "").trim())
        .filter(segment => {
            const lower = segment.toLowerCase();
            return segment.length >= 2
                && !ROUTE_PATH_STOP_SEGMENTS.has(lower)
                && !/^v\d+$/.test(lower);
        });

    for (const segment of segments) {
        pathTerms.add(segment);
        segmentPatterns.add(`%/${segment}%`);
        segmentPatterns.add(`%${segment}%`);
    }
}

export function buildRouteSearchPlan(query: string): RouteSearchPlan {
    const exactIds = new Set<string>();
    const fullPathPatterns = new Set<string>();
    const segmentPatterns = new Set<string>();
    const pathTerms = new Set<string>();

    const trimmed = query.trim();
    const identity = buildRouteEndpointIdentity(trimmed);
    const parsed = parseRouteTicketQuery(trimmed);
    const requestedPath = identity.requestedPath;
    const normalizedPath = identity.frameworkPath;
    const requestedPaths = normalizedPathVariants(requestedPath);
    const normalizedPaths = normalizedPathVariants(normalizedPath);

    if (/^(?:api|http):/i.test(trimmed)) {
        exactIds.add(trimmed);
    }

    for (const pathVariant of new Set([...requestedPaths, ...normalizedPaths])) {
        if (parsed.verb) {
            exactIds.add(buildRouteEndpointId(parsed.verb, pathVariant));
        }

        fullPathPatterns.add(`%:${pathVariant}%`);
        fullPathPatterns.add(`%${pathVariant}%`);
        addPathSegments(pathVariant, pathTerms, segmentPatterns);
    }

    if (!trimmed.includes("/") && trimmed.length >= 3 && !parsed.verb) {
        segmentPatterns.add(`%${trimmed}%`);
        pathTerms.add(trimmed);
    }

    return {
        verb: parsed.verb,
        explicitEndpointId: /^(?:api|http):/i.test(trimmed) ? trimmed : undefined,
        requestedPath,
        normalizedPath,
        requestedPaths,
        normalizedPaths,
        exactIds: [...exactIds],
        fullPathPatterns: [...fullPathPatterns],
        segmentPatterns: [...segmentPatterns],
        pathTerms: [...pathTerms],
    };
}

export function isLowSignalRouteFile(file: string | null): boolean {
    if (!file) {
        return false;
    }

    const normalized = file.replace(/\\/g, "/").toLowerCase();
    const lowSignalDirectory =
        /(?:^|\/)(k6|tests?|fixtures?|benchmark|load[_-]?test)(?:\/|$)/.test(normalized);
    const helperInsideLowSignalArea =
        lowSignalDirectory && /helpers\.[jt]s$/.test(normalized);

    return lowSignalDirectory || helperInsideLowSignalArea;
}

export function isProductionRouteFile(file: string | null): boolean {
    if (!file) {
        return false;
    }

    const normalized = file.replace(/\\/g, "/").toLowerCase();

    return /(?:^|\/)routes\//.test(normalized)
        || /(?:^|\/)routes\/(api|web)\.php$/.test(normalized)
        || /(?:^|\/)[^/]*routes?[^/]*\.(php|ts|js)$/.test(normalized)
        || /(?:^|\/)[^/]*router[^/]*\.(php|ts|js)$/.test(normalized);
}

export function suggestRouteFollowUpQueries(query: string): string[] {
    const suggestions = new Set<string>();
    const plan = buildRouteSearchPlan(query);

    if (plan.normalizedPath && plan.normalizedPath !== "/") {
        suggestions.add(plan.normalizedPath);
    }

    for (const id of plan.exactIds) {
        const pathPart = id.replace(/^api:[A-Z]+:/, "");
        if (pathPart && pathPart !== "/") {
            suggestions.add(pathPart);
        }
    }

    for (const term of plan.pathTerms.slice(-3)) {
        suggestions.add(term);
    }

    return [...suggestions].filter(value => value.length >= 2).slice(0, 5);
}

export const ROUTE_SEARCH_LIMITS = {
    fullPathPattern: FULL_PATH_PATTERN_LIMIT,
    segmentPattern: SEGMENT_PATTERN_LIMIT,
} as const;
