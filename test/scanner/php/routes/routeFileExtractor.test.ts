import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { recordRoutes } from "../../../../src/scanner/php/routes/recordRoute";
import { extractRoutesFromSource } from "../../../../src/scanner/php/routes/routeFileExtractor";

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`ok ${name}`);
    } catch (error) {
        console.error(`fail ${name}`);
        throw error;
    }
}

function routeActions(routes: ReturnType<typeof extractRoutesFromSource>): Map<string, string> {
    return new Map(routes.map(route => [`${route.method} ${route.path}`, route.action]));
}

test("invokable controller routes use __invoke action", () => {
    const routes = extractRoutesFromSource(`
        use SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\Multiview\\MultiviewController;

        Route::get('{content}/multiview', MultiviewController::class);
    `);

    assert.equal(routes.length, 1);
    assert.equal(routes[0]!.action, "__invoke");
    assert.equal(routes[0]!.method, "GET");
    assert.match(routes[0]!.path, /multiview$/);
});

test("apiResource collection GET uses index action", () => {
    const routes = extractRoutesFromSource(`
        use SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Content\\RelatedContentController;

        Route::apiResource('{content}/related-contents', RelatedContentController::class)
            ->only('index');
    `);

    assert.equal(routes.length, 1);
    assert.equal(routes[0]!.action, "index");
    assert.equal(routes[0]!.method, "GET");
    assert.match(routes[0]!.path, /related-contents$/);
});

test("explicit controller action array is preserved", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\FooController;

        Route::get('items', [FooController::class, 'list']);
    `);

    assert.equal(routes.length, 1);
    assert.equal(routes[0]!.action, "list");
});

test("apiResource maps all REST verbs to correct actions", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::apiResource('posts', PostController::class);
    `);

    const actions = routeActions(routes);

    assert.equal(routes.length, 6);
    assert.equal(actions.get("GET /posts"), "index");
    assert.equal(actions.get("POST /posts"), "store");
    assert.equal(actions.get("GET /posts/{param}"), "show");
    assert.equal(actions.get("PUT /posts/{param}"), "update");
    assert.equal(actions.get("PATCH /posts/{param}"), "update");
    assert.equal(actions.get("DELETE /posts/{param}"), "destroy");
});

test("nested apiResource names expand to Laravel nested paths", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\ModuleContentController;

        Route::apiResource('modules.contents', ModuleContentController::class)
            ->only(['index', 'show']);
    `);

    const actions = routeActions(routes);
    assert.equal(actions.get("GET /modules/{param}/contents"), "index");
    assert.equal(actions.get("GET /modules/{param}/contents/{param}"), "show");
});

test("resource includes browser create and edit routes", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::resource('posts', PostController::class);
    `);

    const actions = routeActions(routes);

    assert.equal(routes.length, 8);
    assert.equal(actions.get("GET /posts"), "index");
    assert.equal(actions.get("GET /posts/create"), "create");
    assert.equal(actions.get("POST /posts"), "store");
    assert.equal(actions.get("GET /posts/{param}"), "show");
    assert.equal(actions.get("GET /posts/{param}/edit"), "edit");
    assert.equal(actions.get("PUT /posts/{param}"), "update");
    assert.equal(actions.get("PATCH /posts/{param}"), "update");
    assert.equal(actions.get("DELETE /posts/{param}"), "destroy");
});

test("resource only can select create and edit", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::resource('posts', PostController::class)->only(['create', 'edit']);
    `);

    const actions = routeActions(routes);
    assert.equal(routes.length, 2);
    assert.equal(actions.get("GET /posts/create"), "create");
    assert.equal(actions.get("GET /posts/{param}/edit"), "edit");
});

test("apiResource ->only array keeps selected actions", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::apiResource('posts', PostController::class)->only(['index', 'show', 'destroy']);
    `);

    const actions = new Set(routes.map(route => route.action));

    assert.deepEqual(actions, new Set(["index", "show", "destroy"]));
    assert.equal(routes.length, 3);
});

test("apiResource ->except array removes actions", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::apiResource('posts', PostController::class)->except(['store', 'update', 'destroy']);
    `);

    const actions = new Set(routes.map(route => route.action));

    assert.deepEqual(actions, new Set(["index", "show"]));
    assert.equal(routes.length, 2);
});

test("apiResource ->only string keeps single action", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::apiResource('posts', PostController::class)->only('store');
    `);

    assert.equal(routes.length, 1);
    assert.equal(routes[0]!.action, "store");
    assert.equal(routes[0]!.method, "POST");
});

test("apiResource ->except string removes single action", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::apiResource('posts', PostController::class)->except('show');
    `);

    const actions = new Set(routes.map(route => route.action));

    assert.equal(actions.has("show"), false);
    assert.equal(routes.length, 5);
});

test("nested fluent groups compose prefixes and middleware", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;
        use App\\Http\\Middleware\\EnsureTenant;

        Route::middleware(['auth:sanctum', EnsureTenant::class])
            ->prefix('api')
            ->group(function () {
                Route::prefix('v1')->middleware('verified')->group(function () {
                    Route::get('posts', [PostController::class, 'index']);
                    Route::resource('posts', PostController::class)
                        ->middleware('can:manage-posts')
                        ->only(['create', 'edit']);
                });
            });

        Route::get('health', PostController::class)->middleware('throttle:health');
    `);

    const index = routes.find(route => route.action === "index");
    assert.equal(index?.path, "api/v1/posts");
    assert.deepEqual(index?.middleware, [
        "auth:sanctum",
        "App\\Http\\Middleware\\EnsureTenant",
        "verified",
    ]);

    const create = routes.find(route => route.action === "create");
    assert.equal(create?.path, "api/v1/posts/create");
    assert.deepEqual(create?.middleware, [
        "auth:sanctum",
        "App\\Http\\Middleware\\EnsureTenant",
        "verified",
        "can:manage-posts",
    ]);

    const health = routes.find(route => route.path === "/health");
    assert.deepEqual(health?.middleware, ["throttle:health"]);
});

test("legacy group arrays apply prefix and middleware without leaking to siblings", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\AdminController;

        Route::group([
            'prefix' => 'admin',
            'middleware' => ['web', 'auth'],
        ], function () {
            Route::post('reports', [AdminController::class, 'store']);
        });

        Route::post('reports', [AdminController::class, 'publicStore']);
    `);

    const grouped = routes.find(route => route.action === "store");
    const sibling = routes.find(route => route.action === "publicStore");
    assert.equal(grouped?.path, "admin/reports");
    assert.deepEqual(grouped?.middleware, ["web", "auth"]);
    assert.equal(sibling?.path, "/reports");
    assert.deepEqual(sibling?.middleware, []);
});

test("recordRoutes persists middleware nodes and edges", () => {
    resetGraph();
    recordRoutes([
        {
            method: "GET",
            path: "/admin/reports",
            controller: "App\\Http\\Controllers\\AdminController",
            action: "index",
            middleware: ["auth", "verified"],
        },
    ], "routes/web.php");

    assert.equal(graph.nodes.get("middleware:auth")?.type, "middleware");
    assert.equal(graph.nodes.get("middleware:auth")?.file, "routes/web.php");
    assert.ok(
        [...graph.edges.values()].some(edge =>
            edge.type === "USES_MIDDLEWARE" && edge.to === "middleware:verified"
        ),
        "middleware edge is recorded"
    );
    resetGraph();
});
