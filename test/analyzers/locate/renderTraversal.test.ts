import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { graph, resetGraph } from "../../../src/graph/graph";
import writeGraphSqlite from "../../../src/persistence/writeGraphSqlite";
import { buildLocate } from "../../../src/analyzers/locate/locate";
import { buildTrace } from "../../../src/analyzers/trace/trace";
import { findRenderedComponentFlows } from "../../../src/graph/queries/callChainQueries";
import type { GraphNode } from "../../../src/graph/GraphTypes";

function node(id: string, type: string, file: string): void {
    graph.nodes.set(id, { id, type, file, name: id.split("::").pop() } as GraphNode);
}

function sfc(file: string): string {
    const name = path.basename(file, ".vue");
    node(`js:${file}`, "js_module", file);
    node(`js:${file}::${name}`, "vue_component", file);
    return `js:${file}`;
}

function renders(parent: string, child: string, tag: string): void {
    const from = `${parent}::${path.basename(parent, ".vue")}`;
    graph.edges.set(`${from}->${child}:RENDERS_COMPONENT:${tag}`, { from, to: child, type: "RENDERS_COMPONENT", via: tag });
}

function calls(from: string, to: string): void {
    graph.edges.set(`${from}->${to}:CALLS`, { from, to, type: "CALLS" });
}

resetGraph();

const page = sfc("web/pages/Page.vue");
const layout = sfc("web/components/Layout.vue");
const wrapper = sfc("web/components/Wrapper.vue");
const button = sfc("web/ui/Button.vue");
const icon = sfc("web/ui/Icon.vue");
const heroLoader = sfc("web/components/HeroLoader.vue");
const exclusiveButton = sfc("web/components/ExclusiveButton.vue");

node("js:web/composables/usePageMeta.ts::usePageMeta", "method", "web/composables/usePageMeta.ts");
node("js:web/composables/useAccess.ts::useAccess", "method", "web/composables/useAccess.ts");
node("js:web/ui/useButtonVariants.ts::useButtonVariants", "method", "web/ui/useButtonVariants.ts");
node("http:GET:/api/access", "http_endpoint", "web/composables/useAccess.ts");
node("App\\Http\\AccessController::show", "method", "app/Http/AccessController.php");

calls(page, "js:web/composables/usePageMeta.ts::usePageMeta");
calls(exclusiveButton, "js:web/composables/useAccess.ts::useAccess");
calls(button, "js:web/ui/useButtonVariants.ts::useButtonVariants");
graph.edges.set("http", { from: "js:web/composables/useAccess.ts::useAccess", to: "http:GET:/api/access", type: "HTTP_REQUEST" });
graph.edges.set("route", { from: "http:GET:/api/access", to: "App\\Http\\AccessController::show", type: "ROUTES_TO" });

renders(page, layout, "Layout");
renders(layout, wrapper, "Wrapper");
renders(wrapper, button, "UiButton");
renders(button, icon, "UiIcon");
renders(wrapper, layout, "Layout");
renders(page, heroLoader, "HeroLoader");
renders(heroLoader, exclusiveButton, "ExclusiveButton");
renders(exclusiveButton, heroLoader, "HeroLoader");
for (let index = 0; index < 8; index++) {
    const other = sfc(`web/other/Other${index}.vue`);
    renders(other, button, "UiButton");
    renders(other, icon, "UiIcon");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ranger-renders-"));
const dbPath = path.join(dir, "graph.sqlite");
writeGraphSqlite(dbPath, {});
resetGraph();
const db = new Database(dbPath, { readonly: true });

try {
    const trace = buildTrace(db, page);
    assert.ok(trace.ok);
    assert.deepEqual(
        trace.data.renderedComponents.map(component => [component.path.map(hop => hop.via), component.calls.map(call => call.id)]),
        [[["HeroLoader", "ExclusiveButton"], ["js:web/composables/useAccess.ts::useAccess"]]],
        "trace follows RENDERS_COMPONENT to the child whose composable issues HTTP; markup-only and shared UI children are not reported",
    );
    assert.equal(trace.data.renderedComponents[0]!.http[0]?.controllerMethod, "App\\Http\\AccessController::show");
    assert.ok(trace.data.flowLines.some(line => line.includes("ExclusiveButton.vue [renders <ExclusiveButton>]")));
    assert.ok(trace.data.coverage.complete.includes("rendered components"));

    const locate = buildLocate(db, page);
    assert.ok(locate.ok);
    const files = locate.data.files.map(file => file.file);
    assert.ok(files.includes("web/composables/useAccess.ts"), "locate reaches the composable behind the rendered child");
    assert.ok(files.includes("web/components/ExclusiveButton.vue"), "the child carrying the HTTP flow is an inspect-first file");
    assert.ok(
        !files.some(file => file.startsWith("web/ui/") || file === "web/components/Layout.vue" || file === "web/components/Wrapper.vue"),
        "generic UI and markup-only wrappers do not take inspect-first slots",
    );
    assert.ok(locate.data.flow.some(line => line.includes("GET /api/access [HTTP] → AccessController::show")));
    assert.ok(!locate.data.flow.some(line => /→ (?:Button|Icon|Layout|Wrapper)\.vue/.test(line)));

    const cyclic = findRenderedComponentFlows(db, heroLoader, { maxDepth: 3 });
    assert.deepEqual(cyclic.map(component => component.id), [exclusiveButton], "render cycles are visited once");
    assert.deepEqual(findRenderedComponentFlows(db, layout, { maxDepth: 3 }), [], "a cycle through markup-only components terminates without results");

    const composable = buildLocate(db, "js:web/composables/useAccess.ts::useAccess");
    assert.ok(composable.ok);
    assert.ok(composable.data.flow.some(line => line.includes("AccessController::show")), "the composable's HTTP bridge is unchanged");
    assert.ok(!composable.data.flow.some(line => line.includes("[renders")), "non-component queries do not traverse renders");
    const composableTrace = buildTrace(db, "js:web/composables/useAccess.ts::useAccess");
    assert.ok(composableTrace.ok);
    assert.deepEqual(composableTrace.data.renderedComponents, []);
} finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log("render traversal tests passed");
