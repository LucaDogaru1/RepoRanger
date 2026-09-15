import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchNodes } from "../../../src/graph/queries/searchNodes";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);

INSERT INTO nodes VALUES
  ('App\\Http\\Controllers\\Controller', NULL, 'class', 'Controller', 'app/Http/Controllers/Controller.php', NULL, NULL),
  ('SpOTTFrontend\\Http\\Controllers\\Controller', NULL, 'class', 'Controller', 'apps/spott-frontend/app/Http/Controllers/Controller.php', NULL, NULL),
  ('SpOTTFrontend\\Http\\Controllers\\Api\\V2\\Content\\RelatedContentController', NULL, 'class', 'RelatedContentController', 'apps/spott-frontend/app/Http/Controllers/Api/V2/Content/RelatedContentController.php', NULL, NULL),
  ('SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController', NULL, 'class', 'RelatedContentController', 'apps/spott-frontend/app/Http/Controllers/Api/V3/Content/RelatedContentController.php', NULL, NULL),
  ('SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\Multiview\\MultiviewController', NULL, 'class', 'MultiviewController', 'apps/spott-frontend/app/Http/Controllers/Api/V3/Content/Multiview/MultiviewController.php', NULL, NULL),
  ('SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController::index', 'SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController', 'method', 'index', 'apps/spott-frontend/app/Http/Controllers/Api/V3/Content/RelatedContentController.php', NULL, NULL);
`);

function topSymbol(query: string): string | undefined {
    return searchNodes(db, query, { kind: "symbol", limit: 5 })[0]?.id;
}

assert.equal(
    topSymbol("RelatedContentController"),
    "SpOTTFrontend\\Http\\Controllers\\Api\\V2\\Content\\RelatedContentController",
    "PascalCase controller name outranks generic Controller",
);
assert.ok(
    searchNodes(db, "RelatedContentController", { limit: 5 })[0]?.id.includes("RelatedContentController"),
    "auto find ranks RelatedContentController first",
);
assert.equal(
    topSymbol("MultiviewController"),
    "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\Multiview\\MultiviewController",
);
assert.equal(
    searchNodes(db, "RelatedContentController::index", { limit: 3 })[0]?.id,
    "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController::index",
);

db.close();
console.log("symbolSearch integration tests passed");
