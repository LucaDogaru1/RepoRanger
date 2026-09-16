import assert from "node:assert/strict";
import { createPhpParser } from "../../../../src/scanner/php/parse/parser";
import { parsePhpSource } from "../../../../src/scanner/php/parse/fileParser";

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

testLargePhpSourceUsesChunkedInput();
console.log("PHP file parser tests passed");
