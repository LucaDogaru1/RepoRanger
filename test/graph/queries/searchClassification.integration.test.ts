import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchNodes } from "../../../src/graph/queries/searchNodes";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    parent TEXT,
    type TEXT,
    name TEXT,
    file TEXT,
    start_row INTEGER,
    end_row INTEGER,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO nodes (id, parent, type, name, file, start_row, end_row, raw_json) VALUES
  ('project_scope:apps/legacy', NULL, 'project_scope', 'apps/legacy', NULL, NULL, NULL,
   '{"id":"project_scope:apps/legacy","workspace":"apps/legacy","scopeDirectory":"apps/legacy","runtime":"legacy-vue","runtimeConfidence":0.98,"runtimeReasons":["Vue 2 package"]}'),
  ('project_scope:apps/nuxt', NULL, 'project_scope', 'apps/nuxt', NULL, NULL, NULL,
   '{"id":"project_scope:apps/nuxt","workspace":"apps/nuxt","scopeDirectory":"apps/nuxt","runtime":"nuxt","runtimeConfidence":1,"runtimeReasons":["nuxt.config"]}'),
  ('js:apps/legacy/src/composables/useFeature.ts', NULL, 'js_module', 'apps/legacy/src/composables/useFeature.ts', 'apps/legacy/src/composables/useFeature.ts', NULL, NULL, '{}'),
  ('js:apps/legacy/src/composables/useFeature.ts::useFeature', 'js:apps/legacy/src/composables/useFeature.ts', 'method', 'useFeature', 'apps/legacy/src/composables/useFeature.ts', 1, 4, '{}'),
  ('js:apps/nuxt/composables/useFeature.ts', NULL, 'js_module', 'apps/nuxt/composables/useFeature.ts', 'apps/nuxt/composables/useFeature.ts', NULL, NULL, '{}'),
  ('js:apps/nuxt/composables/useFeature.ts::useFeature', 'js:apps/nuxt/composables/useFeature.ts', 'method', 'useFeature', 'apps/nuxt/composables/useFeature.ts', 1, 4, '{}');
`);

const ungrouped = searchNodes(db, "useFeature", { kind: "all", limit: 20 });
assert.equal(ungrouped.length, 4, "library search keeps individual nodes unless dedupe is requested");

const grouped = searchNodes(db, "useFeature", {
    kind: "all",
    limit: 20,
    dedupeByFile: true,
});
assert.equal(grouped.length, 2, "file dedupe returns one logical result per source file");
assert.ok(grouped.every(match => match.groupedNodeCount === 2));
assert.ok(grouped.every(match => match.groupedNodeTypes?.includes("js_module")));
assert.ok(grouped.every(match => match.groupedNodeTypes?.includes("method")));

const nuxtOnly = searchNodes(db, "useFeature", {
    kind: "all",
    runtime: "nuxt",
    dedupeByFile: true,
});
assert.equal(nuxtOnly.length, 1);
assert.equal(nuxtOnly[0]?.workspace, "apps/nuxt");
assert.equal(nuxtOnly[0]?.runtime, "nuxt");
assert.equal(nuxtOnly[0]?.runtimeConfidence, 1);

const legacyOnly = searchNodes(db, "useFeature", {
    kind: "all",
    workspace: "legacy",
    dedupeByFile: true,
});
assert.equal(legacyOnly.length, 1);
assert.equal(legacyOnly[0]?.runtime, "legacy-vue");

db.close();
console.log("search classification integration tests passed");
