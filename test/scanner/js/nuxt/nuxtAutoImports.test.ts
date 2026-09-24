import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { resolveNuxtAutoImportCalls } from "../../../../src/scanner/js/nuxt/resolveNuxtAutoImports";
import type { GraphNode } from "../../../../src/graph/GraphTypes";

function addNode(id: string, file: string): void {
    graph.nodes.set(id, { id, type: "method", file } as GraphNode);
}

function addUnresolvedCall(callerFile: string, name: string): string {
    const from = `js:${callerFile}::setup`;
    addNode(from, callerFile);
    const edgeId = `${from}->js:${callerFile}::${name}:CALLS:${name}`;
    graph.edges.set(edgeId, { from, to: `js:${callerFile}::${name}`, type: "CALLS" });
    return from;
}

function callTargets(from: string): string[] {
    return [...graph.edges.values()].filter(edge => edge.from === from && edge.type === "CALLS").map(edge => edge.to);
}

resetGraph();

const files = [
    "nuxt/apps/shop/nuxt.config.ts",
    "nuxt/layers/content/nuxt.config.ts",
    "nuxt/layers/card/nuxt.config.ts",
    "nuxt/layers/card/composables/useCardButtons.ts",
    "nuxt/layers/card/composables/nested/useNestedHelper.ts",
    "nuxt/layers/content/composables/useLocale.ts",
    "nuxt/layers/card/composables/useLocale.ts",
    "legacy/resources/js/composables/useLegacy.ts",
];

addNode("js:nuxt/layers/card/composables/useCardButtons.ts::useCardButtons", "nuxt/layers/card/composables/useCardButtons.ts");
addNode("js:nuxt/layers/card/composables/nested/useNestedHelper.ts::useNestedHelper", "nuxt/layers/card/composables/nested/useNestedHelper.ts");
addNode("js:nuxt/layers/content/composables/useLocale.ts::useLocale", "nuxt/layers/content/composables/useLocale.ts");
addNode("js:nuxt/layers/card/composables/useLocale.ts::useLocale", "nuxt/layers/card/composables/useLocale.ts");
addNode("js:legacy/resources/js/composables/useLegacy.ts::useLegacy", "legacy/resources/js/composables/useLegacy.ts");

const layerCaller = addUnresolvedCall("nuxt/layers/content/components/Button.vue", "useCardButtons");
const ambiguousCaller = addUnresolvedCall("nuxt/apps/shop/components/Header.vue", "useLocale");
const nestedCaller = addUnresolvedCall("nuxt/apps/shop/components/Nested.vue", "useNestedHelper");
const legacyCaller = addUnresolvedCall("legacy/resources/js/components/Old.vue", "useLegacy");

const resolved = resolveNuxtAutoImportCalls(files);

assert.equal(resolved, 1);
assert.deepEqual(
    callTargets(layerCaller),
    ["js:nuxt/layers/card/composables/useCardButtons.ts::useCardButtons"],
    "an auto-imported composable defined once across layers is linked",
);
const linked = [...graph.edges.values()].find(edge => edge.from === layerCaller)!;
assert.equal(linked.confidence, 0.8);
assert.match(linked.reason ?? "", /Nuxt auto-import/);

assert.deepEqual(
    callTargets(ambiguousCaller),
    ["js:nuxt/apps/shop/components/Header.vue::useLocale"],
    "a name defined in two layers stays unresolved",
);
assert.deepEqual(
    callTargets(nestedCaller),
    ["js:nuxt/apps/shop/components/Nested.vue::useNestedHelper"],
    "nested composable files are not auto-imported by Nuxt",
);
assert.deepEqual(
    callTargets(legacyCaller),
    ["js:legacy/resources/js/components/Old.vue::useLegacy"],
    "callers outside a Nuxt app/layer are not auto-import resolved",
);

resetGraph();
console.log("nuxt auto-import tests passed");
