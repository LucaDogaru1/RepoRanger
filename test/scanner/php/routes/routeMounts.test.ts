import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { recordRoutes } from "../../../../src/scanner/php/routes/recordRoute";
import { extractRoutesFromSource } from "../../../../src/scanner/php/routes/routeFileExtractor";
import { collectRouteMountsFromSource } from "../../../../src/scanner/php/routes/routeMounts";

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`ok ${name}`);
    } catch (error) {
        console.error(`fail ${name}`);
        throw error;
    }
}

const PROVIDER = `
    protected function mapWebRoutes(): void
    {
        Route::middleware('web')
            ->group(base_path('routes/web.php'));
    }

    protected function mapApiRoutes(): void
    {
        Route::prefix('api')
            ->name('api.')
            ->middleware('api')
            ->group(base_path('routes/api.php'));
    }

    protected function mapApiV2Routes(): void
    {
        Route::prefix('api/v2')
            ->middleware('api')
            ->group(base_path('routes/api.v2.php'));
    }

    protected function mapApiV3Routes(): void
    {
        Route::middleware('api')
            ->prefix('api/v3')
            ->group(base_path('routes/api.v3.php'));
    }
`;

test("RouteServiceProvider mounts are keyed by app-relative route file", () => {
    const mounts = collectRouteMountsFromSource(PROVIDER, "apps/frontend/app/Providers/RouteServiceProvider.php");

    assert.equal(mounts.get("apps/frontend/routes/web.php"), "");
    assert.equal(mounts.get("apps/frontend/routes/api.php"), "/api");
    assert.equal(mounts.get("apps/frontend/routes/api.v2.php"), "/api/v2");
    assert.equal(mounts.get("apps/frontend/routes/api.v3.php"), "/api/v3");
});

test("Laravel 11 withRouting uses apiPrefix for the api route file", () => {
    const mounts = collectRouteMountsFromSource(`
        return Application::configure(basePath: dirname(__DIR__))
            ->withRouting(
                web: __DIR__.'/../routes/web.php',
                api: __DIR__.'/../routes/api.php',
                apiPrefix: 'api/admin',
            )->create();
    `, "bootstrap/app.php");

    assert.equal(mounts.get("routes/web.php"), "");
    assert.equal(mounts.get("routes/api.php"), "/api/admin");
});

test("same file-local path in v2 and v3 route files yields distinct endpoints", () => {
    resetGraph();
    const v2 = extractRoutesFromSource(`
        use App\\Http\\Controllers\\Api\\V2\\EventController;
        Route::resource('events', EventController::class)->only(['index']);
    `, "/api/v2");
    const v3 = extractRoutesFromSource(`
        use App\\Http\\Controllers\\Api\\V3\\Event\\BaseConfigEventController;
        Route::group(['prefix' => 'events'], function () {
            Route::get('/', [BaseConfigEventController::class, 'index']);
        });
    `, "/api/v3");
    recordRoutes(v2, "apps/frontend/routes/api.v2.php", "/api/v2");
    recordRoutes(v3, "apps/frontend/routes/api.v3.php", "/api/v3");

    const handlers = (endpointId: string) => [...graph.edges.values()]
        .filter(edge => edge.type === "ROUTES_TO" && edge.from === endpointId)
        .map(edge => edge.to);

    assert.deepEqual(handlers("api:GET:/api/v2/events"), ["App\\Http\\Controllers\\Api\\V2\\EventController::index"]);
    assert.deepEqual(handlers("api:GET:/api/v3/events"), ["App\\Http\\Controllers\\Api\\V3\\Event\\BaseConfigEventController::index"]);
    assert.equal(graph.nodes.get("api:GET:/api/v3/events")?.file, "apps/frontend/routes/api.v3.php");
    assert.equal(graph.nodes.get("api:GET:/api/v3/events")?.routeMount, "/api/v3");
    assert.equal(graph.nodes.has("api:GET:/events"), false);
    resetGraph();
});

test("endpoint file stays deterministic when two route files define the same URL", () => {
    resetGraph();
    const route = [{ method: "GET", path: "/api/media/{param}", controller: "X", action: "show" }];
    recordRoutes(route, "apps/frontend/routes/api.php", "/api");
    recordRoutes(route, "apps/backend/routes/api.php", "/api");
    assert.equal(graph.nodes.get("api:GET:/api/media/{param}")?.file, "apps/backend/routes/api.php");

    resetGraph();
    recordRoutes(route, "apps/backend/routes/api.php", "/api");
    recordRoutes(route, "apps/frontend/routes/api.php", "/api");
    assert.equal(graph.nodes.get("api:GET:/api/media/{param}")?.file, "apps/backend/routes/api.php");
    resetGraph();
});

console.log("route mount tests passed");
