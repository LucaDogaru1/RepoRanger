import Database from "better-sqlite3";
import { buildLocate } from "../src/analyzers/locate/locate";

const dbPath = process.argv[2] ?? "spott/Graph.sqlite";
const sampleSize = Number(process.argv[3] ?? 150);
const db = new Database(dbPath, { readonly: true });

const DATA_LAYER = /Query|Repository|Finder|Dao|Builder/i;

const endpoints = db.prepare(`
    SELECT e.from_id AS endpoint_id, e.to_id AS controller_method
    FROM edges e
    WHERE e.type = 'ROUTES_TO'
    ORDER BY e.from_id ASC
`).all() as Array<{ endpoint_id: string; controller_method: string }>;

const outgoing = db.prepare(`
    SELECT e.to_id FROM edges e WHERE e.type = 'CALLS' AND e.from_id = ?
`);
const implementors = db.prepare(`
    SELECT from_id FROM edges WHERE type = 'IMPLEMENTS' AND to_id = ?
`);
const nodeById = db.prepare("SELECT id, type, parent FROM nodes WHERE id = ?");

function reachableDataLayer(startId: string, maxDepth: number): string | null {
    const seen = new Set<string>([startId]);
    let frontier = [startId];

    for (let depth = 0; depth < maxDepth; depth += 1) {
        const next: string[] = [];
        for (const current of frontier) {
            for (const row of outgoing.all(current) as Array<{ to_id: string }>) {
                const targets = [row.to_id];
                const node = nodeById.get(row.to_id) as { parent: string | null } | undefined;
                if (node?.parent) {
                    for (const impl of implementors.all(node.parent) as Array<{ from_id: string }>) {
                        targets.push(`${impl.from_id}::${row.to_id.split("::").pop()}`);
                    }
                }
                for (const target of targets) {
                    if (seen.has(target)) continue;
                    seen.add(target);
                    const className = target.split("::")[0]!.split("\\").pop() ?? "";
                    if (DATA_LAYER.test(className)) return target;
                    next.push(target);
                }
            }
        }
        frontier = next;
    }
    return null;
}

let considered = 0;
let hits = 0;
const misses: string[] = [];

for (const endpoint of endpoints.slice(0, sampleSize)) {
    const expected = reachableDataLayer(endpoint.controller_method, 4);
    if (!expected) continue;
    considered += 1;

    const located = buildLocate(db, endpoint.endpoint_id, { kind: "route", depth: 3, limit: 12 });
    const text = located.ok
        ? [
            ...located.data.flow,
            ...located.data.files.map(file => `${file.file} ${file.nodeId}`),
        ].join("\n")
        : "";

    if (DATA_LAYER.test(text)) {
        hits += 1;
    } else if (misses.length < 12) {
        misses.push(`${endpoint.endpoint_id}  (expected ${expected})`);
    }
}

const rate = considered === 0 ? 0 : (hits / considered) * 100;
console.log(`endpoints with a reachable data layer: ${considered}`);
console.log(`locate surfaced it: ${hits} (${rate.toFixed(1)}%)`);
if (misses.length > 0) {
    console.log("\nmisses:");
    for (const miss of misses) console.log(`  ${miss}`);
}

db.close();
