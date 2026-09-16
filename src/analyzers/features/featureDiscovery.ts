import path from "node:path";
import Database from "better-sqlite3";
import {
    loadProjectScopes,
    searchNodes,
    type SearchMatch,
} from "../../graph/queries/searchNodes";
import {
    classifyCodeLocation,
    type CodeRuntime,
} from "../../shared/classification/codeLocation";

type SQLiteDatabase = InstanceType<typeof Database>;

export type FeatureFileRole =
    | "route"
    | "controller"
    | "service"
    | "repository"
    | "model"
    | "resource"
    | "component"
    | "composable"
    | "registry"
    | "config"
    | "test"
    | "other";

export interface FeatureFile {
    file: string;
    score: number;
    role: FeatureFileRole;
    nodeTypes: string[];
    workspace: string | null;
    runtime: CodeRuntime;
    reasons: string[];
}

export interface SimilarFile extends FeatureFile {
    similarity: number;
}

export interface FeatureDiscoveryOptions {
    runtime?: CodeRuntime;
    workspace?: string;
    maxFiles?: number;
    includeSimilarity?: boolean;
}

export interface FeatureDiscoveryResult {
    query: string;
    label: string;
    workspaces: string[];
    runtimes: CodeRuntime[];
    files: FeatureFile[];
    entryPoints: FeatureFile[];
    registries: FeatureFile[];
    tests: FeatureFile[];
    exactMatches: SearchMatch[];
    similar: SimilarFile[];
    warnings: string[];
}

interface FileProfile {
    file: string;
    nodeTypes: string[];
    symbolTerms: string[];
}

interface RankedCandidate {
    score: number;
    reasons: Set<string>;
}

const GENERIC_PATH_TOKENS = new Set([
    "app", "apps", "src", "source", "packages", "clientpackages", "resources",
    "assets", "js", "ts", "components", "component", "pages", "page", "index",
    "lib", "shared", "common", "frontend", "backend", "test", "tests", "spec",
    "nuxt", "vue", "design", "module", "modules", "section", "add", "create",
    "implement", "build", "support", "new", "with", "for", "the", "and",
]);

function splitTerms(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(term => term.length > 1 && !GENERIC_PATH_TOKENS.has(term));
}

function jaccard(left: Set<string>, right: Set<string>): number {
    const union = new Set([...left, ...right]);
    if (union.size === 0) return 0;
    let intersection = 0;
    for (const item of left) {
        if (right.has(item)) intersection += 1;
    }
    return intersection / union.size;
}

function workspaceMatches(actual: string | null, requested: string | undefined): boolean {
    if (!requested) return true;
    if (!actual) return false;
    const normalizedActual = actual.replace(/\\/g, "/").toLowerCase();
    const normalizedRequested = requested.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    return normalizedActual === normalizedRequested || normalizedActual.endsWith(`/${normalizedRequested}`);
}

export function featureFileRole(file: string, nodeTypes: string[] = []): FeatureFileRole {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    if (/(?:^|\/)(?:test|tests|__tests__)\/|\.(?:spec|test|stories)\.[^.]+$/.test(normalized)) return "test";
    if (/(?:^|\/)routes?\//.test(normalized) || nodeTypes.includes("route")) return "route";
    if (/controller/.test(normalized)) return "controller";
    if (/service/.test(normalized)) return "service";
    if (/repositor|querybuilder|\/query\//.test(normalized)) return "repository";
    if (/model/.test(normalized)) return "model";
    if (/composable|\/use[A-Z]/.test(file.replace(/\\/g, "/"))) return "composable";
    if (nodeTypes.includes("component_registry") || /registr|componentmap|modulemap/i.test(normalized)) return "registry";
    if (/\.vue$/i.test(file) || nodeTypes.includes("vue_component")) return "component";
    if (/(?:^|\/)(?:api)?resources?\/(?!assets\/)|resources?\.php$|serializer|transformer/.test(normalized)) return "resource";
    if (/config|\.config\./.test(normalized)) return "config";
    return "other";
}

function fileProfiles(db: SQLiteDatabase, onlyFiles?: string[]): Map<string, FileProfile> {
    const where = onlyFiles?.length
        ? `WHERE file IN (${onlyFiles.map(() => "?").join(", ")})`
        : "WHERE file IS NOT NULL";
    const rows = db.prepare(`
        SELECT file,
               GROUP_CONCAT(DISTINCT type) AS node_types,
               GROUP_CONCAT(DISTINCT CASE WHEN name != file THEN name END) AS node_names
        FROM nodes
        ${where}
        GROUP BY file
    `).all(...(onlyFiles ?? [])) as Array<{
        file: string;
        node_types: string | null;
        node_names: string | null;
    }>;
    return new Map(rows.map(row => [row.file, {
        file: row.file,
        nodeTypes: (row.node_types ?? "").split(",").filter(Boolean),
        symbolTerms: [...new Set(splitTerms(row.node_names ?? ""))],
    }]));
}

function divergentPathTerms(left: string, right: string): [Set<string>, Set<string>] {
    const leftParts = left.replace(/\\/g, "/").split("/");
    const rightParts = right.replace(/\\/g, "/").split("/");
    let common = 0;
    while (
        common < leftParts.length - 1
        && common < rightParts.length - 1
        && leftParts[common]?.toLowerCase() === rightParts[common]?.toLowerCase()
    ) {
        common += 1;
    }
    return [
        new Set(splitTerms(leftParts.slice(common).join("/"))),
        new Set(splitTerms(rightParts.slice(common).join("/"))),
    ];
}

function directlyConnectedFiles(db: SQLiteDatabase, seedFile: string): Map<string, string[]> {
    const rows = db.prepare(`
        SELECT target.file AS file, e.type AS edge_type
        FROM edges e
        JOIN nodes source ON source.id = e.from_id
        JOIN nodes target ON target.id = e.to_id
        WHERE source.file = ? AND target.file IS NOT NULL AND target.file != ?
        UNION ALL
        SELECT source.file AS file, e.type AS edge_type
        FROM edges e
        JOIN nodes source ON source.id = e.from_id
        JOIN nodes target ON target.id = e.to_id
        WHERE target.file = ? AND source.file IS NOT NULL AND source.file != ?
        LIMIT 1000
    `).all(seedFile, seedFile, seedFile, seedFile) as Array<{ file: string; edge_type: string }>;
    const result = new Map<string, string[]>();
    for (const row of rows) {
        const types = result.get(row.file) ?? [];
        if (!types.includes(row.edge_type)) types.push(row.edge_type);
        result.set(row.file, types);
    }
    return result;
}

function classificationForFile(db: SQLiteDatabase, file: string) {
    return classifyCodeLocation(file, loadProjectScopes(db));
}

export function findSimilarFiles(
    db: SQLiteDatabase,
    seedFile: string,
    options: FeatureDiscoveryOptions = {},
): SimilarFile[] {
    const profiles = fileProfiles(db);
    const seed = profiles.get(seedFile);
    if (!seed) return [];

    const seedTypes = new Set(seed.nodeTypes);
    const seedSymbols = new Set(seed.symbolTerms);
    const seedRole = featureFileRole(seedFile, seed.nodeTypes);
    const seedClass = classificationForFile(db, seedFile);
    const connections = directlyConnectedFiles(db, seedFile);
    const maxFiles = options.maxFiles ?? 10;
    const similar: SimilarFile[] = [];

    for (const profile of profiles.values()) {
        if (profile.file === seedFile) continue;
        const classification = classificationForFile(db, profile.file);
        if (options.runtime && classification.runtime !== options.runtime) continue;
        if (!workspaceMatches(classification.workspace, options.workspace)) continue;

        const typeSimilarity = jaccard(seedTypes, new Set(profile.nodeTypes));
        const [seedTerms, candidateTerms] = divergentPathTerms(seedFile, profile.file);
        const termSimilarity = jaccard(seedTerms, candidateTerms);
        const symbolSimilarity = jaccard(seedSymbols, new Set(profile.symbolTerms));
        const role = featureFileRole(profile.file, profile.nodeTypes);
        const edges = connections.get(profile.file) ?? [];
        let score = typeSimilarity * 10 + termSimilarity * 35 + symbolSimilarity * 25;
        if (role === seedRole && role !== "other") score += 8;
        if (classification.runtime === seedClass.runtime) score += 4;
        if (classification.workspace === seedClass.workspace) score += 2;
        if (path.extname(profile.file) === path.extname(seedFile)) score += 2;
        if (edges.length > 0) score += 20;
        if (score < 30) continue;

        const reasons: string[] = [];
        if (termSimilarity > 0) reasons.push("shared feature/path terms");
        if (symbolSimilarity > 0) reasons.push("shared symbols or component API");
        if (typeSimilarity >= 0.5) reasons.push("similar graph node shape");
        if (role === seedRole && role !== "other") reasons.push(`same ${role} role`);
        if (edges.length > 0) reasons.push(`direct graph link: ${edges.slice(0, 3).join(", ")}`);
        similar.push({
            file: profile.file,
            score: Math.round(score * 10) / 10,
            similarity: Math.min(1, score / 100),
            role,
            nodeTypes: profile.nodeTypes,
            workspace: classification.workspace,
            runtime: classification.runtime,
            reasons,
        });
    }

    return similar
        .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
        .slice(0, maxFiles);
}

function neighborRows(db: SQLiteDatabase, seedFiles: string[]): Array<{ file: string; edge_type: string }> {
    if (seedFiles.length === 0) return [];
    const slots = seedFiles.map(() => "?").join(", ");
    return db.prepare(`
        SELECT target.file AS file, e.type AS edge_type
        FROM edges e
        JOIN nodes source ON source.id = e.from_id
        JOIN nodes target ON target.id = e.to_id
        WHERE source.file IN (${slots})
          AND target.file IS NOT NULL
          AND target.file NOT IN (${slots})
        UNION ALL
        SELECT source.file AS file, e.type AS edge_type
        FROM edges e
        JOIN nodes source ON source.id = e.from_id
        JOIN nodes target ON target.id = e.to_id
        WHERE target.file IN (${slots})
          AND source.file IS NOT NULL
          AND source.file NOT IN (${slots})
        LIMIT 1500
    `).all(...seedFiles, ...seedFiles, ...seedFiles, ...seedFiles) as Array<{ file: string; edge_type: string }>;
}

function edgeBonus(type: string): number {
    if (["REGISTERED_AS", "RESOLVES_VIA_REGISTRY", "RENDERS_DYNAMIC"].includes(type)) return 330;
    if (["ROUTES_TO", "HTTP_REQUEST", "HANDLED_BY"].includes(type)) return 280;
    if (["CALLS", "DEPENDS_ON", "RENDERS_COMPONENT"].includes(type)) return 210;
    if (["IMPORTS", "REFERENCES"].includes(type)) return 130;
    return 80;
}

function featureLabel(query: string, files: FeatureFile[]): string {
    const queryLabel = query.trim().replace(/\s+/g, " ");
    if (queryLabel) return queryLabel;
    const termCounts = new Map<string, number>();
    for (const file of files) {
        for (const term of new Set(splitTerms(file.file))) {
            termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
        }
    }
    return [...termCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "feature";
}

export function discoverFeature(
    db: SQLiteDatabase,
    query: string,
    options: FeatureDiscoveryOptions = {},
): FeatureDiscoveryResult {
    const maxFiles = options.maxFiles ?? 20;
    const matchOptions = {
        kind: "all",
        limit: 60,
        runtime: options.runtime,
        workspace: options.workspace,
        dedupeByFile: true,
    } as const;
    const initialMatches = searchNodes(db, query, matchOptions);
    const matchById = new Map(initialMatches.map(match => [match.id, match]));
    if (initialMatches.length === 0) {
        for (const term of splitTerms(query).slice(0, 5)) {
            for (const match of searchNodes(db, term, { ...matchOptions, limit: 15 })) {
                const current = matchById.get(match.id);
                if (!current || match.score > current.score) matchById.set(match.id, match);
            }
        }
    }
    const exactMatches = [...matchById.values()]
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, 60);
    const candidates = new Map<string, RankedCandidate>();
    for (const match of exactMatches) {
        if (!match.file) continue;
        candidates.set(match.file, {
            score: match.score,
            reasons: new Set([match.matchReason]),
        });
    }

    const seedFiles = exactMatches.flatMap(match => match.file ? [match.file] : []).slice(0, 8);
    for (const row of neighborRows(db, seedFiles)) {
        const current = candidates.get(row.file) ?? { score: 0, reasons: new Set<string>() };
        current.score = Math.max(current.score, 450 + edgeBonus(row.edge_type));
        current.reasons.add(`connected by ${row.edge_type}`);
        candidates.set(row.file, current);
    }

    const similar = options.includeSimilarity === false || seedFiles.length === 0
        ? []
        : findSimilarFiles(db, seedFiles[0]!, { ...options, maxFiles: 12 });
    for (const item of similar) {
        const current = candidates.get(item.file) ?? { score: 0, reasons: new Set<string>() };
        current.score = Math.max(current.score, 350 + item.score);
        current.reasons.add(`structurally similar to ${seedFiles[0]}`);
        candidates.set(item.file, current);
    }

    const profiles = fileProfiles(db, [...candidates.keys()]);
    const files: FeatureFile[] = [];
    for (const [file, candidate] of candidates) {
        const classification = classificationForFile(db, file);
        if (options.runtime && classification.runtime !== options.runtime) continue;
        if (!workspaceMatches(classification.workspace, options.workspace)) continue;
        const nodeTypes = profiles.get(file)?.nodeTypes ?? [];
        files.push({
            file,
            score: Math.round(candidate.score * 10) / 10,
            role: featureFileRole(file, nodeTypes),
            nodeTypes,
            workspace: classification.workspace,
            runtime: classification.runtime,
            reasons: [...candidate.reasons],
        });
    }
    files.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
    const selected = files.slice(0, maxFiles);
    const warnings: string[] = [];
    if (exactMatches.length === 0) warnings.push("No lexical graph match; try a concrete symbol, route, or file term.");
    if (selected.length === maxFiles && files.length > maxFiles) warnings.push(`Results truncated to ${maxFiles} files.`);

    return {
        query,
        label: featureLabel(query, selected),
        workspaces: [...new Set(selected.flatMap(file => file.workspace ? [file.workspace] : []))],
        runtimes: [...new Set(selected.map(file => file.runtime))],
        files: selected,
        entryPoints: selected.filter(file => ["route", "controller"].includes(file.role) || file.nodeTypes.includes("api_endpoint")),
        registries: selected.filter(file => file.role === "registry" || file.nodeTypes.includes("component_registry")),
        tests: selected.filter(file => file.role === "test"),
        exactMatches: exactMatches.slice(0, 10),
        similar,
        warnings,
    };
}
