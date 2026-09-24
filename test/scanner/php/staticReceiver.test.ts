import assert from "node:assert/strict";
import { createPhpParser } from "../../../src/scanner/php/parse/parser";
import { resetGraph, graph } from "../../../src/graph/graph";
import walk from "../../../src/scanner/php/walk/phpWalker";
import { createWalkContext } from "../../../src/scanner/php/astHandlers/testWalkContext";

const files: Array<[string, string]> = [
    ["src/QueryBuilder/Concerns/InstantiatesQuery.php", `<?php
namespace App\\QueryBuilder\\Concerns;
trait InstantiatesQuery {
    public static function for($request): static { return new static($request); }
}`],
    ["src/QueryBuilder/Query.php", `<?php
namespace App\\QueryBuilder;
use App\\QueryBuilder\\Concerns\\InstantiatesQuery;
abstract class Query {
    use InstantiatesQuery;
}`],
    ["src/QueryBuilder/Page/PageQuery.php", `<?php
namespace App\\QueryBuilder\\Page;
use App\\QueryBuilder\\Query;
class PageQuery extends Query {
    public static function own(): void {}
}`],
    ["app/Http/Controllers/PageController.php", `<?php
namespace App\\Http\\Controllers;
use App\\QueryBuilder\\Page\\PageQuery;
class PageController {
    public function show($request) {
        PageQuery::for($request);
        PageQuery::own();
    }
}`],
];

function walkAll(): void {
    for (const [file, source] of files) {
        walk(createPhpParser().parse(source).rootNode, file, createWalkContext());
    }
}

resetGraph();
walkAll();
walkAll();

const staticCalls = [...graph.edges.values()].filter(edge =>
    edge.type === "CALLS" && edge.from === "App\\Http\\Controllers\\PageController::show");

const inherited = staticCalls.find(edge => edge.to === "App\\QueryBuilder\\Concerns\\InstantiatesQuery::for");
assert.ok(inherited, "static call resolves to the defining trait method");
assert.equal(inherited!.via, "App\\QueryBuilder\\Page\\PageQuery", "the receiver class is preserved");

const own = staticCalls.find(edge => edge.to === "App\\QueryBuilder\\Page\\PageQuery::own");
assert.ok(own);
assert.equal(own!.via, undefined, "no receiver annotation when the receiver defines the method");

resetGraph();
files.push(["src/QueryBuilder/Event/EventQuery.php", `<?php
namespace App\\QueryBuilder\\Event;
use App\\QueryBuilder\\Query;
class EventQuery extends Query {}`]);
files[3] = ["app/Http/Controllers/PageController.php", `<?php
namespace App\\Http\\Controllers;
use App\\QueryBuilder\\Page\\PageQuery;
use App\\QueryBuilder\\Event\\EventQuery;
class PageController {
    public function show($request) {
        PageQuery::for($request);
        EventQuery::for($request);
    }
}`];
walkAll();
walkAll();

const mixed = graph.edges.get(
    "App\\Http\\Controllers\\PageController::show->App\\QueryBuilder\\Concerns\\InstantiatesQuery::for");
assert.ok(mixed);
assert.equal(mixed!.via, undefined, "two different receivers in one method are not collapsed onto one of them");

resetGraph();
console.log("static receiver tests passed");
