export interface VuePropBinding {
    tag: string;
    prop: string;
    expression: string;
}

export interface VueTemplateMetadata {
    tags: string[];
    componentTags: string[];
    props: string[];
    classes: string[];
    directives: string[];
    propBindings: VuePropBinding[];
    dynamicComponents: VueDynamicComponentBinding[];
}

export interface VueDynamicComponentBinding {
    expression: string;
    staticTarget?: string;
    registry?: string;
}

const VUE_TAG_PATTERN = /<([A-Z][A-Za-z0-9]*)\b/g;
const CLASS_PATTERN = /class=(?:"([^"]+)"|'([^']+)'|:class="[^"]+")/g;
const DIRECTIVE_PATTERN = /\b(v-[a-z-]+|:[a-z][a-z0-9-]*|@[a-z][a-z0-9-]+)/g;
const BINDING_ATTR_PATTERN = /:([a-z][a-z0-9-]*)="([^"]+)"/g;
const TAG_BLOCK_PATTERN = /<([A-Z][A-Za-z0-9]*)\b([\s\S]*?)(\/?)>/g;
const DYNAMIC_COMPONENT_PATTERN = /<component\b([\s\S]*?)(?:\/?)>/gi;
const DYNAMIC_IS_PATTERN = /(?::is|v-bind:is)\s*=\s*(["'])([\s\S]*?)\1/i;
const STATIC_IS_PATTERN = /(?:^|\s)is\s*=\s*(["'])([^"']+)\1/i;

const COMPONENT_TAG_PATTERN = /<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?=[\s/>])/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const RESERVED_DASHED_TAGS = new Set(["annotation-xml", "color-profile", "font-face", "font-face-src", "font-face-uri", "font-face-format", "font-face-name", "missing-glyph"]);

function kebabToCamel(value: string): string {
    return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function componentTagsOf(template: string): string[] {
    const tags = new Set<string>();
    for (const match of template.replace(HTML_COMMENT_PATTERN, "").matchAll(COMPONENT_TAG_PATTERN)) {
        const raw = match[1]!;
        if (RESERVED_DASHED_TAGS.has(raw)) continue;
        const camel = raw.includes("-") ? kebabToCamel(raw).replace(/-(\d)/g, "$1") : raw;
        tags.add(camel[0]!.toUpperCase() + camel.slice(1));
    }
    return [...tags];
}

export function extractVueTemplateMetadata(template: string): VueTemplateMetadata {
    const tags = new Set<string>();
    const props = new Set<string>();
    const classes = new Set<string>();
    const directives = new Set<string>();
    const propBindings: VuePropBinding[] = [];
    const dynamicComponents: VueDynamicComponentBinding[] = [];

    for (const match of template.matchAll(DYNAMIC_COMPONENT_PATTERN)) {
        const attributes = match[1] ?? "";
        const dynamic = attributes.match(DYNAMIC_IS_PATTERN);
        if (dynamic?.[2]) {
            const expression = dynamic[2].trim();
            const quotedTarget = expression.match(/^["']([^"']+)["']$/)?.[1];
            const registry = expression.match(/^([A-Za-z_$][\w$]*)\s*(?:\[|\.)/)?.[1];
            dynamicComponents.push({
                expression,
                staticTarget: quotedTarget,
                registry,
            });
            continue;
        }
        const staticMatch = attributes.match(STATIC_IS_PATTERN);
        if (staticMatch?.[2]) {
            dynamicComponents.push({
                expression: staticMatch[2],
                staticTarget: staticMatch[2],
            });
        }
    }

    for (const match of template.matchAll(TAG_BLOCK_PATTERN)) {
        const tag = match[1];
        const attrBlock = match[2] ?? "";
        if (!tag || tag === "template") {
            continue;
        }

        tags.add(tag);

        for (const bindingMatch of attrBlock.matchAll(BINDING_ATTR_PATTERN)) {
            const prop = bindingMatch[1];
            const expression = bindingMatch[2]?.trim() ?? "";
            if (!prop) {
                continue;
            }

            const normalizedProp = kebabToCamel(prop);
            props.add(normalizedProp);
            propBindings.push({ tag, prop: normalizedProp, expression });
        }
    }

    for (const match of template.matchAll(VUE_TAG_PATTERN)) {
        const tag = match[1];
        if (tag) {
            tags.add(tag);
        }
    }

    for (const match of template.matchAll(CLASS_PATTERN)) {
        const classValue = match[1] ?? match[2] ?? "";
        for (const className of classValue.split(/\s+/).filter(Boolean)) {
            classes.add(className);
        }
    }

    for (const match of template.matchAll(DIRECTIVE_PATTERN)) {
        const directive = match[1];
        if (directive.startsWith(":")) {
            props.add(kebabToCamel(directive.slice(1)));
        } else {
            directives.add(directive);
        }
    }

    return {
        tags: [...tags],
        componentTags: componentTagsOf(template),
        props: [...props],
        classes: [...classes],
        directives: [...directives].filter(item => item.startsWith("v-")),
        propBindings,
        dynamicComponents,
    };
}

export function templateKeywords(metadata: VueTemplateMetadata): string[] {
    return [
        ...metadata.tags.map(tag => `tag:${tag}`),
        ...metadata.props.map(prop => `prop:${prop}`),
        ...metadata.classes.map(className => `class:${className}`),
        ...metadata.directives.map(directive => `directive:${directive}`),
        ...metadata.dynamicComponents.map(binding => `dynamic:${binding.staticTarget ?? binding.registry ?? binding.expression}`),
    ];
}
