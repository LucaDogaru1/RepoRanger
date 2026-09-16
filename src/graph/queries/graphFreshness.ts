import Database from "better-sqlite3";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

type SQLiteDatabase = InstanceType<typeof Database>;

export interface GraphFreshness {
    scannedAt: string | null;
    scannedAtInferred: boolean;
    ageDays: number | null;
    commit: string | null;
    branch: string | null;
    dirtyAtScan: boolean | null;
    includesTests: boolean | null;
    commitDrift: "same" | "different" | "unknown";
    stale: boolean;
    summary: string;
}

const STALE_AFTER_DAYS = 14;

function readMeta(db: SQLiteDatabase): Map<string, string> {
    const meta = new Map<string, string>();
    const hasTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'graph_meta' LIMIT 1
    `).get() as { name: string } | undefined;

    if (!hasTable) {
        return meta;
    }

    const rows = db.prepare("SELECT key, value FROM graph_meta").all() as Array<{
        key: string;
        value: string | null;
    }>;
    for (const row of rows) {
        if (row.value !== null) meta.set(row.key, row.value);
    }
    return meta;
}

function graphContainsTestFiles(db: SQLiteDatabase): boolean {
    const row = db.prepare(`
        SELECT 1
        FROM nodes
        WHERE file IS NOT NULL
          AND (
            file LIKE '%/tests/%'
            OR file LIKE 'tests/%'
            OR file LIKE '%/test/%'
            OR file LIKE 'test/%'
            OR file LIKE '%/__tests__/%'
            OR file LIKE '%Test.php'
            OR file LIKE '%Cest.php'
            OR file LIKE '%.test.%'
            OR file LIKE '%.spec.%'
          )
        LIMIT 1
    `).get() as unknown;

    return Boolean(row);
}

function currentCommit(): string | null {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null;
    } catch {
        return null;
    }
}

function fileModifiedAt(dbPath: string | undefined): string | null {
    if (!dbPath) return null;
    try {
        return fs.statSync(dbPath).mtime.toISOString();
    } catch {
        return null;
    }
}

export function readGraphFreshness(db: SQLiteDatabase, dbPath?: string): GraphFreshness {
    const meta = readMeta(db);
    const metaScannedAt = meta.get("scanned_at") ?? null;
    const scannedAt = metaScannedAt ?? fileModifiedAt(dbPath);
    const scannedAtInferred = !metaScannedAt && scannedAt !== null;

    const ageDays = scannedAt
        ? Math.max(0, Math.round((Date.now() - new Date(scannedAt).getTime()) / 86_400_000))
        : null;

    const commit = meta.get("git_commit") ?? null;
    const head = currentCommit();
    const commitDrift: GraphFreshness["commitDrift"] = commit && head
        ? (commit === head ? "same" : "different")
        : "unknown";

    const includesTestsRaw = meta.get("scan_includes_tests");
    const includesTests = includesTestsRaw === undefined
        ? graphContainsTestFiles(db)
        : includesTestsRaw === "true";
    const dirtyRaw = meta.get("git_dirty");

    const stale = commitDrift === "different"
        || (ageDays !== null && ageDays > STALE_AFTER_DAYS);

    const parts: string[] = [];
    if (ageDays === null) {
        parts.push("age unknown");
    } else {
        parts.push(`${ageDays}d old${scannedAtInferred ? " (file mtime)" : ""}`);
    }
    if (commit) {
        parts.push(`commit ${commit.slice(0, 8)}${commitDrift === "different" ? " ≠ HEAD" : ""}`);
    } else {
        parts.push("commit unknown");
    }
    if (includesTests === false) {
        parts.push("tests not scanned");
    }

    return {
        scannedAt,
        scannedAtInferred,
        ageDays,
        commit,
        branch: meta.get("git_branch") ?? null,
        dirtyAtScan: dirtyRaw === undefined ? null : dirtyRaw === "true",
        includesTests,
        commitDrift,
        stale,
        summary: parts.join("; "),
    };
}
