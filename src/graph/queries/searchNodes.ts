import Database from "better-sqlite3";
import {
    buildRouteSearchPlan,
    isLowSignalRouteFile,
    isProductionRouteFile,
    ROUTE_SEARCH_LIMITS,
    type RouteSearchPlan,
} from "./routeSearchVariants";
import {
    buildSearchQueryVariants,
    type QueryVariant,
    VARIANT_SCORE_BONUS,
} from "./searchQueryVariants";

type SQLiteDatabase = InstanceType<typeof Database>;

export type SearchKind = "auto" | "symbol" | "route" | "field" | "config" | "all";

export interface SearchMatch {
    id: string;
    type: string;
    name: string | null;
    file: string | null;
    score: number;
    matchReason: string;
}

export interface SearchOptions {
    kind?: SearchKind;
    limit?: number;
}

type NodeRow = {
    id: string;
    type: string;
    name: string | null;
    file: string | null;
};

const SOURCE_FILE_EXTENSIONS = [
    ".vue",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".mjs",
    ".cjs",
    ".php",
    ".blade.php",
];

const TOKEN_VARIANT_SCORE_CAP = 650;
const FILE_REPRESENTATIVE_TYPES = new Set([
    "js_module",
    "vue_component",
    "blade_view",
]);

const SYMBOL_TYPES = new Set([
    "class",
    "method",
    "interface",
    "trait",
    "vue_component",
    "js_module",
    "blade_view",
    "property",
    "parameter",
]);

const FIELD_TYPES = new Set([
    "request_field",
    "model_field",
    "variable_field",
    "response_field",
]);

function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
}

function normalizeQuery(raw: string): string {
    return raw.trim().replace(/\\/g, "\\");
}

function normalizeSearchPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileNameParts(file: string): { baseName: string; stem: string } {
    const normalized = normalizeSearchPath(file);
    const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
    const extension = SOURCE_FILE_EXTENSIONS.find(candidate =>
        baseName.toLowerCase().endsWith(candidate)
    );
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    return { baseName, stem };
}

function detectKind(query: string, explicit?: SearchKind): SearchKind {
    if (explicit && explicit !== "auto") {
        return explicit;
    }

    const lower = query.toLowerCase();
    if (query.startsWith("api:") || /^(get|post|put|patch|delete)\s+\//i.test(query)) {
        return "route";
    }
    if (query.startsWith("request_field:") || query.startsWith("model_field:")) {
        return "field";
    }
    if (query.startsWith("config_key:")) {
        return "config";
    }
    if (lower.includes("/") && /\b(get|post|put|patch|delete)\b/i.test(query)) {
        return "route";
    }
    return "symbol";
}

function typesForKind(kind: SearchKind): string[] | null {
    switch (kind) {
        case "symbol":
            return [...SYMBOL_TYPES];
        case "route":
            return ["api_endpoint", "route_name"];
        case "field":
            return [...FIELD_TYPES];
        case "config":
            return ["config_literal"];
        case "all":
            return null;
        default:
            return null;
    }
}

function scoreMatch(
    query: string,
    row: NodeRow,
): { score: number; matchReason: string } {
    const q = query.toLowerCase();
    const id = row.id.toLowerCase();
    const name = (row.name ?? "").toLowerCase();
    const file = (row.file ?? "").toLowerCase();
    const normalizedQueryPath = normalizeSearchPath(query).toLowerCase();
    const normalizedFilePath = normalizeSearchPath(row.file ?? "").toLowerCase();
    const { baseName, stem } = fileNameParts(row.file ?? "");
    const lowerBaseName = baseName.toLowerCase();
    const lowerStem = stem.toLowerCase();
    const representsFile = FILE_REPRESENTATIVE_TYPES.has(row.type);

    if (row.id === query) {
        return { score: 1500, matchReason: "exact id" };
    }

    if (id.endsWith(`\\${q}`) || id === q) {
        return { score: 1450, matchReason: "exact qualified symbol" };
    }

    if (id.endsWith(`::${q}`) || id.endsWith(`\\${q}`)) {
        return { score: 1425, matchReason: "exact symbol suffix" };
    }

    if (id === q || name === q) {
        return { score: 1400, matchReason: "exact name" };
    }

    if (representsFile && normalizedFilePath === normalizedQueryPath) {
        return { score: 1380, matchReason: "exact file path" };
    }

    if (
        representsFile
        &&
        normalizedQueryPath.includes("/")
        && normalizedFilePath.endsWith(`/${normalizedQueryPath}`)
    ) {
        return { score: 1360, matchReason: "exact file path suffix" };
    }

    if (representsFile && lowerBaseName === q) {
        return { score: 1340, matchReason: "exact file name" };
    }

    if (representsFile && lowerStem === q) {
        return { score: 1320, matchReason: "exact file stem" };
    }

    if (id.includes(q)) {
        return { score: 900, matchReason: "id contains query" };
    }

    if (name.includes(q)) {
        return { score: 850, matchReason: "name contains query" };
    }

    if (file.includes(q)) {
        return { score: 800, matchReason: "file path contains query" };
    }

    const tokens = q.split(/[\s/:.\\_-]+/).filter(token => token.length >= 2);
    let tokenHits = 0;
    for (const token of tokens) {
        if (id.includes(token) || name.includes(token) || file.includes(token)) {
            tokenHits += 1;
        }
    }

    if (tokenHits > 0) {
        return { score: 250 + tokenHits * 50, matchReason: `${tokenHits} token(s) matched` };
    }

    return { score: 0, matchReason: "weak match" };
}

function scoreMatchAgainstVariants(
    variants: QueryVariant[],
    row: NodeRow,
    rawQuery?: string,
): { score: number; matchReason: string } {
    let best = { score: 0, matchReason: "weak match" };

    for (const variant of variants) {
        const scored = scoreMatch(variant.text, row);
        let bonus = VARIANT_SCORE_BONUS[variant.source];

        if (
            rawQuery
            && variant.source === "token"
            && looksLikePascalCaseSymbol(rawQuery)
            && variant.text.length < rawQuery.length
            && (row.id.endsWith(`\\${variant.text}`) || row.id.endsWith(`::${variant.text}`))
            && !row.id.toLowerCase().endsWith(`\\${rawQuery.toLowerCase()}`)
            && !row.id.toLowerCase().includes(`\\${rawQuery.toLowerCase()}::`)
        ) {
            bonus -= 250;
        }

        const baseScore = variant.source === "token"
            ? Math.min(scored.score, TOKEN_VARIANT_SCORE_CAP)
            : scored.score;
        const totalScore = baseScore + bonus;
        if (totalScore > best.score) {
            best = {
                score: totalScore,
                matchReason: `${scored.matchReason} via ${variant.source}:${variant.text}`,
            };
        }
    }

    return best;
}

function routePathFromId(id: string): string {
    const colon = id.indexOf(":", 4);
    if (id.startsWith("api:") && colon > 0) {
        return id.slice(colon + 1);
    }
    return id;
}

function routeVerbFromId(id: string): string | null {
    if (!id.startsWith("api:")) {
        return null;
    }

    const colon = id.indexOf(":", 4);
    if (colon <= 0) {
        return null;
    }

    return id.slice(4, colon).toUpperCase();
}

function matchesNormalizedPath(id: string, normalizedPaths: string[]): boolean {
    const routePath = routePathFromId(id);
    const lowerRoutePath = routePath.toLowerCase();

    return normalizedPaths.some(path => {
        const lowerPath = path.toLowerCase();
        return lowerRoutePath === lowerPath
            || lowerRoutePath.endsWith(`:${lowerPath}`)
            || lowerRoutePath.endsWith(lowerPath);
    });
}

function applyVerbScoring(
    id: string,
    score: number,
    verb: string | undefined,
): { score: number; verbReason?: string } {
    if (!verb || score <= 0) {
        return { score };
    }

    const routeVerb = routeVerbFromId(id);
    if (!routeVerb) {
        return { score };
    }

    if (routeVerb === verb) {
        return { score: score + 200, verbReason: "matching HTTP verb" };
    }

    return { score: score - 300, verbReason: "mismatched HTTP verb" };
}

function applyFileScoring(
    file: string | null,
    score: number,
    matchReason: string,
): { score: number; matchReason: string } {
    let nextScore = score;
    let nextReason = matchReason;

    if (isProductionRouteFile(file)) {
        nextScore += 150;
        nextReason += ", production routes file";
    }
    if (isLowSignalRouteFile(file)) {
        nextScore -= 600;
        nextReason += ", test/k6 route file";
    }

    return { score: nextScore, matchReason: nextReason };
}

function scoreRouteMatch(
    row: NodeRow,
    plan: RouteSearchPlan,
): { score: number; matchReason: string } {
    if (plan.exactIds.includes(row.id)) {
        const exact = applyFileScoring(row.file, 1500, "exact route id");
        const withVerb = applyVerbScoring(row.id, exact.score, plan.verb);
        return {
            score: withVerb.score,
            matchReason: withVerb.verbReason
                ? `${exact.matchReason}, ${withVerb.verbReason}`
                : exact.matchReason,
        };
    }

    const id = row.id;
    let score = 0;
    let matchReason = "weak match";

    if (plan.verb && id.toUpperCase().startsWith(`API:${plan.verb}:`) && matchesNormalizedPath(id, plan.normalizedPaths)) {
        score = 1400;
        matchReason = "matching HTTP verb and full route path";
    } else if (matchesNormalizedPath(id, plan.normalizedPaths)) {
        score = 1200;
        matchReason = "full route path match";
    } else {
        for (const path of plan.normalizedPaths) {
            const lowerPath = path.toLowerCase();
            const routePath = routePathFromId(id).toLowerCase();
            if (routePath.endsWith(lowerPath) || routePath.endsWith(`/${lowerPath}`)) {
                score = 1000;
                matchReason = "route path suffix match";
                break;
            }
        }
    }

    if (score === 0) {
        for (const term of plan.pathTerms) {
            const lower = term.toLowerCase();
            if (id.toLowerCase().includes(lower)) {
                const termScore = 500 + lower.length * 10;
                if (termScore > score) {
                    score = termScore;
                    matchReason = `path term ${term}`;
                }
            }
        }
    }

    if (score === 0) {
        return { score: 0, matchReason: "weak match" };
    }

    const withVerb = applyVerbScoring(id, score, plan.verb);
    if (withVerb.verbReason) {
        matchReason += `, ${withVerb.verbReason}`;
    }

    return applyFileScoring(row.file, withVerb.score, matchReason);
}

function fetchRouteRowsByPatterns(
    db: SQLiteDatabase,
    patterns: string[],
    limit: number,
): NodeRow[] {
    const rows: NodeRow[] = [];

    for (const pattern of patterns) {
        const batch = db.prepare(`
            SELECT id, type, name, file
            FROM nodes
            WHERE type IN ('api_endpoint', 'route_name')
              AND id LIKE ? ESCAPE '\\'
            ORDER BY id ASC
            LIMIT ?
        `).all(pattern, limit) as NodeRow[];

        rows.push(...batch);
    }

    return rows;
}

function fetchRouteRows(
    db: SQLiteDatabase,
    plan: RouteSearchPlan,
): NodeRow[] {
    const rowsById = new Map<string, NodeRow>();

    for (const id of plan.exactIds) {
        const row = db.prepare(`
            SELECT id, type, name, file
            FROM nodes
            WHERE id = ?
            LIMIT 1
        `).get(id) as NodeRow | undefined;

        if (row) {
            rowsById.set(row.id, row);
        }
    }

    for (const row of fetchRouteRowsByPatterns(
        db,
        plan.fullPathPatterns,
        ROUTE_SEARCH_LIMITS.fullPathPattern,
    )) {
        rowsById.set(row.id, row);
    }

    for (const row of fetchRouteRowsByPatterns(
        db,
        plan.segmentPatterns,
        ROUTE_SEARCH_LIMITS.segmentPattern,
    )) {
        rowsById.set(row.id, row);
    }

    return [...rowsById.values()];
}

function buildLikePatterns(variants: QueryVariant[]): string[] {
    const patterns = new Set<string>();
    for (const variant of variants) {
        patterns.add(`%${escapeLike(variant.text)}%`);
    }
    return [...patterns];
}

function looksLikePascalCaseSymbol(query: string): boolean {
    return /^[A-Z][A-Za-z0-9]+$/.test(query);
}

function fetchSymbolRowsBySuffix(
    db: SQLiteDatabase,
    suffix: string,
    types: string[] | null,
): NodeRow[] {
    const classPattern = `%\\${escapeLike(suffix)}`;
    const methodPattern = `%\\${escapeLike(suffix)}::%`;
    const typeClause = types
        ? `AND type IN (${types.map(() => "?").join(", ")})`
        : "";

    return db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        WHERE (
            id LIKE ? ESCAPE '\\'
            OR id LIKE ? ESCAPE '\\'
        )
        ${typeClause}
        ORDER BY id ASC
        LIMIT 50
    `).all(methodPattern, classPattern, ...(types ?? [])) as NodeRow[];
}

function fetchHighSignalSymbolRows(
    db: SQLiteDatabase,
    variants: QueryVariant[],
    types: string[] | null,
): NodeRow[] {
    const strongVariants = variants.filter(variant => variant.source !== "token");
    if (strongVariants.length === 0) {
        return [];
    }

    const clauses: string[] = [];
    const params: string[] = [];
    for (const variant of strongVariants) {
        const normalized = normalizeSearchPath(variant.text);
        clauses.push(`(
            LOWER(id) = LOWER(?)
            OR LOWER(IFNULL(name, '')) = LOWER(?)
            OR LOWER(IFNULL(file, '')) = LOWER(?)
            OR LOWER(IFNULL(file, '')) LIKE LOWER(?) ESCAPE '\\'
        )`);
        params.push(normalized, normalized, normalized, `%/${escapeLike(normalized)}`);

        if (!SOURCE_FILE_EXTENSIONS.some(extension => normalized.toLowerCase().endsWith(extension))) {
            for (const extension of SOURCE_FILE_EXTENSIONS) {
                const fileName = `${normalized}${extension}`;
                clauses.push(`(
                    LOWER(IFNULL(file, '')) = LOWER(?)
                    OR LOWER(IFNULL(file, '')) LIKE LOWER(?) ESCAPE '\\'
                )`);
                params.push(fileName, `%/${escapeLike(fileName)}`);
            }
        }
    }

    const typeClause = types
        ? `AND type IN (${types.map(() => "?").join(", ")})`
        : "";

    return db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        WHERE (${clauses.join(" OR ")})
        ${typeClause}
        ORDER BY id ASC
        LIMIT 100
    `).all(...params, ...(types ?? [])) as NodeRow[];
}

function prependUniqueRows(priorityRows: NodeRow[], rows: NodeRow[]): NodeRow[] {
    const priorityIds = new Set(priorityRows.map(row => row.id));
    return [...priorityRows, ...rows.filter(row => !priorityIds.has(row.id))];
}

function fetchSymbolRows(
    db: SQLiteDatabase,
    patterns: string[],
    types: string[] | null,
): NodeRow[] {
    if (patterns.length === 0) {
        return [];
    }

    const clauses: string[] = [];
    const params: string[] = [];

    for (const pattern of patterns) {
        clauses.push(`(
            id LIKE ? ESCAPE '\\'
            OR IFNULL(name, '') LIKE ? ESCAPE '\\'
            OR IFNULL(file, '') LIKE ? ESCAPE '\\'
        )`);
        params.push(pattern, pattern, pattern);
    }

    const typeClause = types
        ? `AND type IN (${types.map(() => "?").join(", ")})`
        : "";

    return db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        WHERE (${clauses.join(" OR ")})
        ${typeClause}
        LIMIT 300
    `).all(...params, ...(types ?? [])) as NodeRow[];
}

function runSearch(
    db: SQLiteDatabase,
    query: string,
    options: SearchOptions | undefined,
    variants: QueryVariant[],
): SearchMatch[] {
    const kind = detectKind(query, options?.kind);
    const limit = options?.limit ?? 20;
    const types = typesForKind(kind);
    let rows: NodeRow[];
    const routePlan = kind === "route" ? buildRouteSearchPlan(query) : null;

    if (routePlan) {
        rows = fetchRouteRows(db, routePlan);
    } else {
        rows = fetchSymbolRows(db, buildLikePatterns(variants), types);
        rows = prependUniqueRows(fetchHighSignalSymbolRows(db, variants, types), rows);
        if (looksLikePascalCaseSymbol(query)) {
            const suffixRows = fetchSymbolRowsBySuffix(db, query, types);
            rows = prependUniqueRows(suffixRows, rows);
        } else if (query.includes("::")) {
            const classPart = query.split("::")[0] ?? "";
            if (looksLikePascalCaseSymbol(classPart) || classPart.includes("\\")) {
                const suffixRows = fetchSymbolRowsBySuffix(db, query, types);
                rows = prependUniqueRows(suffixRows, rows);
            }
        }
    }

    const exact = db.prepare(`
        SELECT id, type, name, file
        FROM nodes
        WHERE id = ?
        LIMIT 1
    `).get(query) as NodeRow | undefined;

    if (exact) {
        rows = [exact, ...rows.filter(row => row.id !== exact.id)];
    }

    const scored = rows
        .map(row => {
            if (routePlan) {
                const { score, matchReason } = scoreRouteMatch(row, routePlan);
                return { ...row, score, matchReason };
            }

            const { score, matchReason } = scoreMatchAgainstVariants(variants, row, query);
            return { ...row, score, matchReason };
        })
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const seen = new Set<string>();
    const result: SearchMatch[] = [];
    for (const row of scored) {
        if (seen.has(row.id)) {
            continue;
        }
        seen.add(row.id);
        result.push(row);
        if (result.length >= limit) {
            break;
        }
    }

    return result;
}

export function searchNodes(
    db: SQLiteDatabase,
    rawQuery: string,
    options?: SearchOptions,
): SearchMatch[] {
    const query = normalizeQuery(rawQuery);
    if (!query) {
        return [];
    }

    const variants = buildSearchQueryVariants(query);
    const resolvedKind = detectKind(query, options?.kind);
    const primary = runSearch(db, query, options, variants);
    if (primary.length > 0) {
        return primary;
    }

    if (resolvedKind === "route") {
        return [];
    }

    if (options?.kind !== "all") {
        const widened = runSearch(db, query, { ...options, kind: "all" }, variants);
        if (widened.length > 0) {
            return widened;
        }
    }

    const tokenVariants = variants.filter(variant => variant.source === "token");
    if (tokenVariants.length > 0) {
        const tokenResults = runSearch(db, query, { ...options, kind: "all" }, tokenVariants);
        if (tokenResults.length > 0) {
            return tokenResults;
        }
    }

    return [];
}
