import { graph } from "../../../graph/graph";
import { layerDirectoryOf, nuxtLayerDirectories } from "./nuxtConfig";

const AUTO_IMPORT_ENTRY = /^(composables|utils)\/(?:[^/]+\.(?:ts|js|mjs|mts)|[^/]+\/index\.(?:ts|js|mjs|mts))$/;

export function resolveNuxtAutoImportCalls(relativePaths: string[]): number {
    const layerDirs = nuxtLayerDirectories(relativePaths);
    if (layerDirs.length === 0) return 0;

    const definitions = new Map<string, string[]>();
    for (const node of graph.nodes.values()) {
        if (!node.file || !node.id.startsWith(`js:${node.file}::`)) continue;
        const name = node.id.slice(`js:${node.file}::`.length);
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        const layer = layerDirectoryOf(node.file, layerDirs);
        if (layer === undefined || !AUTO_IMPORT_ENTRY.test(node.file.slice(layer.length))) continue;
        const ids = definitions.get(name) ?? [];
        ids.push(node.id);
        definitions.set(name, ids);
    }

    let resolved = 0;
    for (const [edgeId, edge] of [...graph.edges]) {
        if (edge.type !== "CALLS" || !edge.from.startsWith("js:") || graph.nodes.has(edge.to)) continue;
        const callerFile = graph.nodes.get(edge.from)?.file;
        if (!callerFile || !edge.to.startsWith(`js:${callerFile}::`)) continue;
        if (layerDirectoryOf(callerFile, layerDirs) === undefined) continue;

        const name = edge.to.slice(`js:${callerFile}::`.length);
        const candidates = definitions.get(name);
        if (candidates?.length !== 1) continue;

        const target = candidates[0]!;
        graph.edges.delete(edgeId);
        graph.edges.set(`${edge.from}->${target}:CALLS:${name}`, {
            ...edge,
            to: target,
            confidence: 0.8,
            reason: "Nuxt auto-import: unique composable/util name across layers",
        });
        resolved += 1;
    }

    return resolved;
}
