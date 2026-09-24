import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import {
    endpointPathsMatch,
    linkCrossLanguageEndpoints,
} from "../../../../src/scanner/js/linking/crossLanguageEndpoints";

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`ok ${name}`);
    } catch (error) {
        console.error(`fail ${name}`);
        throw error;
    }
}

function addRoute(id: string, controller: string, routeMount?: string): void {
    graph.nodes.set(id, { id, type: "api_endpoint", name: id, file: "routes/api.php", routeMount });
    graph.edges.set(`${id}->route`, { from: id, to: controller, type: "ROUTES_TO" });
}

function addClient(id: string): void {
    graph.nodes.set(id, { id, type: "http_endpoint", name: id, file: "composables/useX.ts" });
}

function resolvesTo(clientId: string): string[] {
    return [...graph.edges.values()]
        .filter(edge => edge.type === "RESOLVES_TO" && edge.from === clientId)
        .map(edge => edge.to)
        .sort();
}

test("explicit API version never links to a route of another version", () => {
    resetGraph();
    addRoute("api:GET:/api/v3/events", "V3\\EventController::index", "/api/v3");
    addClient("http:GET:/api/v2/events");
    linkCrossLanguageEndpoints();

    assert.deepEqual(resolvesTo("http:GET:/api/v2/events"), []);
    resetGraph();
});

test("query strings are ignored when matching", () => {
    assert.equal(
        endpointPathsMatch("/api/v3/config/settings?filter[deviceCategory]=1", "/api/v3/config/settings", "/api/v3").confidence,
        1,
    );
});

test("baseURL-relative client paths resolve only under the /api mount", () => {
    assert.equal(endpointPathsMatch("v3/personalization", "/api/v3/personalization", "/api/v3").matches, true);
    assert.equal(endpointPathsMatch("/clients/{param}", "/api/clients/{param}", "/api").matches, true);
    assert.equal(endpointPathsMatch("/events", "/api/v3/events", "/api/v3").matches, false);
});

test("conventional prefix fallback applies only to routes with unknown mount", () => {
    assert.equal(endpointPathsMatch("/api/v3/cleeng/user", "/cleeng/user", undefined).matches, true);
    assert.equal(endpointPathsMatch("/api/v2/cleeng/user", "api/v3/cleeng/user", undefined).matches, false);
    assert.equal(endpointPathsMatch("/api/v2/events", "/events", "").matches, false);
});

test("equally good candidates are linked with reduced confidence", () => {
    resetGraph();
    addRoute("api:GET:/users", "Backend\\UserController::index");
    addRoute("api:GET:/users/", "Frontend\\UsersController::info");
    addClient("http:GET:/api/users");
    linkCrossLanguageEndpoints();

    const edges = [...graph.edges.values()].filter(edge => edge.type === "RESOLVES_TO");
    assert.equal(edges.length, 2);
    assert.ok(edges.every(edge => (edge.confidence ?? 1) <= 0.5 && /ambiguous/.test(edge.reason ?? "")));
    resetGraph();
});

console.log("cross-language route mount tests passed");
