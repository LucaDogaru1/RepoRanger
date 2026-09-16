import fs from "node:fs";
import path from "node:path";

export type CodeRuntime =
    | "legacy-vue"
    | "nuxt"
    | "vue"
    | "shared"
    | "backend"
    | "unknown";

export interface ProjectScope {
    directory: string;
    workspace: string;
    packageName?: string;
    runtime: CodeRuntime;
    confidence: number;
    reasons: string[];
    sources: string[];
}

export interface CodeLocationClassification {
    workspace: string | null;
    runtime: CodeRuntime;
    confidence: number;
    reasons: string[];
}

const IGNORED_DIRECTORIES = new Set([
    ".git",
    ".nuxt",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    "storage",
    "cache",
    "logs",
]);

const CONFIG_PATTERN = /^(?:nuxt|vite|webpack)\.config\.(?:js|ts|mjs|cjs)$/;

interface ScopeEvidence {
    directory: string;
    packageName?: string;
    runtime: CodeRuntime;
    confidence: number;
    reasons: string[];
    sources: string[];
}

function normalizePath(value: string): string {
    return value.split(path.sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");
}

function relativeDirectory(rootDir: string, absoluteDirectory: string): string | null {
    const relative = path.relative(rootDir, absoluteDirectory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }
    return normalizePath(relative);
}

function readJson(filePath: string): Record<string, unknown> | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function dependencyMap(packageJson: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
        const value = packageJson[key];
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }
        for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
            if (typeof version === "string") {
                result[name] = version;
            }
        }
    }
    return result;
}

function runtimeFromPackage(packageJson: Record<string, unknown>): Pick<ScopeEvidence, "runtime" | "confidence" | "reasons"> {
    const dependencies = dependencyMap(packageJson);
    if (dependencies.nuxt || Object.keys(dependencies).some(name => name.startsWith("@nuxt/"))) {
        return {
            runtime: "nuxt",
            confidence: 0.99,
            reasons: ["package depends on Nuxt"],
        };
    }
    if (dependencies["@vitejs/plugin-vue2"] || dependencies["vue-template-compiler"]) {
        return {
            runtime: "legacy-vue",
            confidence: 0.97,
            reasons: ["package uses Vue 2 tooling"],
        };
    }
    const vueVersion = dependencies.vue ?? "";
    if (/(?:^|[^0-9])2(?:\.|$)/.test(vueVersion)) {
        return {
            runtime: "legacy-vue",
            confidence: 0.92,
            reasons: [`package declares Vue 2 (${vueVersion})`],
        };
    }
    if (vueVersion) {
        return {
            runtime: "vue",
            confidence: 0.85,
            reasons: [`package declares Vue (${vueVersion})`],
        };
    }
    return { runtime: "unknown", confidence: 0, reasons: [] };
}

function mergeEvidence(current: ScopeEvidence | undefined, incoming: ScopeEvidence): ScopeEvidence {
    if (!current) {
        return incoming;
    }
    const preferred = incoming.confidence >= current.confidence ? incoming : current;
    return {
        ...preferred,
        packageName: incoming.packageName ?? current.packageName,
        reasons: [...new Set([...current.reasons, ...incoming.reasons])],
        sources: [...new Set([...current.sources, ...incoming.sources])],
    };
}

function inferWorkspace(directory: string, packageName: string | undefined, rootName: string): string {
    if (directory) {
        return directory;
    }
    return packageName ?? rootName;
}

export function discoverProjectScopes(rootDir: string, graphPathPrefix: string = ""): ProjectScope[] {
    const resolvedRoot = path.resolve(rootDir);
    const evidenceByDirectory = new Map<string, ScopeEvidence>();

    function addEvidence(absoluteDirectory: string, evidence: Omit<ScopeEvidence, "directory">): void {
        const relative = relativeDirectory(resolvedRoot, absoluteDirectory);
        if (relative === null) {
            return;
        }
        const incoming: ScopeEvidence = { directory: relative, ...evidence };
        evidenceByDirectory.set(relative, mergeEvidence(evidenceByDirectory.get(relative), incoming));
    }

    function visit(directory: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }

        const packageEntry = entries.find(entry => entry.isFile() && entry.name === "package.json");
        if (packageEntry) {
            const packagePath = path.join(directory, packageEntry.name);
            const packageJson = readJson(packagePath);
            if (packageJson) {
                const detected = runtimeFromPackage(packageJson);
                addEvidence(directory, {
                    packageName: typeof packageJson.name === "string" ? packageJson.name : undefined,
                    ...detected,
                    sources: [normalizePath(path.relative(resolvedRoot, packagePath))],
                });
            }
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isFile() && CONFIG_PATTERN.test(entry.name)) {
                let source = "";
                try {
                    source = fs.readFileSync(fullPath, "utf-8");
                } catch {
                    continue;
                }
                if (entry.name.startsWith("nuxt.config.")) {
                    addEvidence(directory, {
                        runtime: "nuxt",
                        confidence: 1,
                        reasons: ["nearest project contains nuxt.config"],
                        sources: [normalizePath(path.relative(resolvedRoot, fullPath))],
                    });
                } else if (/@vitejs\/plugin-vue2|vue-template-compiler/.test(source)) {
                    addEvidence(directory, {
                        runtime: "legacy-vue",
                        confidence: 0.98,
                        reasons: ["build config uses Vue 2 tooling"],
                        sources: [normalizePath(path.relative(resolvedRoot, fullPath))],
                    });
                }
            }

            if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            visit(fullPath);
        }
    }

    visit(resolvedRoot);
    const prefix = normalizePath(graphPathPrefix);
    const rootName = path.basename(resolvedRoot);

    return [...evidenceByDirectory.values()].map(evidence => {
        const scopedDirectory = [prefix, evidence.directory].filter(Boolean).join("/");
        const packageLikeShared = /^(?:packages|clientPackages)\//.test(evidence.directory);
        const runtime = evidence.runtime === "unknown" && packageLikeShared ? "shared" : evidence.runtime;
        const confidence = runtime === "shared" ? Math.max(evidence.confidence, 0.75) : evidence.confidence;
        const reasons = runtime === "shared" && evidence.runtime === "unknown"
            ? [...evidence.reasons, "package lives in a shared-package workspace"]
            : evidence.reasons;
        return {
            directory: scopedDirectory,
            workspace: inferWorkspace(scopedDirectory, evidence.packageName, rootName),
            packageName: evidence.packageName,
            runtime,
            confidence,
            reasons,
            sources: evidence.sources.map(source => [prefix, source].filter(Boolean).join("/")),
        };
    }).sort((left, right) => right.directory.length - left.directory.length);
}

function inferredWorkspace(file: string): string | null {
    const match = normalizePath(file).match(/^(apps|packages|clientPackages|modules|modulesThirdParty)\/([^/]+)/);
    return match ? `${match[1]}/${match[2]}` : null;
}

export function classifyCodeLocation(
    file: string | null,
    scopes: ProjectScope[] = [],
): CodeLocationClassification {
    if (!file) {
        return { workspace: null, runtime: "unknown", confidence: 0, reasons: ["node has no file"] };
    }

    const normalized = normalizePath(file);
    const scope = scopes
        .filter(candidate =>
            !candidate.directory
            || normalized === candidate.directory
            || normalized.startsWith(`${candidate.directory}/`)
        )
        .sort((left, right) => right.directory.length - left.directory.length)[0];
    const workspace = scope?.workspace ?? inferredWorkspace(normalized);

    if (/\/(?:resources\/assets\/js|legacy)(?:\/|$)/i.test(`/${normalized}`)) {
        return {
            workspace,
            runtime: "legacy-vue",
            confidence: 0.99,
            reasons: ["file is inside a legacy Vue asset tree"],
        };
    }

    if (/\.(?:php|blade\.php)$/i.test(normalized) || /\/(?:app|routes)\//.test(`/${normalized}`)) {
        return {
            workspace,
            runtime: "backend",
            confidence: 0.95,
            reasons: ["file is in a backend PHP path"],
        };
    }

    if (scope && scope.runtime !== "unknown") {
        return {
            workspace,
            runtime: scope.runtime,
            confidence: scope.confidence,
            reasons: scope.reasons,
        };
    }

    if (/^(?:packages|clientPackages)\//.test(normalized)) {
        return {
            workspace,
            runtime: "shared",
            confidence: 0.7,
            reasons: ["file is inside a shared-package tree"],
        };
    }

    return {
        workspace,
        runtime: "unknown",
        confidence: 0,
        reasons: ["no runtime-specific project evidence"],
    };
}
