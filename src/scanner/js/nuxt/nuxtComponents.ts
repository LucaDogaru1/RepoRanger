import path from "node:path";
import { graph } from "../../../graph/graph";
import { toJsModuleId } from "../resolvers/resolveImportPath";
import {
    DYNAMIC,
    layerDirectoryOf,
    type Literal,
    type NuxtLayerConfig,
} from "./nuxtConfig";


const STR_SPLITTERS = ["-", "_", "/", "."];

function isUppercase(char = ""): boolean | undefined {
    if (/\d/.test(char)) return undefined;
    return char !== char.toLowerCase();
}

export function splitByCase(value: string): string[] {
    const parts: string[] = [];
    if (!value) return parts;
    let buff = "";
    let previousUpper: boolean | undefined;
    let previousSplitter: boolean | undefined;
    for (const char of value) {
        const isSplitter = STR_SPLITTERS.includes(char);
        if (isSplitter) {
            parts.push(buff);
            buff = "";
            previousUpper = undefined;
            continue;
        }
        const isUpper = isUppercase(char);
        if (previousSplitter === false) {
            if (previousUpper === false && isUpper === true) {
                parts.push(buff);
                buff = char;
                previousUpper = isUpper;
                continue;
            }
            if (previousUpper === true && isUpper === false && buff.length > 1) {
                const lastChar = buff.at(-1)!;
                parts.push(buff.slice(0, Math.max(0, buff.length - 1)));
                buff = lastChar + char;
                previousUpper = isUpper;
                continue;
            }
        }
        buff += char;
        previousUpper = isUpper;
        previousSplitter = isSplitter;
    }
    parts.push(buff);
    return parts;
}

function pascalCase(parts: string[]): string {
    return parts.map(part => (part ? part[0]!.toUpperCase() + part.slice(1) : "")).join("");
}

function resolveComponentNameSegments(fileName: string, prefixParts: string[]): string[] {
    const fileNameParts = splitByCase(fileName);
    const fileNamePartsContent = fileNameParts.join("/").toLowerCase();
    const componentNameParts = prefixParts.flatMap(part => splitByCase(part));
    let index = prefixParts.length - 1;
    const matchedSuffix: string[] = [];
    while (index >= 0) {
        const prefixPart = prefixParts[index]!;
        matchedSuffix.unshift(...splitByCase(prefixPart).map(part => part.toLowerCase()));
        const matchedSuffixContent = matchedSuffix.join("/");
        if (
            fileNamePartsContent === matchedSuffixContent
            || fileNamePartsContent.startsWith(`${matchedSuffixContent}/`)
            || (prefixPart.toLowerCase() === fileNamePartsContent
                && prefixParts[index + 1]
                && prefixParts[index] === prefixParts[index + 1])
        ) {
            componentNameParts.length = index;
        }
        index--;
    }
    return [...componentNameParts, ...fileNameParts];
}

const ISLAND_RE = /\.island(?:\.global)?$/;
const COMPONENT_MODE_RE = /(?<=\.)(client|server)(?:\.global|\.island)*$/;
const MODE_REPLACEMENT_RE = /(?:\.(?:client|server))?(?:\.global|\.island)*$/;

export interface ComponentDir {
    path: string;
    prefix?: string;
    pathPrefix?: boolean;
    ignore: RegExp[];
    extensions: string[];
    priority: number;
    island?: boolean;
}

export function nuxtComponentName(file: string, dir: ComponentDir): { name: string; mode: string } | null {
    const relative = file.slice(dir.path.length);
    const relativeDir = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative);
    const prefixParts = [
        ...(dir.prefix ? splitByCase(dir.prefix) : []),
        ...(dir.pathPrefix !== false ? splitByCase(relativeDir) : []),
    ];
    let fileName = path.posix.basename(file, path.posix.extname(file));
    const island = ISLAND_RE.test(fileName) || dir.island;
    const mode = island ? "server" : fileName.match(COMPONENT_MODE_RE)?.[1] ?? "all";
    fileName = fileName.replace(MODE_REPLACEMENT_RE, "");
    if (fileName.toLowerCase() === "index") {
        fileName = dir.pathPrefix === false ? path.posix.basename(path.posix.dirname(file)) : "";
    }
    const name = pascalCase(resolveComponentNameSegments(fileName.replace(/["']/g, ""), prefixParts));
    return name ? { name, mode } : null;
}

function globToRegExp(glob: string): RegExp {
    let pattern = "";
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i]!;
        if (char === "*" && glob[i + 1] === "*") {
            if (glob[i + 2] === "/") {
                pattern += "(?:.*/)?";
                i += 2;
            } else {
                pattern += ".*";
                i += 1;
            }
        } else if (char === "*") {
            pattern += "[^/]*";
        } else if (char === "?") {
            pattern += "[^/]";
        } else if (char === "{") {
            const end = glob.indexOf("}", i);
            if (end < 0) {
                pattern += "\\{";
                continue;
            }
            pattern += `(?:${glob.slice(i + 1, end).split(",").map(part => part.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
            i = end;
        } else {
            pattern += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${pattern}$`);
}

const DEFAULT_EXTENSIONS = ["js", "jsx", "mjs", "ts", "tsx", "vue"];
const DIR_DEFAULT_IGNORES = ["**/*{M,.m,-m}ixin.{js,ts,jsx,tsx}", "**/*.{d.ts,d.mts,d.cts}"].map(globToRegExp);
const NUXT_IGNORED_FILE = /(^|\/)(node_modules|\.nuxt|\.output)\/|\.stories\.[cm]?[jt]sx?$|\.(spec|test)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|(^|\/)-[^/]*$/;

type AliasMap = Array<[string, string]>;

function resolvePath(cwd: string, value: string): string {
    const joined = value.startsWith("/") ? value : `${cwd}${value}`;
    return path.posix.normalize(joined).replace(/\/?$/, "/");
}

function resolveAlias(value: string, aliases: AliasMap): string {
    for (const [alias, target] of aliases) {
        if (!value.startsWith(alias)) continue;
        const bare = alias.endsWith("/") ? alias.slice(0, -1) : alias;
        const next = value[bare.length];
        if (next === undefined || next === "/") {
            return path.posix.join(target, value.slice(bare.length));
        }
    }
    return value;
}

class DynamicConfig extends Error {}

function asStringArray(value: Literal | undefined): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new DynamicConfig();
    return value as string[];
}

function normalizeDirs(
    value: Literal | undefined,
    srcDir: string,
    priority: number,
    aliases: AliasMap,
): ComponentDir[] {
    const dir = (dirPath: string, options: { [key: string]: Literal } = {}): ComponentDir => {
        if (options.pattern !== undefined || (options.priority !== undefined && typeof options.priority !== "number")) {
            throw new DynamicConfig();
        }
        if (options.prefix !== undefined && typeof options.prefix !== "string") throw new DynamicConfig();
        if (options.pathPrefix !== undefined && typeof options.pathPrefix !== "boolean") throw new DynamicConfig();
        const extensions = options.extensions === undefined
            ? DEFAULT_EXTENSIONS
            : asStringArray(options.extensions).map(ext => ext.replace(/^\./, ""));
        return {
            path: resolvePath(srcDir, resolveAlias(dirPath, aliases)),
            prefix: options.prefix as string | undefined,
            pathPrefix: options.pathPrefix as boolean | undefined,
            ignore: asStringArray(options.ignore).map(globToRegExp),
            extensions,
            priority: typeof options.priority === "number" ? options.priority : priority,
            island: options.island === true,
        };
    };
    const byPathLength = (dirs: ComponentDir[]): ComponentDir[] =>
        dirs.sort((a, b) => b.path.split("/").filter(Boolean).length - a.path.split("/").filter(Boolean).length);

    if (value === DYNAMIC) throw new DynamicConfig();
    if (value === undefined || value === true) {
        return byPathLength([
            { ...dir("components/islands"), island: true },
            dir("components/global"),
            dir("components"),
        ]);
    }
    if (value === false || value === null) return [];
    if (typeof value === "string") return [dir(value)];
    if (Array.isArray(value)) {
        return byPathLength(value.flatMap(item => normalizeDirs(item, srcDir, priority, aliases)));
    }
    if (typeof value === "object") {
        const entries = "dirs" in value ? value.dirs : [value];
        if (entries === DYNAMIC || !Array.isArray(entries)) throw new DynamicConfig();
        return byPathLength(entries.map(entry => {
            if (typeof entry === "string") return dir(entry);
            if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.path !== "string") {
                throw new DynamicConfig();
            }
            return dir(entry.path, entry);
        }));
    }
    throw new DynamicConfig();
}

interface RegisteredComponent {
    file: string;
    priority: number;
    mode: string;
}

interface ComponentRegistry {
    components: Map<string, RegisteredComponent[]>;
    duplicates: Set<string>;
}

export interface NuxtContext {
    root: string;
    layers: string[];
    registry: ComponentRegistry;
}

function layerOrder(root: string, configs: Map<string, NuxtLayerConfig>): string[] {
    const order: string[] = [];
    const visit = (layerDir: string): void => {
        if (order.includes(layerDir)) return;
        const config = configs.get(layerDir);
        if (!config) throw new DynamicConfig();
        order.push(layerDir);
        const extendsValue = config.extends;
        if (extendsValue === DYNAMIC) throw new DynamicConfig();
        const sources = extendsValue === undefined ? [] : Array.isArray(extendsValue) ? extendsValue : [extendsValue];
        for (const source of sources) {
            const entry = Array.isArray(source) ? source[0] : source;
            if (typeof entry !== "string" || !entry.startsWith(".")) throw new DynamicConfig();
            visit(path.posix.normalize(`${layerDir}${entry}`).replace(/\/?$/, "/"));
        }
    };
    visit(root);
    return order;
}

function mergedAliases(order: string[], configs: Map<string, NuxtLayerConfig>, rootSrcDir: string, rootDir: string): AliasMap {
    const merged = new Map<string, string>();
    for (const layerDir of order) {
        const alias = configs.get(layerDir)!.alias;
        if (alias === undefined) continue;
        if (alias === DYNAMIC || typeof alias !== "object" || alias === null || Array.isArray(alias)) throw new DynamicConfig();
        for (const [key, value] of Object.entries(alias)) {
            if (typeof value !== "string" || value.startsWith("/")) throw new DynamicConfig();
            if (!merged.has(key)) merged.set(key, value);
        }
    }
    for (const [key, value] of [["~", rootSrcDir], ["@", rootSrcDir], ["~~", rootDir], ["@@", rootDir]] as const) {
        if (!merged.has(key)) merged.set(key, value);
    }
    return [...merged].sort((a, b) => b[0].length - a[0].length);
}

function scanComponents(dirs: ComponentDir[], files: string[]): ComponentRegistry {
    const registry: ComponentRegistry = { components: new Map(), duplicates: new Set() };
    const claimed = new Set<string>();
    const scannedPaths: string[] = [];

    for (const dir of dirs) {
        const resolvedNames = new Set<string>();
        const candidates = files
            .filter(file => file.startsWith(dir.path))
            .map(file => file.slice(dir.path.length))
            .filter(relative => dir.extensions.includes(path.posix.extname(relative).slice(1)))
            .filter(relative => !DIR_DEFAULT_IGNORES.some(re => re.test(relative)) && !dir.ignore.some(re => re.test(relative)))
            .sort();

        for (const relative of candidates) {
            const file = `${dir.path}${relative}`;
            if (NUXT_IGNORED_FILE.test(file) || scannedPaths.some(scanned => file.startsWith(scanned)) || claimed.has(file)) {
                continue;
            }
            claimed.add(file);
            const resolved = nuxtComponentName(file, dir);
            if (!resolved) continue;
            const { name, mode } = resolved;
            const suffix = mode !== "all" ? `-${mode}` : "";
            if (resolvedNames.has(name + suffix) || resolvedNames.has(name)) {
                registry.duplicates.add(name);
                continue;
            }
            resolvedNames.add(name + suffix);

            const existing = registry.components.get(name) ?? [];
            const clash = existing.find(component => component.mode === "all" || component.mode === mode);
            if (!clash) {
                existing.push({ file, priority: dir.priority, mode });
                registry.components.set(name, existing);
                continue;
            }
            if (dir.priority > clash.priority) {
                existing.splice(existing.indexOf(clash), 1, { file, priority: dir.priority, mode });
            } else if (dir.priority === clash.priority && dir.priority > 0) {
                registry.duplicates.add(name);
            }
        }
        scannedPaths.push(dir.path);
    }
    return registry;
}

export function buildNuxtContexts(configs: NuxtLayerConfig[], files: string[]): { contexts: NuxtContext[]; skipped: string[] } {
    const byDir = new Map(configs.map(config => [config.layerDir, config]));
    const rootedFiles = files.map(file => `/${file}`);
    const contexts: NuxtContext[] = [];
    const skipped: string[] = [];

    for (const root of [...byDir.keys()].sort()) {
        try {
            const order = layerOrder(root, byDir);
            const rootConfig = byDir.get(root)!;
            if (rootConfig.srcDir === DYNAMIC) throw new DynamicConfig();
            const aliases = mergedAliases(order, byDir, `/${rootConfig.srcDir}`, `/${root}`);
            const dirs = order.flatMap((layerDir, index) => {
                const layer = byDir.get(layerDir)!;
                if (layer.srcDir === DYNAMIC) throw new DynamicConfig();
                return normalizeDirs(layer.components, `/${layer.srcDir}`, order.length - index, aliases);
            });
            const registry = scanComponents(dirs, rootedFiles);
            for (const list of registry.components.values()) {
                for (const component of list) component.file = component.file.slice(1);
            }
            contexts.push({ root, layers: order, registry });
        } catch (error) {
            if (!(error instanceof DynamicConfig)) throw error;
            skipped.push(root);
        }
    }
    return { contexts, skipped };
}

const LAZY_PREFIX = /^Lazy(?:Idle|Visible|Interaction|MediaQuery|If|Never|Time)?(?=[A-Z])/;

export type ComponentTagResolution =
    | { kind: "resolved"; file: string; contexts: string[] }
    | { kind: "ambiguous"; files: string[]; contexts: string[] }
    | { kind: "unresolved" };

export function resolveComponentTag(tag: string, callerFile: string, contexts: NuxtContext[]): ComponentTagResolution {
    const callerLayer = layerDirectoryOf(callerFile, new Set(contexts.flatMap(context => context.layers)));
    if (!callerLayer) return { kind: "unresolved" };

    const targets = new Set<string>();
    const matchedContexts: string[] = [];
    let ambiguous = false;
    for (const context of contexts) {
        if (!context.layers.includes(callerLayer)) continue;
        const name = context.registry.components.has(tag) || context.registry.duplicates.has(tag)
            ? tag
            : tag.replace(LAZY_PREFIX, "");
        if (context.registry.duplicates.has(name)) {
            ambiguous = true;
            matchedContexts.push(context.root);
            continue;
        }
        const matches = context.registry.components.get(name);
        if (!matches?.length) continue;
        matchedContexts.push(context.root);
        if (matches.length > 1) ambiguous = true;
        matches.forEach(match => targets.add(match.file));
    }

    if (matchedContexts.length === 0) return { kind: "unresolved" };
    if (ambiguous || targets.size !== 1) {
        return { kind: "ambiguous", files: [...targets].sort(), contexts: matchedContexts };
    }
    return { kind: "resolved", file: [...targets][0]!, contexts: matchedContexts };
}

interface PendingTemplateTag {
    from: string;
    file: string;
    tag: string;
}

const pendingTemplateTags: PendingTemplateTag[] = [];

export function recordUnresolvedComponentTag(from: string, file: string, tag: string): void {
    pendingTemplateTags.push({ from, file, tag });
}

export function resetNuxtComponentUsages(): void {
    pendingTemplateTags.length = 0;
}

export interface NuxtComponentLinkStats {
    resolved: number;
    ambiguous: number;
    ambiguousExamples: string[];
    skippedContexts: string[];
}

export function linkNuxtAutoImportedComponents(configs: NuxtLayerConfig[], files: string[]): NuxtComponentLinkStats {
    const stats: NuxtComponentLinkStats = { resolved: 0, ambiguous: 0, ambiguousExamples: [], skippedContexts: [] };
    if (configs.length === 0 || pendingTemplateTags.length === 0) return stats;

    const { contexts, skipped } = buildNuxtContexts(configs, files);
    stats.skippedContexts = skipped;

    for (const usage of pendingTemplateTags) {
        const resolution = resolveComponentTag(usage.tag, usage.file, contexts);
        if (resolution.kind === "ambiguous") {
            stats.ambiguous += 1;
            if (stats.ambiguousExamples.length < 10) {
                stats.ambiguousExamples.push(`${usage.file} <${usage.tag}> → ${resolution.files.join(" | ") || "duplicate name"}`);
            }
            continue;
        }
        if (resolution.kind !== "resolved" || resolution.file === usage.file) continue;

        const target = toJsModuleId(resolution.file);
        if (!graph.nodes.has(target)) continue;
        const edgeId = `${usage.from}->${target}:RENDERS_COMPONENT:${usage.tag}`;
        if (graph.edges.has(edgeId)) continue;
        graph.edges.set(edgeId, {
            from: usage.from,
            to: target,
            type: "RENDERS_COMPONENT",
            via: usage.tag,
            confidence: 0.9,
            reason: `Nuxt auto-imported component <${usage.tag}> (unique in ${resolution.contexts.length} app context(s))`,
        });
        stats.resolved += 1;
    }

    resetNuxtComponentUsages();
    return stats;
}
