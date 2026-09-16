import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import {
    extractVueTemplateMetadata,
    templateKeywords,
    VuePropBinding,
} from "../resolvers/templateExtractor";
import { JsWalkContext } from "../walk/context";

function resolveChildComponentId(
    tagName: string,
    context: JsWalkContext
): string {
    const importTarget = context.imports.get(tagName);
    if (importTarget) {
        return `${importTarget}::${tagName}`;
    }
    return `${context.moduleId}::${tagName}`;
}

function recordPropBindingEdge(
    fromComponentId: string,
    binding: VuePropBinding,
    context: JsWalkContext
): void {
    const toComponentId = resolveChildComponentId(binding.tag, context);
    const edgeId = `${fromComponentId}->${toComponentId}:PASSES_PROP:${binding.prop}`;

    graph.edges.set(edgeId, {
        from: fromComponentId,
        to: toComponentId,
        type: "PASSES_PROP",
        via: `${binding.expression}->${binding.prop}`,
        reason: `Template binds :${binding.prop}="${binding.expression}" on <${binding.tag}>`,
        confidence: 0.85,
    });
}

function recordRenderedComponents(
    componentId: string,
    metadata: ReturnType<typeof extractVueTemplateMetadata>,
    context: JsWalkContext,
): void {
    for (const tag of metadata.tags) {
        const importTarget = context.imports.get(tag);
        if (!importTarget) {
            continue;
        }
        graph.edges.set(`${componentId}->${importTarget}:RENDERS_COMPONENT:${tag}`, {
            from: componentId,
            to: importTarget,
            type: "RENDERS_COMPONENT",
            via: tag,
            confidence: 0.98,
            reason: `Template renders imported <${tag}> component`,
        });
    }

    for (const [index, binding] of metadata.dynamicComponents.entries()) {
        const dynamicId = `${componentId}@dynamic:${index}:${binding.expression}`;
        graph.nodes.set(dynamicId, {
            id: dynamicId,
            parent: componentId,
            type: "dynamic_component",
            name: binding.staticTarget ?? binding.registry ?? binding.expression,
            file: context.file,
            keywords: ["dynamic-component", binding.expression],
            description: `Vue <component :is> binding: ${binding.expression}`,
        });
        graph.edges.set(`${componentId}->${dynamicId}:RENDERS_DYNAMIC`, {
            from: componentId,
            to: dynamicId,
            type: "RENDERS_DYNAMIC",
            via: binding.expression,
            confidence: 0.98,
        });

        if (binding.staticTarget) {
            const target = context.imports.get(binding.staticTarget);
            if (target) {
                graph.edges.set(`${dynamicId}->${target}:RENDERS_COMPONENT`, {
                    from: dynamicId,
                    to: target,
                    type: "RENDERS_COMPONENT",
                    via: binding.staticTarget,
                    confidence: 0.95,
                    reason: "Static component name in dynamic :is binding",
                });
            }
        }

        if (binding.registry) {
            const importedModule = context.imports.get(binding.registry);
            const registryId = importedModule
                ? `${importedModule}@registry:${binding.registry}`
                : `${context.moduleId}@registry:${binding.registry}`;
            const plausibleRegistry = graph.nodes.has(registryId)
                || /registry|components|renderers|modulemap/i.test(binding.registry);
            if (!plausibleRegistry) {
                continue;
            }
            graph.edges.set(`${dynamicId}->${registryId}:RESOLVES_VIA_REGISTRY`, {
                from: dynamicId,
                to: registryId,
                type: "RESOLVES_VIA_REGISTRY",
                via: binding.registry,
                confidence: importedModule ? 0.75 : 0.9,
                reason: `Dynamic component expression references ${binding.registry}`,
            });
        }
    }
}

export function extractVuePropDeclarations(
    propsObjectNode: Parser.SyntaxNode,
    componentId: string,
    context: JsWalkContext
): string[] {
    const propNames: string[] = [];

    for (const child of propsObjectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const propName = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (!propName) {
            continue;
        }

        propNames.push(propName);
        const propNodeId = `${componentId}@prop:${propName}`;

        graph.nodes.set(propNodeId, {
            id: propNodeId,
            parent: componentId,
            type: "vue_prop",
            name: propName,
            file: context.file,
            keywords: [`prop:${propName}`],
            description: "Vue component prop declaration",
        });

        graph.edges.set(`${componentId}->${propNodeId}`, {
            from: componentId,
            to: propNodeId,
            type: "DECLARES_PROP",
        });
    }

    return propNames;
}

export function processVueTemplate(
    template: string,
    componentId: string,
    context: JsWalkContext
): string[] {
    const metadata = extractVueTemplateMetadata(template);

    recordRenderedComponents(componentId, metadata, context);

    for (const binding of metadata.propBindings) {
        recordPropBindingEdge(componentId, binding, context);
    }

    return templateKeywords(metadata);
}
