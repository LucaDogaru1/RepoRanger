import assert from "node:assert/strict";
import { createPhpParser } from "../../../../src/scanner/php/parse/parser";
import { parsePhpSource } from "../../../../src/scanner/php/parse/fileParser";
import { resetGraph, graph } from "../../../../src/graph/graph";
import walk from "../../../../src/scanner/php/walk/phpWalker";
import { createWalkContext } from "../../../../src/scanner/php/astHandlers/testWalkContext";

function testLargePhpSourceUsesChunkedInput(): void {
    const constants = Array.from(
        { length: 1_200 },
        (_, index) => `    const string VALUE_${index} = 'value-${index}';`,
    ).join("\n");
    const source = `<?php
class LargeModuleService
{
${constants}

    public function label(): string
    {
        return 'support 👋';
    }
}
`;

    assert.ok(source.length > 32 * 1024, "fixture must exceed tree-sitter's default buffer");

    const tree = parsePhpSource(createPhpParser(), source);

    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.endIndex, source.length);
    assert.match(tree.rootNode.text, /class LargeModuleService/);
    assert.match(tree.rootNode.text, /support 👋/);
}

function testPhpEnumGrammarFallbackAndGraph(): void {
    const source = `<?php
namespace App\\Domain;

enum DeliveryType: string
{
    private const int INTERNAL_ID = 1;

    case SUPPORT = 'support';

    public function enabled(object $settings): bool
    {
        return (bool) match ($this) {
            self::SUPPORT => $settings->support_enabled,
        };
    }
}
`;

    const tree = parsePhpSource(createPhpParser(), source);

    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.endIndex, source.length);

    resetGraph();
    walk(tree.rootNode, "app/Domain/DeliveryType.php", createWalkContext());

    assert.ok(graph.nodes.has("App\\Domain\\DeliveryType"));
    assert.equal(graph.nodes.get("App\\Domain\\DeliveryType")?.type, "enum");
    assert.ok(graph.nodes.has("App\\Domain\\DeliveryType::enabled"));
}

testLargePhpSourceUsesChunkedInput();
testPhpEnumGrammarFallbackAndGraph();
console.log("PHP file parser tests passed");
