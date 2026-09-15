import assert from "node:assert/strict";
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

test("resource maps REST verbs like apiResource (create/edit not expanded)", () => {
    const routes = extractRoutesFromSource(`
        use App\\Http\\Controllers\\PostController;

        Route::resource('posts', PostController::class);
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
