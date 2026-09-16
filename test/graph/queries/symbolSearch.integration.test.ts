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
  ('SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController::index', 'SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController', 'method', 'index', 'apps/spott-frontend/app/Http/Controllers/Api/V3/Content/RelatedContentController.php', NULL, NULL),
  ('js:apps/spott-frontend/composition/module/useModule.ts', NULL, 'js_module', 'apps/spott-frontend/composition/module/useModule.ts', 'apps/spott-frontend/composition/module/useModule.ts', NULL, NULL),
  ('js:apps/spott-frontend/services/api-v3/composables/useModule.js', NULL, 'js_module', 'apps/spott-frontend/services/api-v3/composables/useModule.js', 'apps/spott-frontend/services/api-v3/composables/useModule.js', NULL, NULL),
  ('js:apps/spott-frontend/v3/types/moduleTemplates.ts', NULL, 'js_module', 'apps/spott-frontend/v3/types/moduleTemplates.ts', 'apps/spott-frontend/v3/types/moduleTemplates.ts', NULL, NULL);
`);

const insertNoise = db.prepare(`
    INSERT INTO nodes (id, parent, type, name, file, start_row, end_row)
    VALUES (?, NULL, 'model_field', 'module', 'app/Noise.php', NULL, NULL)
`);
const addNoise = db.transaction(() => {
    for (let index = 0; index < 350; index += 1) {
        insertNoise.run(`model_field:Noise${index}:module`);
    }
});
addNoise();

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

const useModuleMatches = searchNodes(db, "useModule", { kind: "all", limit: 5 });
assert.ok(
    useModuleMatches.slice(0, 2).every(match =>
        match.type === "js_module" && /\/useModule\.(?:ts|js)$/.test(match.file ?? "")
    ),
    "exact useModule filenames outrank generic module token matches",
);
assert.ok(
    useModuleMatches[0]?.matchReason.includes("exact file stem"),
    "exact file stem explains the top useModule match",
);

assert.equal(
    searchNodes(db, "moduleTemplates", { kind: "all", limit: 1 })[0]?.file,
    "apps/spott-frontend/v3/types/moduleTemplates.ts",
    "exact camelCase filename outranks generic module routes and fields",
);

assert.equal(
    searchNodes(db, "module templates", { kind: "all", limit: 1 })[0]?.file,
    "apps/spott-frontend/v3/types/moduleTemplates.ts",
    "whole camelCase variant outranks individual query tokens",
);

db.close();
console.log("symbolSearch integration tests passed");
