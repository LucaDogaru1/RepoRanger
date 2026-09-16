import assert from "node:assert/strict";
import { createJsParser } from "../../../src/scanner/js/parse/parser";
import { createTsParser } from "../../../src/scanner/js/ts/parser";
import { parseTreeSitterSource } from "../../../src/shared/parsing/parseTreeSitterSource";

function largeStatements(typeAnnotation = ""): string {
    return Array.from(
        { length: 1_500 },
        (_, index) => `export const value${index}${typeAnnotation} = 'value-${index}';`,
    ).join("\n");
}

function testLargeJavaScriptSource(): void {
    const source = `${largeStatements()}\nexport const label = 'support 👋';\n`;
    assert.ok(source.length > 32 * 1024);

    const tree = parseTreeSitterSource(createJsParser(), source);

    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.endIndex, source.length);
    assert.match(tree.rootNode.text, /support 👋/);
}

function testLargeTypeScriptSource(): void {
    const source = `${largeStatements(": string")}\nexport interface Callout { title: string }\n`;
    assert.ok(source.length > 32 * 1024);

    const tree = parseTreeSitterSource(createTsParser(), source);

    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.endIndex, source.length);
    assert.match(tree.rootNode.text, /interface Callout/);
}

testLargeJavaScriptSource();
testLargeTypeScriptSource();
console.log("tree-sitter source parser tests passed");
