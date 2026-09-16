import fs from "node:fs";
import path from "node:path";
import { discoverPathAliasScopes, type PathAliasScope } from "./discoverPathAliases";
import { discoverProjectScopes, type ProjectScope } from "../classification/codeLocation";

export interface ScanConfig {
    pathAliases?: Record<string, string>;
    pathAliasScopes?: PathAliasScope[];
    projectScopes?: ProjectScope[];
    httpResourceClassPattern?: string;
    scanRoot?: string;
    graphPathPrefix?: string;
    explicitConfigPath?: string;
}

const DEFAULT_CONFIG: ScanConfig = {
    httpResourceClassPattern: "Resource",
};

export function loadScanConfig(rootDir: string, graphPathPrefix: string = ""): ScanConfig {
    const resolvedRoot = path.resolve(rootDir);
    const candidates = [
        path.join(resolvedRoot, "repo-ranger.config.json"),
        path.join(resolvedRoot, ".repo-ranger.json"),
    ];

    let explicitConfig: Partial<ScanConfig> = {};
    let explicitConfigPath: string | undefined;

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            explicitConfig = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Partial<ScanConfig>;
            explicitConfigPath = candidate;
            break;
        } catch {
            continue;
        }
    }

    return {
        ...DEFAULT_CONFIG,
        ...explicitConfig,
        pathAliasScopes: discoverPathAliasScopes(resolvedRoot),
        projectScopes: discoverProjectScopes(resolvedRoot, graphPathPrefix),
        scanRoot: resolvedRoot,
        graphPathPrefix,
        explicitConfigPath,
    };
}
