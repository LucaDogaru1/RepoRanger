import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readGraphFreshness } from "../../../src/graph/queries/graphFreshness";

const scannedRepo = path.resolve(__dirname, "../../..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: scannedRepo, encoding: "utf8" }).trim();

const db = new Database(":memory:");
db.exec("CREATE TABLE graph_meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE nodes (file TEXT);");
db.prepare("INSERT INTO graph_meta VALUES (?, ?)").run("scan_roots", `${scannedRepo},/somewhere/else`);
db.prepare("INSERT INTO graph_meta VALUES (?, ?)").run("git_commit", head);
db.prepare("INSERT INTO graph_meta VALUES (?, ?)").run("scanned_at", new Date().toISOString());

const originalCwd = process.cwd();
process.chdir(os.tmpdir());
try {
    assert.equal(
        readGraphFreshness(db).commitDrift,
        "same",
        "commit is compared against the scanned repository, not the current working directory",
    );
} finally {
    process.chdir(originalCwd);
}

console.log("graph freshness tests passed");
