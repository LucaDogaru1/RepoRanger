import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { findOutgoingCallChain } from "../../../src/graph/queries/callChainQueries";
import {
    findInterfaceMethodImplementations,
    resolveInterfaceMethodImplementation,
} from "../../../src/graph/queries/navigationQueries";
import { routeVerbFromId } from "../../../src/graph/queries/searchNodes";

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`ok ${name}`);
    } catch (error) {
        console.error(`fail ${name}`);
        throw error;
    }
}

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('App\\Access\\CheckAccessService::checkAccess', NULL, 'method', 'checkAccess', 'app/Access/CheckAccessService.php', 1, 10),
  ('App\\Access\\HandlerInterface', NULL, 'interface', 'HandlerInterface', 'app/Access/HandlerInterface.php', 1, 10),
  ('App\\Access\\HandlerInterface::checkAccess', NULL, 'method', 'checkAccess', 'app/Access/HandlerInterface.php', 2, 3),
  ('App\\Access\\Handlers\\AzureHandler::checkAccess', NULL, 'method', 'checkAccess', 'app/Access/Handlers/AzureHandler.php', 1, 10),
  ('App\\Access\\Handlers\\AzureHandler::azureOnly', NULL, 'method', 'azureOnly', 'app/Access/Handlers/AzureHandler.php', 11, 20),
  ('App\\Access\\Handlers\\CleengHandler::checkAccess', NULL, 'method', 'checkAccess', 'app/Access/Handlers/CleengHandler.php', 1, 10),
  ('App\\Access\\FactoryInterface', NULL, 'interface', 'FactoryInterface', 'app/Access/FactoryInterface.php', 1, 10),
  ('App\\Access\\FactoryInterface::make', NULL, 'method', 'make', 'app/Access/FactoryInterface.php', 2, 3),
  ('App\\Access\\Factory::make', NULL, 'method', 'make', 'app/Access/Factory.php', 1, 10),
  ('Tests\\Unit\\Access\\FactoryMock::make', NULL, 'method', 'make', 'tests/Unit/Access/FactoryMock.php', 1, 10);

INSERT INTO edges VALUES
  ('App\\Access\\Handlers\\AzureHandler', 'App\\Access\\HandlerInterface', 'IMPLEMENTS', NULL, NULL),
  ('App\\Access\\Handlers\\CleengHandler', 'App\\Access\\HandlerInterface', 'IMPLEMENTS', NULL, NULL),
  ('App\\Access\\Factory', 'App\\Access\\FactoryInterface', 'IMPLEMENTS', NULL, NULL),
  ('Tests\\Unit\\Access\\FactoryMock', 'App\\Access\\FactoryInterface', 'IMPLEMENTS', NULL, NULL),
  ('App\\Access\\CheckAccessService::checkAccess', 'App\\Access\\HandlerInterface::checkAccess', 'CALLS', NULL, NULL),
  ('App\\Access\\CheckAccessService::checkAccess', 'App\\Access\\FactoryInterface::make', 'CALLS', NULL, NULL),
  ('App\\Access\\Handlers\\AzureHandler::checkAccess', 'App\\Access\\Handlers\\AzureHandler::azureOnly', 'CALLS', NULL, NULL);
`);

test("runtime-selected interface implementation is not guessed", () => {
    assert.equal(resolveInterfaceMethodImplementation(db, "App\\Access\\HandlerInterface::checkAccess"), null);
    assert.equal(findInterfaceMethodImplementations(db, "App\\Access\\HandlerInterface::checkAccess").length, 2);
});

test("call chain stops at an ambiguous dispatch instead of following one implementation", () => {
    const { calls } = findOutgoingCallChain(db, "App\\Access\\CheckAccessService::checkAccess", { depth: 3, limit: 10 });
    const ids = calls.map(call => call.id);

    assert.ok(ids.includes("App\\Access\\HandlerInterface::checkAccess"));
    assert.ok(!ids.includes("App\\Access\\Handlers\\AzureHandler::azureOnly"), "must not descend into an arbitrary implementation");
});

test("test doubles do not make a unique production implementation ambiguous", () => {
    assert.equal(resolveInterfaceMethodImplementation(db, "App\\Access\\FactoryInterface::make"), "App\\Access\\Factory::make");
});

test("HTTP verb is read correctly from client and route endpoint ids", () => {
    assert.equal(routeVerbFromId("http:GET:/api/v3/contents/{param}"), "GET");
    assert.equal(routeVerbFromId("api:POST:/api/v3/contents"), "POST");
    assert.equal(routeVerbFromId("js:foo.ts::bar"), null);
});

console.log("interface dispatch tests passed");
