import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createJsParser } from "../../../../src/scanner/js/parse/parser";
import { createTsParser } from "../../../../src/scanner/js/ts/parser";
import { parseVueScript } from "../../../../src/scanner/js/vue/parseVueScript";
import { processVueFile } from "../../../../src/scanner/js/vue/processVueFile";
import { resetGraph } from "../../../../src/graph/graph";

const nuxtRoot = path.resolve(__dirname, "../../../../../../spott/nuxt");
const snackBarVue = path.join(
    nuxtRoot,
    "packages/ui-design/components/SnackBar.vue"
);

function testParseVueScriptUsesTypeScriptParserForScriptSetup(): void {
    if (!fs.existsSync(snackBarVue)) {
        console.log("  ↷ Skipping SnackBar.vue fixture — spott/nuxt not found locally");
        return;
    }

    const source = fs.readFileSync(snackBarVue, "utf8");
    const scriptMatch = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch?.[1], "expected script block in SnackBar.vue");

    const parsed = parseVueScript(
        scriptMatch[1]!.trim(),
        "ts",
        createJsParser(),
        createTsParser()
    );

    assert.equal(parsed.usedTsParser, true);
    assert.equal(parsed.tree.rootNode.hasError, false);
}

function testParseLargeVueTypeScriptBlock(): void {
    const rawScript = Array.from(
        { length: 1_500 },
        (_, index) => `const value${index}: string = 'value-${index}';`,
    ).join("\n");
    assert.ok(rawScript.length > 32 * 1024);

    const parsed = parseVueScript(
        rawScript,
        "ts",
        createJsParser(),
        createTsParser()
    );

    assert.equal(parsed.usedTsParser, true);
    assert.equal(parsed.tree.rootNode.hasError, false);
    assert.equal(parsed.tree.rootNode.endIndex, rawScript.length);
}

function testProcessVueFileWalksSnackBar(): void {
    if (!fs.existsSync(snackBarVue)) {
        return;
    }

    resetGraph();

    const result = processVueFile(
        {
            absolutePath: snackBarVue,
            relativePath: "packages/ui-design/components/SnackBar.vue",
        },
        {
            jsParser: createJsParser(),
            tsParser: createTsParser(),
        }
    );

    assert.equal(result.usedTsParser, true);
    assert.equal(result.parseError, false);
}

function run(): void {
    console.log("processVueFile tests\n");

    testParseVueScriptUsesTypeScriptParserForScriptSetup();
    console.log("  ✓ parseVueScript uses TS parser for script setup");

    testParseLargeVueTypeScriptBlock();
    console.log("  ✓ parses Vue script blocks larger than 32 KiB");

    testProcessVueFileWalksSnackBar();
    console.log("  ✓ processVueFile walks SnackBar.vue");

    console.log("\nAll processVueFile tests passed.");
}

run();
