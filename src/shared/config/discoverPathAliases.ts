import fs from "node:fs";
import path from "node:path";

export interface PathAliasScope {
    directory: string;
    pathAliases: Record<string, string>;
    sources: string[];
}

const CONFIG_FILE_PATTERN = /^(?:tsconfig|jsconfig)\.json$|^(?:nuxt|vite|webpack)\.config\.(?:js|ts|mjs|cjs)$/;
const IGNORED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    "storage",
    "cache",
    "logs",
]);

interface AliasCandidate {
    aliases: Record<string, string>;
    configPath: string;
    priority: number;
    scopeDirectory: string;
}

function toPosix(value: string): string {
    return value.split(path.sep).join("/");
}

function relativeToRoot(rootDir: string, absolutePath: string): string | null {
    const relative = path.relative(rootDir, absolutePath);
    if (relative === "") {
        return "";
    }
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return toPosix(relative);
}

function stripJsonComments(source: string): string {
    let result = "";
    let quote: string | null = null;
    let escaped = false;

    for (let index = 0; index < source.length; index += 1) {
        const current = source[index]!;
        const next = source[index + 1];

        if (quote) {
            result += current;
            if (escaped) {
                escaped = false;
            } else if (current === "\\") {
                escaped = true;
            } else if (current === quote) {
                quote = null;
            }
            continue;
        }

        if (current === '"' || current === "'") {
            quote = current;
            result += current;
            continue;
        }

        if (current === "/" && next === "/") {
            while (index < source.length && source[index] !== "\n") {
                index += 1;
            }
            result += "\n";
            continue;
        }

        if (current === "/" && next === "*") {
            index += 2;
            while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
                index += 1;
            }
            index += 1;
            continue;
        }

        result += current;
    }

    return result;
}

function readJsonConfig(filePath: string): Record<string, unknown> | null {
    try {
        const withoutComments = stripJsonComments(fs.readFileSync(filePath, "utf-8"));
        const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function normalizeAlias(alias: string): string | null {
    const normalized = alias.replace(/\*$/, "").replace(/\/$/, "");
    return normalized && normalized !== "*" ? normalized : null;
}

function normalizeTarget(
    rootDir: string,
    configDirectory: string,
    baseUrl: string,
    target: string
): string | null {
    const withoutWildcard = target.replace(/\*$/, "");
    const candidates = [path.resolve(configDirectory, baseUrl, withoutWildcard)];

    // Vite projects sometimes use URL-root replacements such as
    // `@ -> /resources/js`. When that absolute filesystem path is outside the
    // scan root, resolve it from the config directory if the local path exists.
    if (withoutWildcard.startsWith("/")) {
        candidates.push(path.resolve(configDirectory, baseUrl, `.${withoutWildcard}`));
    }

    const inRootCandidates = candidates
        .map(absolutePath => ({ absolutePath, relative: relativeToRoot(rootDir, absolutePath) }))
        .filter((candidate): candidate is { absolutePath: string; relative: string } => candidate.relative !== null);
    const selected = inRootCandidates.find(candidate => fs.existsSync(candidate.absolutePath))
        ?? inRootCandidates[0];
    if (!selected) {
        return null;
    }

    return withoutWildcard.endsWith("/") && selected.relative && !selected.relative.endsWith("/")
        ? `${selected.relative}/`
        : selected.relative;
}

function resolveExtendedConfig(configPath: string, extended: string): string | null {
    if (!extended.startsWith(".")) {
        return null;
    }
    const candidate = path.resolve(path.dirname(configPath), extended);
    const candidates = path.extname(candidate) ? [candidate] : [`${candidate}.json`, candidate];
    return candidates.find(item => fs.existsSync(item) && fs.statSync(item).isFile()) ?? null;
}

function extractTsconfigAliases(
    rootDir: string,
    configPath: string,
    seen: Set<string> = new Set()
): Record<string, string> {
    const absoluteConfig = path.resolve(configPath);
    if (seen.has(absoluteConfig)) {
        return {};
    }
    seen.add(absoluteConfig);

    const parsed = readJsonConfig(absoluteConfig);
    if (!parsed) {
        return {};
    }

    let aliases: Record<string, string> = {};
    if (typeof parsed.extends === "string") {
        const parent = resolveExtendedConfig(absoluteConfig, parsed.extends);
        if (parent) {
            aliases = extractTsconfigAliases(rootDir, parent, seen);
        }
    }

    const compilerOptions = parsed.compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== "object" || Array.isArray(compilerOptions)) {
        return aliases;
    }

    const options = compilerOptions as Record<string, unknown>;
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : ".";
    const paths = options.paths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
        return aliases;
    }

    for (const [rawAlias, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
        const alias = normalizeAlias(rawAlias);
        const targets = Array.isArray(rawTargets)
            ? rawTargets.filter((value): value is string => typeof value === "string")
            : [];
        if (!alias || targets.length === 0) {
            continue;
        }

        for (const target of targets) {
            const normalized = normalizeTarget(rootDir, path.dirname(absoluteConfig), baseUrl, target);
            if (normalized !== null) {
                aliases[alias] = normalized;
                break;
            }
        }
    }

    return aliases;
}

function extractBalancedObject(source: string, property: string): string | null {
    const propertyPattern = new RegExp(`(?:["']${property}["']|\\b${property})\\s*:`);
    const match = propertyPattern.exec(source);
    if (!match) {
        return null;
    }

    const start = source.indexOf("{", match.index + match[0].length);
    if (start < 0) {
        return null;
    }

    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const current = source[index]!;
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (current === "\\") {
                escaped = true;
            } else if (current === quote) {
                quote = null;
            }
            continue;
        }
        if (current === '"' || current === "'" || current === "`") {
            quote = current;
            continue;
        }
        if (current === "{") {
            depth += 1;
        } else if (current === "}") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start + 1, index);
            }
        }
    }
    return null;
}

function splitObjectEntries(objectBody: string): string[] {
    const entries: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;

    for (let index = 0; index < objectBody.length; index += 1) {
        const current = objectBody[index]!;
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (current === "\\") {
                escaped = true;
            } else if (current === quote) {
                quote = null;
            }
            continue;
        }
        if (current === '"' || current === "'" || current === "`") {
            quote = current;
            continue;
        }
        if ("({[".includes(current)) {
            depth += 1;
        } else if (")}]".includes(current)) {
            depth -= 1;
        } else if (current === "," && depth === 0) {
            entries.push(objectBody.slice(start, index));
            start = index + 1;
        }
    }
    entries.push(objectBody.slice(start));
    return entries;
}

function staticPathFromExpression(expression: string): string | null {
    const trimmed = expression.trim();
    const direct = trimmed.match(/^["'`]([^"'`]+)["'`]$/);
    if (direct) {
        return direct[1]!;
    }

    const stringValues = [...trimmed.matchAll(/["'`]([^"'`]+)["'`]/g)].map(match => match[1]!);
    if (stringValues.length === 0) {
        return null;
    }

    if (/\bnew\s+URL\s*\(/.test(trimmed)) {
        return stringValues[0]!;
    }
    if (/\b(?:path\.)?resolve\s*\(|\b(?:path\.)?join\s*\(/.test(trimmed)) {
        return path.join(...stringValues);
    }
    return null;
}

function extractStaticAliasObject(
    rootDir: string,
    configPath: string,
    source: string
): Record<string, string> {
    const body = extractBalancedObject(source, "alias");
    if (!body) {
        return {};
    }

    const aliases: Record<string, string> = {};
    for (const entry of splitObjectEntries(body)) {
        const match = entry.match(/^\s*(?:["'`]([^"'`]+)["'`]|([@~#$A-Za-z_][\w@~#$./-]*))\s*:\s*([\s\S]+)$/);
        if (!match) {
            continue;
        }
        const alias = normalizeAlias(match[1] ?? match[2] ?? "");
        const target = staticPathFromExpression(match[3]!);
        if (!alias || !target) {
            continue;
        }
        const normalized = normalizeTarget(rootDir, path.dirname(configPath), ".", target);
        if (normalized !== null) {
            aliases[alias] = normalized;
        }
    }
    return aliases;
}

function extractNuxtAliases(rootDir: string, configPath: string, source: string): Record<string, string> {
    const aliases = extractStaticAliasObject(rootDir, configPath, source);
    const srcDirMatch = source.match(/\bsrcDir\s*:\s*["'`]([^"'`]+)["'`]/);
    const srcDirectory = srcDirMatch?.[1] ?? ".";
    const rootTarget = normalizeTarget(rootDir, path.dirname(configPath), ".", ".");
    const srcTarget = normalizeTarget(rootDir, path.dirname(configPath), ".", srcDirectory);

    if (srcTarget !== null) {
        aliases["@"] ??= srcTarget;
        aliases["~"] ??= srcTarget;
    }
    if (rootTarget !== null) {
        aliases["@@"] ??= rootTarget;
        aliases["~~"] ??= rootTarget;
    }
    return aliases;
}

function discoverConfigPaths(rootDir: string): string[] {
    const found: string[] = [];

    function visit(directory: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isFile() && CONFIG_FILE_PATTERN.test(entry.name)) {
                found.push(fullPath);
                continue;
            }
            if (!entry.isDirectory()) {
                continue;
            }
            if (entry.name === ".nuxt") {
                const generatedConfig = path.join(fullPath, "tsconfig.json");
                if (fs.existsSync(generatedConfig)) {
                    found.push(generatedConfig);
                }
                continue;
            }
            if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            visit(fullPath);
        }
    }

    visit(rootDir);
    return found.sort();
}

function candidateFromConfig(rootDir: string, configPath: string): AliasCandidate | null {
    const fileName = path.basename(configPath);
    const configDirectory = path.dirname(configPath);
    const scopeBase = path.basename(configDirectory) === ".nuxt"
        ? path.dirname(configDirectory)
        : configDirectory;
    const scopeDirectory = relativeToRoot(rootDir, scopeBase);
    if (scopeDirectory === null) {
        return null;
    }

    if (fileName === "tsconfig.json" || fileName === "jsconfig.json") {
        return {
            aliases: extractTsconfigAliases(rootDir, configPath),
            configPath,
            priority: 10,
            scopeDirectory,
        };
    }

    let source: string;
    try {
        source = fs.readFileSync(configPath, "utf-8");
    } catch {
        return null;
    }

    if (fileName.startsWith("nuxt.config.")) {
        return {
            aliases: extractNuxtAliases(rootDir, configPath, source),
            configPath,
            priority: 40,
            scopeDirectory,
        };
    }

    const priority = fileName.startsWith("vite.config.") ? 30 : 20;
    return {
        aliases: extractStaticAliasObject(rootDir, configPath, source),
        configPath,
        priority,
        scopeDirectory,
    };
}

export function discoverPathAliasScopes(rootDir: string): PathAliasScope[] {
    const candidates = discoverConfigPaths(rootDir)
        .map(configPath => candidateFromConfig(rootDir, configPath))
        .filter((candidate): candidate is AliasCandidate => Boolean(candidate))
        .filter(candidate => Object.keys(candidate.aliases).length > 0)
        .sort((left, right) => left.priority - right.priority || left.configPath.localeCompare(right.configPath));

    const scopes = new Map<string, PathAliasScope>();
    for (const candidate of candidates) {
        const scope = scopes.get(candidate.scopeDirectory) ?? {
            directory: candidate.scopeDirectory,
            pathAliases: {},
            sources: [],
        };
        Object.assign(scope.pathAliases, candidate.aliases);
        scope.sources.push(toPosix(path.relative(rootDir, candidate.configPath)));
        scopes.set(candidate.scopeDirectory, scope);
    }

    return [...scopes.values()].sort((left, right) => right.directory.length - left.directory.length);
}
