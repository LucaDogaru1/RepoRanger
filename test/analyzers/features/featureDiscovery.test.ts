import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
    discoverFeature,
    findSimilarFiles,
} from "../../../src/analyzers/features/featureDiscovery";
import {
    buildTaskContext,
    renderTaskContext,
} from "../../../src/analyzers/context/taskContext";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  parent TEXT,
  type TEXT NOT NULL,
  name TEXT,
  file TEXT,
  start_row INTEGER,
  end_row INTEGER,
  raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  call_type TEXT,
  via TEXT,
  confidence REAL,
  reason TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}'
);
`);

const insertNode = db.prepare("INSERT INTO nodes (id, parent, type, name, file, raw_json) VALUES (?, ?, ?, ?, ?, ?)");
const insertEdge = db.prepare("INSERT INTO edges (id, from_id, to_id, type, raw_json) VALUES (?, ?, ?, ?, '{}')");

insertNode.run(
    "project_scope:nuxt/packages/ui",
    null,
    "project_scope",
    "nuxt/packages/ui",
    null,
    JSON.stringify({
        id: "project_scope:nuxt/packages/ui",
        workspace: "nuxt/packages/ui",
        scopeDirectory: "nuxt/packages/ui",
        runtime: "nuxt",
        runtimeConfidence: 1,
        runtimeReasons: ["nuxt.config"],
    }),
);

const files = {
    callout: "nuxt/packages/ui/components/CalloutSection.vue",
    promotion: "nuxt/packages/ui/components/PromotionSection.vue",
    registry: "nuxt/packages/ui/config/moduleComponents.ts",
    story: "nuxt/packages/ui/stories/CalloutSection.stories.ts",
};
insertNode.run("callout-module", null, "js_module", files.callout, files.callout, "{}");
insertNode.run("callout-component", "callout-module", "vue_component", "CalloutSection", files.callout, "{}");
insertNode.run("callout-title", "callout-component", "vue_prop", "title", files.callout, "{}");
insertNode.run("promotion-module", null, "js_module", files.promotion, files.promotion, "{}");
insertNode.run("promotion-component", "promotion-module", "vue_component", "PromotionSection", files.promotion, "{}");
insertNode.run("promotion-title", "promotion-component", "vue_prop", "title", files.promotion, "{}");
insertNode.run("registry-module", null, "js_module", files.registry, files.registry, "{}");
insertNode.run("registry", "registry-module", "component_registry", "moduleComponents", files.registry, "{}");
insertNode.run("entry-callout", "registry", "registry_entry", "callout", files.registry, "{}");
insertNode.run("callout-story", null, "js_module", "CalloutSection.stories", files.story, "{}");
insertEdge.run("registry-callout", "entry-callout", "callout-module", "REGISTERED_AS");
insertEdge.run("story-callout", "callout-story", "callout-component", "RENDERS_COMPONENT");
insertEdge.run("registry-promotion", "registry", "promotion-module", "REGISTERED_AS");

const feature = discoverFeature(db, "CalloutSection", { runtime: "nuxt", maxFiles: 10 });
assert.equal(feature.files[0]?.file, files.callout);
assert.ok(feature.files.some(file => file.file === files.registry), "connected registry is included");
assert.ok(feature.files.some(file => file.file === files.story), "connected story is included");
assert.ok(feature.registries.some(file => file.file === files.registry));
assert.ok(feature.tests.some(file => file.file === files.story));

const similar = findSimilarFiles(db, files.callout, { runtime: "nuxt", maxFiles: 5 });
assert.ok(similar.some(file => file.file === files.promotion), "structurally similar component is found");

const context = buildTaskContext(db, "CalloutSection", { runtime: "nuxt", maxTokens: 300 });
const rendered = renderTaskContext(context);
assert.ok(rendered.includes(files.callout));
assert.ok(rendered.length <= 300 * 4, "rendered context respects approximate token budget");
assert.ok(context.estimatedTokens <= 300, "structured context respects approximate token budget");

db.close();
console.log("feature discovery tests passed");
