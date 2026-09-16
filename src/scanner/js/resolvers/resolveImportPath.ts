import fs from "node:fs";
import path from "node:path";
import { getScanConfig } from "../../../shared/config/scanRuntime";
import type { PathAliasScope } from "../../../shared/config/discoverPathAliases";

const JS_MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"];

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripGraphPrefix(filePath: string): string {
    const normalized = normalizePath(filePath);
    const prefix = normalizePath(getScanConfig().graphPathPrefix ?? "");
    return prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function withGraphPrefix(filePath: string): string {
    const normalized = normalizePath(filePath);
    const prefix = normalizePath(getScanConfig().graphPathPrefix ?? "");
    return prefix && !normalized.startsWith(prefix) ? `${prefix}${normalized}` : normalized;
}

function aliasMatches(importSource: string, alias: string): boolean {
    if (importSource === alias) {
        return true;
    }
    if (alias.endsWith("/")) {
        return importSource.startsWith(alias);
    }
    return importSource.startsWith(`${alias}/`);
}

function applyAliasMap(importSource: string, aliases: Record<string, string>): string | null {
    const entries = Object.entries(aliases).sort((left, right) => right[0].length - left[0].length);
    for (const [alias, target] of entries) {
        if (!aliasMatches(importSource, alias)) {
            continue;
        }
        const suffix = importSource.slice(alias.length).replace(/^\//, "");
        const normalizedTarget = normalizePath(target).replace(/\/$/, "");
        return suffix ? `${normalizedTarget}/${suffix}`.replace(/^\//, "") : normalizedTarget;
    }
    return null;
}

function isFileInsideScope(filePath: string, scope: PathAliasScope): boolean {
    if (!scope.directory) {
        return true;
    }
    return filePath === scope.directory || filePath.startsWith(`${scope.directory}/`);
}

function applyPathAliases(currentFile: string, importSource: string): string | null {
    const config = getScanConfig();

    const explicit = applyAliasMap(importSource, config.pathAliases ?? {});
    if (explicit !== null) {
        return explicit;
    }

    const localCurrentFile = stripGraphPrefix(currentFile);
    const scopes = (config.pathAliasScopes ?? [])
        .filter(scope => isFileInsideScope(localCurrentFile, scope))
        .sort((left, right) => right.directory.length - left.directory.length);

    for (const scope of scopes) {
        const resolved = applyAliasMap(importSource, scope.pathAliases);
        if (resolved !== null) {
            return resolved;
        }
    }

    return null;
}

function existingModulePath(relativePath: string): string | null {
    const scanRoot = getScanConfig().scanRoot;
    if (!scanRoot) {
        return null;
    }

    const normalized = normalizePath(relativePath);
    const hasKnownExtension = JS_MODULE_EXTENSIONS.some(extension => normalized.endsWith(extension));
    const candidates = hasKnownExtension
        ? [normalized]
        : [
            normalized,
            ...JS_MODULE_EXTENSIONS.map(extension => `${normalized}${extension}`),
            ...JS_MODULE_EXTENSIONS.map(extension => `${normalized}/index${extension}`),
        ];

    for (const candidate of candidates) {
        const absoluteCandidate = path.resolve(scanRoot, candidate);
        const relativeCandidate = path.relative(scanRoot, absoluteCandidate);
        if (relativeCandidate.startsWith("..") || path.isAbsolute(relativeCandidate)) {
            continue;
        }
        try {
            if (fs.statSync(absoluteCandidate).isFile()) {
                return normalizePath(relativeCandidate);
            }
        } catch {
            continue;
        }
    }
    return null;
}

function unresolvedModulePath(relativePath: string): string {
    const normalized = normalizePath(relativePath);
    if (JS_MODULE_EXTENSIONS.some(extension => normalized.endsWith(extension))) {
        return normalized;
    }
    return `${normalized}.js`;
}

export function resolveImportSource(currentFile: string, importSource: string): string {
    const cleanedSource = importSource.replace(/^["']|["']$/g, "");
    const aliased = applyPathAliases(currentFile, cleanedSource);

    if (aliased !== null) {
        return withGraphPrefix(existingModulePath(aliased) ?? unresolvedModulePath(aliased));
    }

    if (cleanedSource.startsWith(".")) {
        const localCurrentFile = stripGraphPrefix(currentFile);
        const directory = path.posix.dirname(localCurrentFile);
        const joined = normalizePath(path.posix.normalize(path.posix.join(directory, cleanedSource)));
        return withGraphPrefix(existingModulePath(joined) ?? unresolvedModulePath(joined));
    }

    return unresolvedModulePath(cleanedSource);
}

export function toJsModuleId(relativePath: string): string {
    return `js:${normalizePath(relativePath)}`;
}
