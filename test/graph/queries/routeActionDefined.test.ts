import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { isRouteActionDefined } from "../../../src/graph/queries/navigationQueries";
import { scoreConfidence } from "../../../src/analyzers/locate/confidence";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, file TEXT);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT);
INSERT INTO nodes VALUES
  ('App\\Http\\DistributionTypeController', 'class', 'app/Http/DistributionTypeController.php'),
  ('App\\Http\\DistributionTypeController::index', 'method', 'app/Http/DistributionTypeController.php'),
  ('App\\Http\\CrudController', 'class', 'app/Http/CrudController.php'),
  ('App\\Http\\CrudController::update', 'method', 'app/Http/CrudController.php'),
  ('App\\Http\\Concerns\\Destroys::destroy', 'method', 'app/Http/Concerns/Destroys.php'),
  ('App\\Http\\CurrencyController', 'class', 'app/Http/CurrencyController.php');
INSERT INTO edges VALUES
  ('App\\Http\\CurrencyController', 'App\\Http\\CrudController', 'EXTENDS'),
  ('App\\Http\\CrudController', 'App\\Http\\Concerns\\Destroys', 'USES_TRAIT');
`);

assert.equal(isRouteActionDefined(db, "App\\Http\\DistributionTypeController::index"), true);
assert.equal(
    isRouteActionDefined(db, "App\\Http\\DistributionTypeController::update"),
    false,
    "a resource action the controller does not implement is reported as missing",
);
assert.equal(isRouteActionDefined(db, "App\\Http\\CurrencyController::update"), true, "inherited actions count as defined");
assert.equal(isRouteActionDefined(db, "App\\Http\\CurrencyController::destroy"), true, "actions from traits of ancestors count as defined");

const confidence = scoreConfidence({
    query: "PATCH /api/distributionTypes/{id}",
    match: { id: "api:PATCH:/api/distributionTypes/{param}", score: 1800, matchReason: "route" } as never,
    fileCount: 1,
    hasEntry: true,
    missingCoverage: [],
    ambiguous: false,
    missingRouteAction: "DistributionTypeController::update",
    freshness: { commitDrift: "same", ageDays: 0, includesTests: true } as never,
});
assert.notEqual(confidence.level, "high");
assert.ok(confidence.reasons.some(reason => reason.includes("DistributionTypeController::update is not defined")));

console.log("route action tests passed");
