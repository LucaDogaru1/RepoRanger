import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { findOutgoingCallChain } from "../../../src/graph/queries/callChainQueries";
import { preferConcreteCallTargets } from "../../../src/graph/queries/navigationQueries";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('App\\Controller::index', NULL, 'method', 'index', 'Controller.php', 1, 10),
  ('App\\Service::run', NULL, 'method', 'run', 'Service.php', 1, 10),
  ('App\\Generator::generate', NULL, 'method', 'generate', 'Generator.php', 1, 10),
  ('App\\Query::handle', NULL, 'method', 'handle', 'Query.php', 1, 10),
  ('App\\Query::load', NULL, 'method', 'load', 'Query.php', 11, 20),
  ('App\\Leaf::work', NULL, 'method', 'work', 'Leaf.php', 1, 10),
  ('App\\LegacyQuery::contentsFromDb', NULL, 'method', 'contentsFromDb', 'Legacy.php', 1, 10),
  ('App\\MetadataQuery::contentsFromDb', NULL, 'method', 'contentsFromDb', 'Metadata.php', 1, 10),
  ('App\\QueryInterface::contentsFromDb', NULL, 'method', 'contentsFromDb', 'Interface.php', 1, 10),
  ('App\\FanOut::go', NULL, 'method', 'go', 'FanOut.php', 1, 10),
  ('App\\Hop1::a', NULL, 'method', 'a', 'Hop.php', 1, 5),
  ('App\\Hop1::b', NULL, 'method', 'b', 'Hop.php', 6, 10),
  ('App\\Hop1::c', NULL, 'method', 'c', 'Hop.php', 11, 15),
  ('App\\Hop1::d', NULL, 'method', 'd', 'Hop.php', 16, 20),
  ('App\\Hop1::e', NULL, 'method', 'e', 'Hop.php', 21, 25);

INSERT INTO edges VALUES
  ('App\\Controller::index', 'App\\Service::run', 'CALLS', NULL, NULL),
  ('App\\Service::run', 'App\\Generator::generate', 'CALLS', NULL, NULL),
  ('App\\Generator::generate', 'App\\Query::handle', 'CALLS', NULL, NULL),
  ('App\\Query::handle', 'App\\Query::load', 'CALLS', NULL, NULL),
  ('App\\Query::load', 'App\\Controller::index', 'CALLS', NULL, NULL),
  ('App\\Service::run', 'App\\Leaf::work', 'CALLS', NULL, NULL),
  ('App\\FanOut::go', 'App\\Hop1::a', 'CALLS', NULL, NULL),
  ('App\\FanOut::go', 'App\\Hop1::b', 'CALLS', NULL, NULL),
  ('App\\FanOut::go', 'App\\Hop1::c', 'CALLS', NULL, NULL),
  ('App\\FanOut::go', 'App\\Hop1::d', 'CALLS', NULL, NULL),
  ('App\\FanOut::go', 'App\\Hop1::e', 'CALLS', NULL, NULL);
`);

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`ok ${name}`);
    } catch (error) {
        console.error(`fail ${name}`);
        throw error;
    }
}

test("depth 1 returns only direct callees", () => {
    const { calls } = findOutgoingCallChain(db, "App\\Controller::index", { depth: 1, limit: 20 });
    assert.deepEqual(calls.map(item => item.id), ["App\\Service::run"]);
});

test("depth 3 walks breadth-first without duplicate targets", () => {
    const { calls } = findOutgoingCallChain(db, "App\\Controller::index", { depth: 3, limit: 20 });
    assert.deepEqual(
        calls.map(item => ({ id: item.id, depth: item.depth })),
        [
            { id: "App\\Service::run", depth: 1 },
            { id: "App\\Generator::generate", depth: 2 },
            { id: "App\\Leaf::work", depth: 2 },
            { id: "App\\Query::handle", depth: 3 },
        ],
    );
});

test("total result limit is enforced and marked truncated", () => {
    const { calls, truncated } = findOutgoingCallChain(db, "App\\Controller::index", { depth: 5, limit: 2 });
    assert.equal(calls.length, 2);
    assert.equal(truncated, true);
});

test("cycles on the active path are skipped", () => {
    const { calls } = findOutgoingCallChain(db, "App\\Controller::index", { depth: 5, limit: 20 });
    assert.ok(!calls.some(item => item.id === "App\\Controller::index"));
});

test("per-hop limit marks result truncated", () => {
    const { calls, truncated } = findOutgoingCallChain(db, "App\\FanOut::go", { depth: 1, limit: 20, perHopLimit: 3 });
    assert.equal(calls.length, 3);
    assert.equal(truncated, true);
});

test("preferConcreteCallTargets keeps multiple concrete overrides with same method name", () => {
    const preferred = preferConcreteCallTargets([
        { id: "App\\LegacyQuery::contentsFromDb" },
        { id: "App\\MetadataQuery::contentsFromDb" },
        { id: "App\\QueryInterface::contentsFromDb" },
    ]);

    assert.deepEqual(
        preferred.map(item => item.id).sort(),
        [
            "App\\LegacyQuery::contentsFromDb",
            "App\\MetadataQuery::contentsFromDb",
        ],
    );
});
