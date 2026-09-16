import assert from "node:assert/strict";
import {
    buildRouteEndpointIdentity,
    buildRouteEndpointId,
    buildRouteSearchPlan,
    isLowSignalRouteFile,
    isProductionRouteFile,
    parseRouteTicketQuery,
    inferRouteFilePrefix,
    routePathsStructurallyEqual,
    stripApiPathPrefix,
    suggestRouteFollowUpQueries,
} from "../../../src/graph/queries/routeSearchVariants";

assert.equal(stripApiPathPrefix("/api/v3/config/settings"), "config/settings");
assert.equal(stripApiPathPrefix("api/v3/contents/{contentId}/multiview"), "contents/{param}/multiview");
assert.equal(stripApiPathPrefix("/api/v12/contents/{contentId}"), "contents/{param}");

const multiview = parseRouteTicketQuery("GET /api/v3/contents/{contentId}/multiview");
assert.equal(multiview.verb, "GET");
assert.equal(multiview.path, "contents/{param}/multiview");
assert.equal(
    buildRouteEndpointId("GET", multiview.path),
    "api:GET:contents/{param}/multiview",
);

const apiForm = parseRouteTicketQuery("api:GET:/api/v3/config/settings");
assert.equal(apiForm.verb, "GET");
assert.equal(apiForm.path, "config/settings");

const plan = buildRouteSearchPlan("GET /api/v3/config/settings");
assert.ok(
    plan.exactIds.includes("api:GET:config/settings"),
    "full ticket path resolves to graph route id",
);
assert.ok(
    !plan.pathTerms.includes("api"),
    "route plan excludes api stop segment",
);
assert.ok(
    !plan.pathTerms.includes("get"),
    "route plan excludes HTTP verb stop segment",
);
assert.equal(plan.normalizedPath, "config/settings");
assert.equal(plan.requestedPath, "api/v3/config/settings");
assert.ok(plan.fullPathPatterns.length > 0);
assert.ok(plan.segmentPatterns.length > 0);

const suggestions = suggestRouteFollowUpQueries("GET /api/v3/contents/{contentId}/multiview");
assert.ok(suggestions.includes("multiview"), "suggests path suffix");
assert.ok(suggestions.includes("contents/{param}/multiview"), "suggests normalized path");

assert.equal(isLowSignalRouteFile("apps/spott-frontend/k6/helpers.js"), true);
assert.equal(isLowSignalRouteFile("apps/spott-frontend/helpers.js"), false);
assert.equal(isProductionRouteFile("apps/spott-frontend/routes/api.v3.php"), true);
assert.equal(isProductionRouteFile("routes/web.php"), true);

const identity = buildRouteEndpointIdentity("PATCH /api/v3/contents/{contentId}");
assert.equal(identity.requestedPath, "api/v3/contents/{param}");
assert.equal(identity.frameworkPath, "contents/{param}");
assert.equal(inferRouteFilePrefix("routes/api.php"), "api");
assert.equal(inferRouteFilePrefix("app/routes/api.v3.php"), "api/v3");
assert.equal(inferRouteFilePrefix("app/routes/web.php"), null);
assert.equal(routePathsStructurallyEqual("contents/{id}", "contents/{param}"), true);
assert.equal(
    routePathsStructurallyEqual("baseConfigEventContents/{param}", "contents/{param}"),
    false,
    "static route segments never match by substring",
);

console.log("routeSearchVariants tests passed");
