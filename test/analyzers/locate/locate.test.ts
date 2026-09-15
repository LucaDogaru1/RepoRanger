import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildLocate, renderLocate } from "../../../src/analyzers/locate/locate";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    parent TEXT,
    type TEXT,
    name TEXT,
    file TEXT,
    start_row INTEGER,
    end_row INTEGER
);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('api:POST:api/payments', NULL, 'api_endpoint', 'api/payments', 'routes/api.php', 18, 18),
  ('App\\Http\\Controllers\\PaymentController', NULL, 'class', 'PaymentController', 'app/Http/Controllers/PaymentController.php', 10, 55),
  ('App\\Http\\Controllers\\PaymentController::store', 'App\\Http\\Controllers\\PaymentController', 'method', 'store', 'app/Http/Controllers/PaymentController.php', 20, 42),
  ('App\\Data\\PaymentRequestDto::fromRequest', 'App\\Data\\PaymentRequestDto', 'method', 'fromRequest', 'app/Data/PaymentRequestDto.php', 12, 27),
  ('App\\Services\\PaymentService::create', 'App\\Services\\PaymentService', 'method', 'create', 'app/Services/PaymentService.php', 31, 58),
  ('App\\Queries\\PaymentQueryFactory', NULL, 'class', 'PaymentQueryFactory', 'app/Queries/PaymentQueryFactory.php', 8, 35),
  ('App\\Queries\\PaymentQueryFactory::create', 'App\\Queries\\PaymentQueryFactory', 'method', 'create', 'app/Queries/PaymentQueryFactory.php', 18, 30),
  ('App\\Queries\\LegacyPaymentQuery', NULL, 'class', 'LegacyPaymentQuery', 'app/Queries/LegacyPaymentQuery.php', 10, 60),
  ('App\\Queries\\ModernPaymentQuery', NULL, 'class', 'ModernPaymentQuery', 'app/Queries/ModernPaymentQuery.php', 12, 65),
  ('App\\Queries\\CreatePaymentQuery::execute', 'App\\Queries\\CreatePaymentQuery', 'method', 'execute', 'app/Queries/CreatePaymentQuery.php', 15, 39),
  ('js:resources/js/pages/Checkout.vue::submit', 'js:resources/js/pages/Checkout.vue', 'method', 'submit', 'resources/js/pages/Checkout.vue', 48, 72),
  ('request_field:amount', NULL, 'request_field', 'amount', NULL, NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::store::$amount', 'App\\Http\\Controllers\\PaymentController::store', 'variable_field', '$amount', NULL, NULL, NULL),
  ('validation:payment:amount', NULL, 'validation', 'amount', NULL, NULL, NULL);

INSERT INTO edges VALUES
  ('js:resources/js/pages/Checkout.vue::submit', 'api:POST:api/payments', 'HTTP_REQUEST', NULL, '$fetch'),
  ('api:POST:api/payments', 'App\\Http\\Controllers\\PaymentController::store', 'ROUTES_TO', NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::store', 'App\\Data\\PaymentRequestDto::fromRequest', 'CALLS', 'STATIC', NULL),
  ('App\\Http\\Controllers\\PaymentController::store', 'App\\Services\\PaymentService::create', 'CALLS', 'INSTANCE', NULL),
  ('App\\Services\\PaymentService::create', 'App\\Queries\\PaymentQueryFactory::create', 'CALLS', 'INSTANCE', NULL),
  ('App\\Services\\PaymentService::create', 'App\\Queries\\CreatePaymentQuery::execute', 'CALLS', 'INSTANCE', NULL),
  ('App\\Queries\\PaymentQueryFactory', 'App\\Queries\\LegacyPaymentQuery', 'DEPENDS_ON', NULL, NULL),
  ('App\\Queries\\PaymentQueryFactory', 'App\\Queries\\ModernPaymentQuery', 'DEPENDS_ON', NULL, NULL),
  ('request_field:amount', 'App\\Http\\Controllers\\PaymentController::store::$amount', 'ASSIGNS', NULL, '$request'),
  ('App\\Http\\Controllers\\PaymentController::store', 'validation:payment:amount', 'VALIDATES', NULL, NULL);
`);

const laravel = buildLocate(db, "POST /api/payments", {
    kind: "route",
    depth: 3,
    limit: 12,
    maxFiles: 99,
});
assert.equal(laravel.ok, true, "Laravel route can be located");
if (!laravel.ok) throw new Error(laravel.error);

assert.equal(laravel.data.match.id, "api:POST:api/payments");
assert.equal(laravel.data.resolvesTo, "App\\Http\\Controllers\\PaymentController::store");
assert.equal(laravel.data.entry?.location, "routes/api.php:18");
assert.ok(laravel.data.flow.some(line => line.includes("PaymentController::store")), "flow includes controller");
assert.ok(laravel.data.flow.some(line => line.includes("CreatePaymentQuery::execute")), "flow includes query");
assert.ok(laravel.data.files.length <= 5, "locate never returns more than five files");
assert.equal(laravel.data.files[0]?.file, "app/Http/Controllers/PaymentController.php");
assert.ok(
    laravel.data.files.some(file => file.file === "app/Queries/CreatePaymentQuery.php"),
    "prioritized files include the downstream query",
);

const vue = buildLocate(db, "js:resources/js/pages/Checkout.vue::submit", { depth: 3 });
assert.equal(vue.ok, true, "Vue method can be located");
if (!vue.ok) throw new Error(vue.error);

assert.equal(vue.data.httpBridge?.endpointId, "api:POST:api/payments", "Vue HTTP call bridges to Laravel route");
assert.equal(vue.data.files[0]?.file, "resources/js/pages/Checkout.vue", "matched Vue file stays first");
assert.ok(vue.data.flow.some(line => line.includes("[HTTP]")), "cross-stack flow marks HTTP boundary");
assert.ok(vue.data.flow.some(line => line.includes("PaymentController::store")), "cross-stack flow reaches controller");
assert.ok(
    vue.data.files.some(file => file.file === "app/Queries/LegacyPaymentQuery.php"),
    "cross-stack locate reaches and ranks concrete factory dependencies",
);

const output = renderLocate(vue.data);
assert.ok(output.split(/\s+/).length < 600, "compact output remains below the token-oriented ceiling");
assert.ok(!output.includes("Suggested next"), "compact output does not create follow-up command churn");
assert.match(output, /Checkout\.vue:48-72/, "output includes actionable source lines");

const field = buildLocate(db, "amount", { kind: "field" });
assert.equal(field.ok, true, "request field can be located");
if (!field.ok) throw new Error(field.error);
assert.equal(field.data.match.id, "request_field:amount");
assert.equal(field.data.files[0]?.file, "app/Http/Controllers/PaymentController.php");
assert.ok(field.data.flow.some(line => line.includes("[ASSIGNS]")), "field flow is shown compactly");

const missing = buildLocate(db, "DefinitelyMissingSymbol");
assert.deepEqual(missing, { ok: false, error: "No nodes found for: DefinitelyMissingSymbol" });

db.close();
console.log("locate tests passed");
