import { graph, resetGraph } from "../../../../src/graph/graph";
import { resolveOverrideCalls } from "../../../../src/scanner/php/resolvers/resolveOverrideCalls";

resetGraph();

graph.nodes.set("App\\Cms\\Element", {
    id: "App\\Cms\\Element",
    type: "class",
    name: "Element",
});
graph.nodes.set("App\\Cms\\Element::onSave", {
    id: "App\\Cms\\Element::onSave",
    parent: "App\\Cms\\Element",
    type: "method",
    name: "onSave",
});
graph.nodes.set("App\\Cms\\Element\\DVV\\DvvInstagramElement", {
    id: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    type: "class",
    name: "DvvInstagramElement",
});
graph.nodes.set("App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave", {
    id: "App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave",
    parent: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    type: "method",
    name: "onSave",
});
graph.nodes.set("App\\Http\\Services\\PageElementService::saveConfig", {
    id: "App\\Http\\Services\\PageElementService::saveConfig",
    parent: "App\\Http\\Services\\PageElementService",
    type: "method",
    name: "saveConfig",
});
graph.nodes.set("Tests\\TestCase", {
    id: "Tests\\TestCase",
    type: "class",
    name: "TestCase",
});
graph.nodes.set("Tests\\TestCase::setUp", {
    id: "Tests\\TestCase::setUp",
    parent: "Tests\\TestCase",
    type: "method",
    name: "setUp",
});
graph.nodes.set("Tests\\Feature\\FirstTest", {
    id: "Tests\\Feature\\FirstTest",
    type: "class",
    name: "FirstTest",
});
graph.nodes.set("Tests\\Feature\\FirstTest::setUp", {
    id: "Tests\\Feature\\FirstTest::setUp",
    parent: "Tests\\Feature\\FirstTest",
    type: "method",
    name: "setUp",
});
graph.nodes.set("Tests\\Feature\\SiblingTest", {
    id: "Tests\\Feature\\SiblingTest",
    type: "class",
    name: "SiblingTest",
});
graph.nodes.set("Tests\\Feature\\SiblingTest::setUp", {
    id: "Tests\\Feature\\SiblingTest::setUp",
    parent: "Tests\\Feature\\SiblingTest",
    type: "method",
    name: "setUp",
});

graph.edges.set("extends", {
    from: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    to: "App\\Cms\\Element",
    type: "EXTENDS",
});
graph.edges.set("call", {
    from: "App\\Http\\Services\\PageElementService::saveConfig",
    to: "App\\Cms\\Element::onSave",
    type: "CALLS",
});
graph.edges.set("first-test-extends", {
    from: "Tests\\Feature\\FirstTest",
    to: "Tests\\TestCase",
    type: "EXTENDS",
});
graph.edges.set("sibling-test-extends", {
    from: "Tests\\Feature\\SiblingTest",
    to: "Tests\\TestCase",
    type: "EXTENDS",
});
graph.edges.set("parent-setup-call", {
    from: "Tests\\Feature\\FirstTest::setUp",
    to: "Tests\\TestCase::setUp",
    type: "CALLS",
    callType: "STATIC",
});

resolveOverrideCalls();

const resolvedEdge = [...graph.edges.values()].find(
    edge =>
        edge.type === "CALLS" &&
        edge.callType === "OVERRIDE_RESOLVED" &&
        edge.to === "App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave"
);

if (!resolvedEdge) {
    throw new Error("expected OVERRIDE_RESOLVED call to subclass onSave");
}

const impossibleSiblingDispatch = [...graph.edges.values()].find(
    edge =>
        edge.type === "CALLS" &&
        edge.callType === "OVERRIDE_RESOLVED" &&
        edge.from === "Tests\\Feature\\FirstTest::setUp" &&
        edge.to === "Tests\\Feature\\SiblingTest::setUp"
);

if (impossibleSiblingDispatch) {
    throw new Error("parent::setUp() must not dispatch to a sibling test override");
}

console.log("resolveOverrideCalls test passed");
