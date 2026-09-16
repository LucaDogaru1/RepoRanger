import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchNodes } from "../../../src/graph/queries/searchNodes";
import { gatherNavigationContext } from "../../../src/analyzers/navigation/gatherNavigationContext";
import { findNode } from "../../../src/graph/queries/GraphQueries";
import {
    filterFieldFlowEdges,
    findRouteScopedGraphEntries,
    shortNavigationLabel,
} from "../../../src/graph/queries/navigationQueries";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('App\\Http\\Controllers\\PaymentController', NULL, 'class', 'PaymentController', 'PaymentController.php', 1, 20),
  ('App\\Http\\Controllers\\PaymentController::pay', 'App\\Http\\Controllers\\PaymentController', 'method', 'pay', 'PaymentController.php', 1, 10),
  ('SpOTT\\Page\\ModuleTypeOptionCasts\\ParagraphSection\\ParagraphSectionSettings', NULL, 'class', 'ParagraphSectionSettings', 'packages/spott-common/src/Page/ModuleTypeOptionCasts/ParagraphSection/ParagraphSectionSettings.php', 1, 40),
  ('apps/spott-backend/resources/assets/js/views/pagemanager/module/options/VerticalPromotionElement.vue', NULL, 'vue_component', 'VerticalPromotionElement', 'apps/spott-backend/resources/assets/js/views/pagemanager/module/options/VerticalPromotionElement.vue', 1, 80),
  ('api:POST:api/payments', NULL, 'api_endpoint', 'api/payments', 'routes/api.php', NULL, NULL),
  ('http:POST:/api/payments', NULL, 'http_endpoint', 'POST /api/payments', 'resources/js/checkout.ts', NULL, NULL),
  ('js:resources/js/checkout.ts::submit', NULL, 'method', 'submit', 'resources/js/checkout.ts', 1, 10),
  ('api:GET:/checkout/pay', NULL, 'api_endpoint', '/checkout/pay', 'routes/api.php', NULL, NULL),
  ('api:GET:config/settings', NULL, 'api_endpoint', 'config/settings', 'routes/api.v3.php', NULL, NULL),
  ('api:POST:{param}/api/v3/contents/{param}/check-access', NULL, 'api_endpoint', 'k6 check', 'k6/helpers.js', NULL, NULL),
  ('resources/views/payments/form.blade.php', NULL, 'blade_view', 'form', 'form.blade.php', NULL, NULL),
  ('request_field:amount', NULL, 'request_field', 'amount', NULL, NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::pay::$data.amount', NULL, 'variable_field', '$data.amount', NULL, NULL, NULL);

INSERT INTO edges VALUES
  ('api:POST:api/payments', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('http:POST:/api/payments', 'api:POST:api/payments', 'RESOLVES_TO', NULL, NULL),
  ('js:resources/js/checkout.ts::submit', 'http:POST:/api/payments', 'HTTP_REQUEST', NULL, '$fetch'),
  ('api:GET:/checkout/pay', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('resources/views/payments/form.blade.php', 'App\\Http\\Controllers\\PaymentController::pay', 'BLADE_USES_ACTION', NULL, NULL),
  ('request_field:amount', 'App\\Http\\Controllers\\PaymentController::pay::$data.amount', 'ASSIGNS', NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::pay', 'validation:App\\Http\\Controllers\\PaymentController::pay:amount', 'VALIDATES', NULL, NULL);
`);

const symbolMatches = searchNodes(db, "PaymentController");
assert.ok(symbolMatches.some(match => match.id.includes("PaymentController::pay")), "find symbol by class name");

const routeMatches = searchNodes(db, "POST api/payments", { kind: "route" });
assert.ok(routeMatches.some(match => match.id === "api:POST:api/payments"), "find route endpoint");

const settingsRouteMatches = searchNodes(db, "GET /api/v3/config/settings", { kind: "route" });
assert.ok(
    settingsRouteMatches[0]?.id === "api:GET:config/settings",
    "full ticket path prefers exact settings route",
);
assert.ok(
    !settingsRouteMatches.some(match => match.file === "k6/helpers.js"),
    "full ticket path does not surface k6 helper routes",
);

const contentsRouteMatches = searchNodes(db, "GET /api/v3/contents", { kind: "route" });
assert.ok(
    !contentsRouteMatches.some(match => match.file === "k6/helpers.js"),
    "contents path query demotes k6 helper routes below threshold",
);

const fieldMatches = searchNodes(db, "amount", { kind: "field" });
assert.ok(fieldMatches.some(match => match.id === "request_field:amount"), "find request field");

const paragraphMatches = searchNodes(db, "paragraph-section");
assert.ok(
    paragraphMatches.some(match => match.id.includes("ParagraphSectionSettings")),
    "kebab slug finds PascalCase settings class",
);

const promotionMatches = searchNodes(db, "Promotion Element");
assert.ok(
    promotionMatches.some(match => match.id.includes("VerticalPromotionElement")),
    "spaced label finds promotion element component",
);

assert.ok(
    paragraphMatches[0]?.id.includes("ParagraphSection"),
    "best paragraph-section match prefers ParagraphSection symbol",
);

const deduped = filterFieldFlowEdges([
    { type: "FLOWS_TO", from: "request_field:amount", to: "App\\Services\\PaymentService::process", via: "$data" },
    { type: "ARGUMENT_TO", from: "request_field:amount", to: "App\\Services\\PaymentService::process::$dto", via: "$data" },
]);
assert.equal(deduped.length, 1, "ARGUMENT_TO suppresses matching FLOWS_TO");
assert.equal(deduped[0]?.type, "ARGUMENT_TO");

const payTarget = findNode(db, "App\\Http\\Controllers\\PaymentController::pay")!;
const payNavigation = gatherNavigationContext(db, payTarget, { callees: [] });
assert.equal(payNavigation.routeEntries.length, 2, "navigation includes all route entries for pay");

const controllerTarget = findNode(db, "App\\Http\\Controllers\\PaymentController")!;
const controllerNavigation = gatherNavigationContext(db, controllerTarget, { callees: [] });
assert.equal(controllerNavigation.routeEntries.length, 2, "class navigation includes routes from class-level lookup");
assert.equal(payNavigation.bladeEntries.length, 1, "navigation includes blade entry");
assert.equal(payNavigation.graphEntries.length, 3, "graph entries include routes and blade");
assert.ok(payNavigation.fieldAssignments.length >= 1, "navigation includes field assignments");
assert.ok(payNavigation.validates.length >= 1, "navigation includes validation edges");

const routeTarget = findNode(db, "api:POST:api/payments")!;
const routeNavigation = gatherNavigationContext(db, routeTarget, { callees: [] });
assert.equal(routeNavigation.routeEntries.length, 1, "route target includes self route entry");
assert.equal(routeNavigation.routeEntries[0]?.endpointId, "api:POST:api/payments");
assert.equal(routeNavigation.bladeEntries.length, 0, "route target does not pull blade from sibling entries");
assert.ok(
    !routeNavigation.graphEntries.some(entry => entry.kind === "route" && entry.from === "api:GET:/checkout/pay"),
    "route-scoped graph entries exclude other routes to the same controller",
);
assert.ok(
    routeNavigation.httpUpstream.some(entry => entry.componentId === "js:resources/js/checkout.ts::submit"),
    "route navigation follows HTTP_REQUEST through RESOLVES_TO",
);

const httpTarget = findNode(db, "http:POST:/api/payments")!;
assert.equal(shortNavigationLabel(httpTarget.id), "POST /api/payments");
const httpNavigation = gatherNavigationContext(db, httpTarget, { callees: [] });
assert.equal(httpNavigation.routeEntries[0]?.endpointId, "api:POST:api/payments");
assert.equal(
    httpNavigation.routeEntries[0]?.controllerMethod,
    "App\\Http\\Controllers\\PaymentController::pay",
    "HTTP endpoint navigation resolves to its backend controller without merging identities",
);

const scopedEntries = findRouteScopedGraphEntries(
    db,
    "api:POST:api/payments",
    "App\\Http\\Controllers\\PaymentController::pay",
);
assert.ok(
    !scopedEntries.some(entry => entry.from === "api:GET:/checkout/pay"),
    "findRouteScopedGraphEntries excludes sibling routes",
);

db.close();
console.log("navigation tests passed");
