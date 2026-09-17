import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { pruneUnresolvedJsCalls } from "../../../../src/scanner/js/resolvers/pruneUnresolvedCalls";

resetGraph();

graph.nodes.set("js:app.ts::run", {
    id: "js:app.ts::run",
    type: "method",
    name: "run",
});
graph.nodes.set("js:service.ts::load", {
    id: "js:service.ts::load",
    type: "method",
    name: "load",
});

graph.edges.set("internal", {
    from: "js:app.ts::run",
    to: "js:service.ts::load",
    type: "CALLS",
});
graph.edges.set("external", {
    from: "js:app.ts::run",
    to: "js:vue.js::computed",
    type: "CALLS",
});
graph.edges.set("http", {
    from: "js:app.ts::run",
    to: "http:GET:/api/items",
    type: "HTTP_REQUEST",
});

assert.equal(pruneUnresolvedJsCalls(), 1);
assert.equal(graph.edges.has("internal"), true);
assert.equal(graph.edges.has("external"), false);
assert.equal(graph.edges.has("http"), true);

console.log("pruneUnresolvedJsCalls tests passed");
