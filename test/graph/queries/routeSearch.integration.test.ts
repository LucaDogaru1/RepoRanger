import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
    buildRouteSearchPlan,
    parseRouteTicketQuery,
    stripApiPathPrefix,
} from "../../../src/graph/queries/routeSearchVariants";
import { searchNodes } from "../../../src/graph/queries/searchNodes";

assert.equal(stripApiPathPrefix("/api/v3/config/settings"), "config/settings");
assert.equal(
    parseRouteTicketQuery("api:GET:/api/v3/config/settings").path,
    "config/settings",
);
assert.equal(
    parseRouteTicketQuery("POST /api/v2/users/{userId}/settings").path,
    "users/{param}/settings",
);
assert.equal(
    parseRouteTicketQuery("GET /internal/api/v1/reports").path,
    "internal/api/v1/reports",
);

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);

INSERT INTO nodes VALUES
  ('api:GET:config/settings', NULL, 'api_endpoint', 'GET config/settings', 'apps/spott-frontend/routes/api.v3.php', NULL, NULL),
  ('api:GET:contents/{param}/multiview', NULL, 'api_endpoint', 'GET multiview', 'apps/spott-frontend/routes/api.v3.php', NULL, NULL),
  ('api:GET:contents/{param}/multiview/metadata', NULL, 'api_endpoint', 'GET multiview metadata', 'apps/spott-frontend/routes/api.v3.php', NULL, NULL),
  ('api:POST:users/{param}/settings', NULL, 'api_endpoint', 'POST user settings', 'routes/api.php', NULL, NULL),
  ('api:DELETE:events/{param}', NULL, 'api_endpoint', 'DELETE event', 'routes/web.php', NULL, NULL),
  ('api:DELETE:events/{param}/archive', NULL, 'api_endpoint', 'DELETE event archive', 'routes/web.php', NULL, NULL),
  ('api:APIRESOURCE:/contents', NULL, 'api_endpoint', 'contents resource', 'routes/api.php', NULL, NULL),
  ('api:GET:internal/api/v1/reports', NULL, 'api_endpoint', 'GET internal reports', 'routes/api.php', NULL, NULL),
  ('api:POST:{param}/api/v3/contents/{param}/check-access', NULL, 'api_endpoint', 'k6 check', 'k6/helpers.js', NULL, NULL),
  ('api:GET:contents/helpers', NULL, 'api_endpoint', 'GET helpers', 'apps/spott-frontend/helpers.js', NULL, NULL);
`);

function topRoute(query: string): string | undefined {
    return searchNodes(db, query, { kind: "route" })[0]?.id;
}

assert.equal(topRoute("GET /api/v3/config/settings"), "api:GET:config/settings");
assert.equal(topRoute("api:GET:/api/v3/config/settings"), "api:GET:config/settings");

const multiviewTop = searchNodes(db, "GET /api/v3/contents/{contentId}/multiview", { kind: "route" });
assert.equal(multiviewTop[0]?.id, "api:GET:contents/{param}/multiview");
assert.ok(
    multiviewTop[0]!.score > (multiviewTop[1]?.score ?? 0),
    "full multiview path outranks metadata sibling",
);

assert.equal(
    topRoute("POST /api/v2/users/{userId}/settings"),
    "api:POST:users/{param}/settings",
);
assert.equal(
    topRoute("DELETE /api/v1/events/{eventId}"),
    "api:DELETE:events/{param}",
);
assert.equal(topRoute("api:DELETE:events/{param}"), "api:DELETE:events/{param}");

const contentsMatches = searchNodes(db, "GET /api/v1/contents", { kind: "route" });
assert.ok(
    !contentsMatches.some(match => match.file === "k6/helpers.js"),
    "GET contents does not rank k6 helper route",
);
assert.ok(
    contentsMatches.some(match => match.id === "api:APIRESOURCE:/contents"),
    "GET contents still finds production contents route",
);

assert.equal(
    topRoute("GET /internal/api/v1/reports"),
    "api:GET:internal/api/v1/reports",
);

const helpersMatch = searchNodes(db, "GET contents/helpers", { kind: "route" });
assert.equal(helpersMatch[0]?.file, "apps/spott-frontend/helpers.js");
assert.ok(!helpersMatch[0]?.matchReason.includes("test/k6"), "production helpers.js is not low-signal");

const deletePlan = buildRouteSearchPlan("DELETE /api/v1/events/{eventId}");
assert.ok(
    deletePlan.exactIds.includes("api:DELETE:events/{param}"),
    "delete plan includes canonical exact id",
);
assert.ok(
    !deletePlan.pathTerms.includes("delete"),
    "HTTP verb is not treated as path term",
);

db.close();
console.log("routeSearch integration tests passed");
