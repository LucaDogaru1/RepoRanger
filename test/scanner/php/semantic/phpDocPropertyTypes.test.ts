import assert from "node:assert/strict";
import { createPhpParser } from "../../../../src/scanner/php/parse/parser";
import { resetGraph, graph } from "../../../../src/graph/graph";
import walk from "../../../../src/scanner/php/walk/phpWalker";
import { createWalkContext } from "../../../../src/scanner/php/astHandlers/testWalkContext";

function testHydratedAreasSubscriptCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Cms;

class Area {
    public function addElement(mixed $element): void {}
}

class PageBuilder {
    /** @var Area[] */
    private array $hydratedAreas;

    private function fillOwnAreas(): void {
        $area = $this->hydratedAreas['main'] ?? null;

        if ($area) {
            $area->addElement(null);
        }
    }
}`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    walk(tree.rootNode, "app/Cms/PageBuilder.php", createWalkContext());

    const callEdge = graph.edges.get(
        "App\\Cms\\PageBuilder::fillOwnAreas->App\\Cms\\Area::addElement"
    );

    assert.ok(callEdge, "expected CALLS edge to App\\Cms\\Area::addElement");
    assert.equal(callEdge?.type, "CALLS");
}

function run(): void {
    console.log("phpDocPropertyTypes tests\n");

    testHydratedAreasSubscriptCall();
    console.log("  ✓ hydratedAreas subscript infers Area::addElement call");

    console.log("\nAll phpDocPropertyTypes tests passed.");
}

run();
