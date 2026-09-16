import assert from "node:assert/strict";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { createTsParser } from "../../../../src/scanner/js/ts/parser";
import walk, { createWalkContext } from "../../../../src/scanner/js/walk/jsWalker";
import { parseTreeSitterSource } from "../../../../src/shared/parsing/parseTreeSitterSource";
import { processVueTemplate } from "../../../../src/scanner/js/astHandlers/vueTemplate";

resetGraph();
const file = "packages/ui/components/ModuleRenderer.ts";
const source = `
import PromotionModule from './PromotionModule.vue';
import ContactModule from './ContactModule.vue';
const moduleComponents = {
  promotion: PromotionModule,
  contact: ContactModule,
  callout: defineAsyncComponent(() => import('./CalloutSection.vue')),
};
`;
const context = createWalkContext(file);
walk(parseTreeSitterSource(createTsParser(), source).rootNode, file, context);

const registryId = `${context.moduleId}@registry:moduleComponents`;
assert.equal(graph.nodes.get(registryId)?.type, "component_registry");
assert.equal(graph.nodes.get(`${registryId}@entry:callout`)?.type, "registry_entry");
assert.ok([...graph.edges.values()].some(edge =>
    edge.type === "REGISTERED_AS"
    && edge.via === "callout"
    && edge.to.endsWith("/CalloutSection.vue")
));

const componentId = `${context.moduleId}::ModuleRenderer`;
processVueTemplate(
    `<PromotionModule /><component :is="moduleComponents[type]" /><component :is="'ContactModule'" />`,
    componentId,
    context,
);
assert.ok([...graph.edges.values()].some(edge =>
    edge.from === componentId && edge.type === "RENDERS_COMPONENT" && edge.via === "PromotionModule"
));
assert.ok([...graph.edges.values()].some(edge =>
    edge.type === "RESOLVES_VIA_REGISTRY" && edge.to === registryId
));
assert.ok([...graph.edges.values()].some(edge =>
    edge.type === "RENDERS_COMPONENT" && edge.via === "ContactModule"
));

console.log("component registry tests passed");
