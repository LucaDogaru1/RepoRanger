import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { resolveImportSource, toJsModuleId } from "../resolvers/resolveImportPath";
import { JsWalkContext } from "../walk/context";

function unquote(value: string): string {
    return value.replace(/^["'`]|["'`]$/g, "");
}

function registryNodeId(context: JsWalkContext, name: string): string {
    return `${context.moduleId}@registry:${name}`;
}

function readDynamicImportTarget(
    node: Parser.SyntaxNode,
    context: JsWalkContext,
): string | null {
    const match = node.text.match(/\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/);
    if (!match?.[2]) {
        return null;
    }
    return toJsModuleId(resolveImportSource(context.file, match[2]));
}

function resolveRegistryValue(
    value: Parser.SyntaxNode,
    context: JsWalkContext,
): { targetId: string | null; label: string; confidence: number } {
    if (value.type === "identifier") {
        const imported = context.imports.get(value.text);
        return {
            targetId: imported ?? null,
            label: value.text,
            confidence: imported ? 0.98 : 0.55,
        };
    }

    const dynamicImport = readDynamicImportTarget(value, context);
    if (dynamicImport) {
        return { targetId: dynamicImport, label: dynamicImport, confidence: 0.95 };
    }

    if (value.type === "string" || value.type === "template_string") {
        return { targetId: null, label: unquote(value.text), confidence: 0.45 };
    }

    return { targetId: null, label: value.text.slice(0, 120), confidence: 0.35 };
}

function readRegistryEntries(
    objectNode: Parser.SyntaxNode,
    context: JsWalkContext,
): Array<{ key: string; targetId: string | null; label: string; confidence: number }> {
    const entries: Array<{ key: string; targetId: string | null; label: string; confidence: number }> = [];
    for (const child of objectNode.namedChildren) {
        if (child.type === "shorthand_property_identifier") {
            const resolved = resolveRegistryValue(child, context);
            entries.push({ key: child.text, ...resolved });
            continue;
        }
        if (child.type !== "pair") {
            continue;
        }
        const keyNode = child.childForFieldName("key");
        const valueNode = child.childForFieldName("value");
        const key = keyNode ? unquote(keyNode.text) : "";
        if (!key || !valueNode) {
            continue;
        }
        entries.push({ key, ...resolveRegistryValue(valueNode, context) });
    }
    return entries;
}

function looksLikeComponentRegistry(
    name: string,
    entries: Array<{ targetId: string | null; label: string }>,
): boolean {
    const nameWords = name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const explicitRegistryName = nameWords.includes("registry")
        || nameWords.includes("components")
        || nameWords.includes("renderers")
        || (
            nameWords.some(word => ["component", "renderer", "module"].includes(word))
            && nameWords.includes("map")
        );
    const componentTargets = entries.filter(entry =>
        /\.vue$/i.test(entry.targetId ?? "")
        || /(?:^|\/)components?\//i.test(entry.targetId ?? "")
        || /(?:Component|Module)$/i.test(entry.label)
    ).length;
    return entries.length > 0 && (explicitRegistryName || componentTargets >= 2);
}

export function trackComponentRegistries(
    declaration: Parser.SyntaxNode,
    context: JsWalkContext,
): void {
    for (const declarator of declaration.namedChildren) {
        if (declarator.type !== "variable_declarator") {
            continue;
        }
        const nameNode = declarator.childForFieldName("name");
        const valueNode = declarator.childForFieldName("value");
        if (nameNode?.type !== "identifier" || valueNode?.type !== "object") {
            continue;
        }

        const entries = readRegistryEntries(valueNode, context);
        if (!looksLikeComponentRegistry(nameNode.text, entries)) {
            continue;
        }

        const registryId = registryNodeId(context, nameNode.text);
        graph.nodes.set(registryId, {
            id: registryId,
            parent: context.moduleId,
            type: "component_registry",
            name: nameNode.text,
            file: context.file,
            keywords: ["component-registry", ...entries.map(entry => entry.key)],
            description: `Component registry with ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
        });
        graph.edges.set(`${context.moduleId}->${registryId}:DECLARES_REGISTRY`, {
            from: context.moduleId,
            to: registryId,
            type: "DECLARES_REGISTRY",
        });

        for (const entry of entries) {
            const entryId = `${registryId}@entry:${entry.key}`;
            graph.nodes.set(entryId, {
                id: entryId,
                parent: registryId,
                type: "registry_entry",
                name: entry.key,
                file: context.file,
                keywords: [entry.key, entry.label],
                description: `Registry key ${entry.key} maps to ${entry.label}`,
            });
            graph.edges.set(`${registryId}->${entryId}:CONTAINS`, {
                from: registryId,
                to: entryId,
                type: "CONTAINS",
            });
            if (entry.targetId) {
                graph.edges.set(`${entryId}->${entry.targetId}:REGISTERED_AS`, {
                    from: entryId,
                    to: entry.targetId,
                    type: "REGISTERED_AS",
                    via: entry.key,
                    confidence: entry.confidence,
                    reason: `${entry.label} is registered under ${entry.key}`,
                });
            }
        }
    }
}
