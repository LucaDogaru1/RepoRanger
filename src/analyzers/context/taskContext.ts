import Database from "better-sqlite3";
import {
    discoverFeature,
    type FeatureDiscoveryOptions,
    type FeatureFile,
    type SimilarFile,
} from "../features/featureDiscovery";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface ContextConnection {
    type: string;
    from: string;
    to: string;
}
export interface TaskContext {
    query: string;
    maxTokens: number;
    estimatedTokens: number;
    truncated: boolean;
    workspaces: string[];
    runtimes: string[];
    files: FeatureFile[];
    entryPoints: FeatureFile[];
    registries: FeatureFile[];
    tests: FeatureFile[];
    similar: SimilarFile[];
    connections: ContextConnection[];
    uncertainties: string[];
}

export interface TaskContextOptions extends FeatureDiscoveryOptions {
    maxTokens?: number;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function featureConnections(db: SQLiteDatabase, files: string[]): ContextConnection[] {
    if (files.length === 0) return [];
    const slots = files.map(() => "?").join(", ");
    const rows = db.prepare(`
        SELECT DISTINCT e.type, e.from_id, e.to_id
        FROM edges e
        LEFT JOIN nodes source ON source.id = e.from_id
        LEFT JOIN nodes target ON target.id = e.to_id
        WHERE e.type IN (
            'ROUTES_TO', 'HTTP_REQUEST', 'HANDLED_BY', 'REGISTERED_AS',
            'RESOLVES_VIA_REGISTRY', 'RENDERS_DYNAMIC', 'RENDERS_COMPONENT'
        )
          AND (source.file IN (${slots}) OR target.file IN (${slots}))
        ORDER BY
            CASE e.type
                WHEN 'ROUTES_TO' THEN 1
                WHEN 'HTTP_REQUEST' THEN 2
                WHEN 'REGISTERED_AS' THEN 3
                WHEN 'RESOLVES_VIA_REGISTRY' THEN 4
                ELSE 5
            END,
            e.from_id ASC
        LIMIT 40
    `).all(...files, ...files) as Array<{ type: string; from_id: string; to_id: string }>;
    return rows.map(row => ({ type: row.type, from: row.from_id, to: row.to_id }));
}

function compactFile(file: FeatureFile): FeatureFile {
    return {
        ...file,
        score: Math.round(file.score),
        nodeTypes: file.nodeTypes.slice(0, 6),
        reasons: file.reasons.slice(0, 2),
    };
}

function serializedSize(context: TaskContext): number {
    return JSON.stringify(context).length;
}

function trimToBudget(context: TaskContext): TaskContext {
    const charBudget = context.maxTokens * 4;
    let truncated = false;
    const removable: Array<keyof Pick<TaskContext, "connections" | "similar" | "tests" | "registries" | "entryPoints" | "files">> = [
        "connections", "similar", "tests", "registries", "entryPoints", "files",
    ];
    while (serializedSize(context) > charBudget) {
        let removed = false;
        for (const key of removable) {
            const list = context[key] as unknown[];
            const minimum = key === "files" ? 3 : 0;
            if (list.length > minimum) {
                list.pop();
                removed = true;
                truncated = true;
                break;
            }
        }
        if (!removed) break;
    }
    context.truncated = truncated;
    context.estimatedTokens = estimateTokens(JSON.stringify(context));
    return context;
}

export function buildTaskContext(
    db: SQLiteDatabase,
    query: string,
    options: TaskContextOptions = {},
): TaskContext {
    const maxTokens = Math.max(200, options.maxTokens ?? 2500);
    const feature = discoverFeature(db, query, {
        ...options,
        maxFiles: Math.min(options.maxFiles ?? 20, 20),
        includeSimilarity: true,
    });
    const files = feature.files.map(compactFile);
    const uncertainties = [...feature.warnings];
    if (feature.registries.length === 0) uncertainties.push("No component/config registry was connected to the selected files.");
    if (feature.entryPoints.length === 0) uncertainties.push("No route or controller entry point was connected to the selected files.");
    if (feature.tests.length === 0) uncertainties.push("No test or story was connected to the selected files.");

    return trimToBudget({
        query,
        maxTokens,
        estimatedTokens: 0,
        truncated: false,
        workspaces: feature.workspaces,
        runtimes: feature.runtimes,
        files,
        entryPoints: feature.entryPoints.map(compactFile),
        registries: feature.registries.map(compactFile),
        tests: feature.tests.map(compactFile),
        similar: feature.similar.map(compactFile) as SimilarFile[],
        connections: featureConnections(db, files.map(file => file.file)),
        uncertainties,
    });
}

function shortId(value: string): string {
    const parts = value.split("::");
    return parts.length > 1 ? parts.slice(-2).join("::") : value;
}

export function renderTaskContext(context: TaskContext): string {
    const charBudget = context.maxTokens * 4;
    const lines: string[] = [];
    let truncated = context.truncated;
    const append = (line: string = ""): boolean => {
        const candidate = [...lines, line].join("\n");
        if (candidate.length > charBudget - 80) {
            truncated = true;
            return false;
        }
        lines.push(line);
        return true;
    };

    append(`# Context: ${context.query}`);
    append(`Scope: ${context.workspaces.join(", ") || "unknown"} | runtime: ${context.runtimes.join(", ") || "unknown"}`);
    append("");
    append("## Inspect first");
    for (const [index, file] of context.files.entries()) {
        if (!append(`${index + 1}. ${file.file} — ${file.role}; ${file.reasons.join("; ")}`)) break;
    }

    const sections: Array<[string, string[]]> = [
        ["Entry points", context.entryPoints.map(file => `${file.file} — ${file.role}`)],
        ["Registries", context.registries.map(file => `${file.file} — ${file.nodeTypes.join(", ")}`)],
        ["Similar implementations", context.similar.map(file => `${file.file} — ${Math.round(file.similarity * 100)}% (${file.reasons.join("; ")})`)],
        ["Tests / stories", context.tests.map(file => file.file)],
        ["Cross-stack / registry links", context.connections.map(edge => `${edge.type}: ${shortId(edge.from)} → ${shortId(edge.to)}`)],
        ["Uncertainties", context.uncertainties],
    ];
    for (const [title, items] of sections) {
        if (items.length === 0) continue;
        if (!append("") || !append(`## ${title}`)) break;
        for (const item of items) {
            if (!append(`- ${item}`)) break;
        }
    }
    if (truncated) {
        const marker = "\nOutput truncated to the requested token budget.";
        const current = lines.join("\n");
        return `${current.slice(0, Math.max(0, charBudget - marker.length))}${marker}\n`;
    }
    return `${lines.join("\n")}\n`;
}
