import assert from "node:assert/strict";
import { createPhpParser } from "../../../../src/scanner/php/parse/parser";
import { resetGraph, graph } from "../../../../src/graph/graph";
import walk from "../../../../src/scanner/php/walk/phpWalker";
import { createWalkContext } from "../../../../src/scanner/php/astHandlers/testWalkContext";

function walkSource(file: string, source: string): void {
    walk(createPhpParser().parse(source).rootNode, file, createWalkContext());
}

resetGraph();

walkSource("tests/Foundation/Middleware/TransactionNamingTest.php", `<?php
namespace Tests\\Foundation;
use Tests\\Fixtures\\UsersController;
class TransactionNamingTest {
    public function setUp(): void {
        Route::get('users', [UsersController::class, 'index']);
    }
}`);

walkSource("app/Providers/RouteServiceProvider.php", `<?php
namespace App\\Providers;
use App\\Models\\Media;
use App\\Http\\Controllers\\PlayerController;
class RouteServiceProvider {
    public function boot(): void {
        Route::model('medium', Media::class);
        Route::post('/player-version', [PlayerController::class, 'store']);
    }
}`);

const endpoints = [...graph.nodes.values()].filter(node => node.type === "api_endpoint");

assert.equal(graph.nodes.has("api:GET:/users"), false, "routes registered inside tests are not application endpoints");
assert.equal(
    endpoints.some(node => node.id.startsWith("api:MODEL:")),
    false,
    "Route::model() is a route-model binding, not an endpoint",
);
assert.equal(
    graph.nodes.get("api:POST:/player-version")?.file,
    "app/Providers/RouteServiceProvider.php",
    "routes registered outside route files keep their defining file",
);

resetGraph();
console.log("walk-time route tests passed");
