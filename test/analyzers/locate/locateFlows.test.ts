import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { graph, resetGraph } from "../../../src/graph/graph";
import writeGraphSqlite from "../../../src/persistence/writeGraphSqlite";
import { buildLocate } from "../../../src/analyzers/locate/locate";
import type { GraphNode } from "../../../src/graph/GraphTypes";

function node(id: string, type: string, file: string, extra: Partial<GraphNode> = {}): void {
    graph.nodes.set(id, { id, type, file, name: id.split("::").pop(), ...extra } as GraphNode);
}

resetGraph();

node("api:GET:/api/v3/pages/{param}", "api_endpoint", "routes/api.v3.php");
node("App\\Http\\PageController::show", "method", "app/Http/PageController.php", { startRow: 10, endRow: 20 } as never);
node("App\\Query\\Concerns\\InstantiatesQuery::for", "method", "src/Query/Concerns/InstantiatesQuery.php");
node("App\\Query\\Page\\PageQuery", "class", "src/Query/Page/PageQuery.php");
graph.edges.set("route", { from: "api:GET:/api/v3/pages/{param}", to: "App\\Http\\PageController::show", type: "ROUTES_TO" });
graph.edges.set("for", {
    from: "App\\Http\\PageController::show",
    to: "App\\Query\\Concerns\\InstantiatesQuery::for",
    type: "CALLS",
    callType: "STATIC",
    via: "App\\Query\\Page\\PageQuery",
});

node("js:web/components/ExclusiveButton.vue", "js_module", "web/components/ExclusiveButton.vue");
node("js:web/components/ExclusiveButton.vue::ExclusiveButton", "vue_component", "web/components/ExclusiveButton.vue");
node("js:web/composables/useButtons.ts::useButtons", "method", "web/composables/useButtons.ts");
graph.edges.set("vue-call", {
    from: "js:web/components/ExclusiveButton.vue",
    to: "js:web/composables/useButtons.ts::useButtons",
    type: "CALLS",
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ranger-locate-"));
const dbPath = path.join(dir, "graph.sqlite");
writeGraphSqlite(dbPath, {});
resetGraph();
const db = new Database(dbPath, { readonly: true });

try {
    const page = buildLocate(db, "GET /api/v3/pages/{page}", { kind: "route" });
    assert.ok(page.ok);
    const pageFiles = page.data.files.map(file => file.file);
    assert.ok(
        pageFiles.includes("src/Query/Page/PageQuery.php"),
        "the class a static call is made on is listed, not only the trait that defines the method",
    );
    assert.ok(
        pageFiles.indexOf("src/Query/Page/PageQuery.php") < pageFiles.indexOf("src/Query/Concerns/InstantiatesQuery.php"),
        "the receiver ranks above the generic trait",
    );

    const component = buildLocate(db, "ExclusiveButton");
    assert.ok(component.ok);
    assert.ok(
        component.data.files.some(file => file.file === "web/composables/useButtons.ts"),
        "a Vue component query follows the calls made by its script block",
    );
    assert.equal(component.data.match.id, "js:web/components/ExclusiveButton.vue");
    assert.ok(
        !component.data.warnings.some(warning => warning.startsWith("Ambiguous match")),
        "the SFC's component node and module node are one candidate",
    );
} finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log("locate flow tests passed");
