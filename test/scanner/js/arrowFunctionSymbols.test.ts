import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../src/graph/graph";
import { createTsParser } from "../../../src/scanner/js/ts/parser";
import walk, { createWalkContext } from "../../../src/scanner/js/walk/jsWalker";

function walkTs(file: string, source: string): void {
    walk(createTsParser().parse(source).rootNode, file, createWalkContext(file));
}

resetGraph();

walkTs("app/composables/useContactForm.ts", `
import { submit } from "../api/submit"
export const useContactForm = () => {
  const onSend = () => submit()
  return { onSend }
}
const helper = async function () { return submit() }
export const a = () => 1, b = () => 2
`);

walkTs("app/components/Form.ts", `
import { useContactForm } from "../composables/useContactForm.ts"
export function setup() { useContactForm() }
`);

const composableId = "js:app/composables/useContactForm.ts::useContactForm";
assert.equal(graph.nodes.get(composableId)?.type, "composable", "exported arrow-function composables become symbols");
assert.ok(graph.nodes.has("js:app/composables/useContactForm.ts::helper"), "top-level function expressions become symbols");
assert.equal(graph.nodes.has("js:app/composables/useContactForm.ts::onSend"), false, "nested arrow functions stay part of their enclosing function");
assert.equal(graph.nodes.has("js:app/composables/useContactForm.ts::a"), false, "multi-declarator statements are left alone");

const calls = [...graph.edges.values()].filter(edge => edge.type === "CALLS");
assert.ok(
    calls.some(edge => edge.from === composableId && edge.to === "js:app/api/submit.js::submit"),
    "calls inside the arrow body are attributed to the composable",
);
assert.ok(
    calls.some(edge => edge.from === "js:app/components/Form.ts::setup" && edge.to === composableId),
    "imports of an arrow-function composable resolve to its symbol",
);

resetGraph();
console.log("arrow function symbol tests passed");
