const ROUTE_PATH_STOP_SEGMENTS = new Set([
    "api",
    "v1",
    "v2",
    "v3",
    "v4",
    "www",
    "get",
    "post",
    "put",
    "patch",
    "delete",
]);

const API_PREFIXES = ["/api/v4", "/api/v3", "/api/v2", "/api/v1", "/api"];

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

    const lower = normalized.toLowerCase();
    for (const prefix of API_PREFIXES) {
        if (lower === prefix || lower.startsWith(`${prefix}/`)) {
            normalized = normalized.slice(prefix.length) || "/";
            break;
        }
    }

    return normalizeRoutePath(normalized);
}

export function parseRouteTicketQuery(query: string): { verb?: string; path: string } {
    const trimmed = query.trim();

    if (trimmed.startsWith("api:")) {
        const colon = trimmed.indexOf(":", 4);
        if (colon > 0) {
            const verb = trimmed.slice(4, colon);
            const path = trimmed.slice(colon + 1);
            return {
                verb: verb.toUpperCase(),
                path: stripApiPathPrefix(path),
            };
        }
    }

    const verbPath = trimmed.match(/^(get|post|put|patch|delete)\s+(\S+)/i);
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
    normalizedPath: string;
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
        .filter(segment => segment.length >= 2 && !ROUTE_PATH_STOP_SEGMENTS.has(segment.toLowerCase()));

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
    const parsed = parseRouteTicketQuery(trimmed);
    const normalizedPath = normalizeRoutePath(parsed.path);
    const normalizedPaths = normalizedPathVariants(normalizedPath);

    for (const pathVariant of normalizedPaths) {
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
        normalizedPath,
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
