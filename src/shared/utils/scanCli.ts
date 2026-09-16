import path from "node:path";
import { getOptionValue } from "../../cli/shared/cliArgs";
import { OutputMode, ScanCliOptions, ScanLanguage } from "../types/scanCli";

export const DEFAULT_SCAN_IGNORE = [
    "vendor", "node_modules", "cache", "logs",
    "bin", "bootstrap", "build", "docker", "docs",
    "storage", "artisan", "composer.json", "composer.lock", "package.json", "package-lock.json",
    "boost.json", "certs",
];

export const TEST_SCAN_IGNORE = [
    "test", "tests", "__tests__", "__test__", "spec", "specs", "e2e", "cypress", "playwright", "k6",
];

export function scanIgnoreList(options: { includeTests: boolean }): string[] {
    return options.includeTests
        ? DEFAULT_SCAN_IGNORE
        : [...DEFAULT_SCAN_IGNORE, ...TEST_SCAN_IGNORE];
}

function parseLanguage(value: string | undefined): ScanLanguage {
    if (value === "php" || value === "js" || value === "both") {
        return value;
    }
    return "both";
}

export function parseScanCliOptions(argv: string[]): ScanCliOptions {
    const rootDirs: string[] = [];
    let outputMode: OutputMode = "json";
    let sqlitePath = "sqlite/Graph.sqlite";
    let language: ScanLanguage = "both";
    let mergeExistingGraph = true;
    let graphJsonPath = "Graph.json";
    const includeTests = !argv.includes("--exclude-tests");

    const outputModeArg = getOptionValue(argv, "--output") as OutputMode | undefined;
    if (outputModeArg === "json" || outputModeArg === "sqlite" || outputModeArg === "both") {
        outputMode = outputModeArg;
    }

    const sqlitePathArg = getOptionValue(argv, "--sqlite-path");
    if (sqlitePathArg) {
        sqlitePath = sqlitePathArg;
    }

    language = parseLanguage(getOptionValue(argv, "--lang"));

    const graphJsonPathArg = getOptionValue(argv, "--graph-json");
    if (graphJsonPathArg) {
        graphJsonPath = graphJsonPathArg;
    }

    if (argv.includes("--no-merge")) {
        mergeExistingGraph = false;
    }

    for (const arg of argv) {
        if (!arg.startsWith("--")) {
            rootDirs.push(path.resolve(arg));
        }
    }

    if (rootDirs.length === 0) {
        rootDirs.push(process.cwd());
    }

    return {
        rootDirs,
        rootDir: rootDirs[0]!,
        outputMode,
        sqlitePath,
        language,
        mergeExistingGraph,
        graphJsonPath,
        includeTests,
    };
}
