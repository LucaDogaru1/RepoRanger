import Database from "better-sqlite3";
import { classifyFileRole } from "../../shared/classification/fileRole";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface RelatedTestRow {
    file: string;
    nodeId: string;
    startRow: number | null;
    endRow: number | null;
    reason: string;
}

const LINKING_EDGE_TYPES = [
    "CALLS",
    "DEPENDS_ON",
    "INSTANTIATES",
    "IMPORTS",
    "REFERENCES",
    "TYPE_OF",
];

function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, "\\$&");
}

function shortName(nodeId: string): string {
    const withoutMethod = nodeId.split("::")[0] ?? nodeId;
    const tail = withoutMethod.split("\\").pop() ?? withoutMethod;
    return (tail.split("/").pop() ?? tail).replace(/\.(vue|tsx?|jsx?|php)$/i, "");
}

function findTestsByEdge(
    db: SQLiteDatabase,
    symbolIds: string[],
    limit: number,
): RelatedTestRow[] {
    if (symbolIds.length === 0) return [];

    const idPlaceholders = symbolIds.map(() => "?").join(", ");
    const typePlaceholders = LINKING_EDGE_TYPES.map(() => "?").join(", ");

    const rows = db.prepare(`
        SELECT n.id, n.file, n.start_row, n.end_row, e.type, e.to_id
        FROM edges e
        JOIN nodes n ON n.id = e.from_id
        WHERE e.type IN (${typePlaceholders})
          AND e.to_id IN (${idPlaceholders})
          AND n.file IS NOT NULL
        ORDER BY n.file ASC, n.start_row ASC
        LIMIT ?
    `).all(...LINKING_EDGE_TYPES, ...symbolIds, limit * 40) as Array<{
        id: string;
        file: string;
        start_row: number | null;
        end_row: number | null;
        type: string;
        to_id: string;
    }>;

    return rows
        .filter(row => classifyFileRole(row.file) === "test")
        .map(row => ({
            file: row.file,
            nodeId: row.id,
            startRow: row.start_row,
            endRow: row.end_row,
            reason: `${row.type} ${shortName(row.to_id)}`,
        }));
}

function findTestsByName(
    db: SQLiteDatabase,
    symbolIds: string[],
    limit: number,
): RelatedTestRow[] {
    const names = [...new Set(symbolIds.map(shortName))].filter(name => name.length >= 4);
    if (names.length === 0) return [];

    const clauses = names.map(() => "n.file LIKE ? ESCAPE '\\'").join(" OR ");
    const params = names.map(name => `%${escapeLike(name)}%`);

    const rows = db.prepare(`
        SELECT n.id, n.file, n.start_row, n.end_row
        FROM nodes n
        WHERE n.file IS NOT NULL
          AND (${clauses})
        ORDER BY n.file ASC, n.start_row ASC
        LIMIT ?
    `).all(...params, limit * 40) as Array<{
        id: string;
        file: string;
        start_row: number | null;
        end_row: number | null;
    }>;

    return rows
        .filter(row => classifyFileRole(row.file) === "test")
        .map(row => ({
            file: row.file,
            nodeId: row.id,
            startRow: row.start_row,
            endRow: row.end_row,
            reason: "name convention",
        }));
}

export function findRelatedTests(
    db: SQLiteDatabase,
    symbolIds: string[],
    limit = 3,
): RelatedTestRow[] {
    const unique = [...new Set(symbolIds.filter(Boolean))].slice(0, 12);
    const candidates = [
        ...findTestsByEdge(db, unique, limit),
        ...findTestsByName(db, unique, limit),
    ];

    const byFile = new Map<string, RelatedTestRow>();
    for (const candidate of candidates) {
        if (!byFile.has(candidate.file)) {
            byFile.set(candidate.file, candidate);
        }
    }

    return [...byFile.values()].slice(0, limit);
}
