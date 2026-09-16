import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { linkCrossLanguageEndpoints } from "../../../../src/scanner/js/linking/crossLanguageEndpoints";

resetGraph();

graph.nodes.set("api:GET:/contents/{param}", {
    id: "api:GET:/contents/{param}",
    type: "api_endpoint",
    name: "GET /contents/{contentId}",
    file: "apps/api/routes/api.v12.php",
});
graph.nodes.set("http:GET:/api/v12/contents/{param}", {
    id: "http:GET:/api/v12/contents/{param}",
    type: "http_endpoint",
    name: "GET /api/v12/contents/{contentId}",
    file: "apps/web/composables/useContent.ts",
});
graph.edges.set("route", {
    from: "api:GET:/contents/{param}",
    to: "App\\Http\\Controllers\\ContentController::show",
    type: "ROUTES_TO",
});
graph.edges.set("request", {
    from: "js:apps/web/composables/useContent.ts::load",
    to: "http:GET:/api/v12/contents/{param}",
    type: "HTTP_REQUEST",
});

const stats = linkCrossLanguageEndpoints();

assert.equal(stats.backendLinked, 1);
assert.ok(graph.nodes.has("api:GET:/contents/{param}"), "backend route identity is preserved");
assert.ok(graph.nodes.has("http:GET:/api/v12/contents/{param}"), "HTTP request identity is preserved");
assert.equal(graph.nodes.get("api:GET:/contents/{param}")?.file, "apps/api/routes/api.v12.php");
assert.equal(graph.nodes.get("http:GET:/api/v12/contents/{param}")?.file, "apps/web/composables/useContent.ts");
assert.ok(
    [...graph.edges.values()].some(edge =>
        edge.type === "RESOLVES_TO"
        && edge.from === "http:GET:/api/v12/contents/{param}"
        && edge.to === "api:GET:/contents/{param}"
    ),
    "client endpoint resolves to, but is not merged with, the backend route",
);

resetGraph();
console.log("cross-language endpoint identity tests passed");
