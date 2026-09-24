import assert from "node:assert/strict";
import { scoreConfidence } from "../../../src/analyzers/locate/confidence";

const freshness = {
    scannedAt: null,
    scannedAtInferred: false,
    ageDays: 0,
    commit: null,
    branch: null,
    dirtyAtScan: null,
    includesTests: true,
    commitDrift: "same" as const,
    stale: false,
    summary: "fresh",
};

const base = {
    query: "GET /api/v3/pages/{page}",
    match: { id: "api:GET:/api/pages/{param}", type: "api_endpoint", name: "GET /pages", file: "routes/api.php", score: 1800, matchReason: "exact" },
    fileCount: 5,
    hasEntry: true,
    missingCoverage: [],
    ambiguous: false,
    freshness,
};

assert.equal(scoreConfidence(base).level, "high");

const shared = scoreConfidence({ ...base, routeHandlerCount: 2 });
assert.notEqual(shared.level, "high", "a URL served by several controllers must not be reported as high confidence");
assert.ok(shared.reasons.some(reason => /2 controllers/.test(reason)));
assert.ok(shared.fallback, "the agent gets an rg fallback to disambiguate");

console.log("locate confidence tests passed");
