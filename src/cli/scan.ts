import path from "node:path";
import { createPhpParser } from "../scanner/php/parse/parser";
import { processPhpFiles } from "../scanner/php/pipeline/processPhpFiles";
import { scanPhpFiles, type ScannedPhpFile } from "../scanner/php/scanPhp";
import { createJsParser } from "../scanner/js/parse/parser";
import { processJsFiles } from "../scanner/js/pipeline/processJsFiles";
import { scanJsFiles, type ScannedJsFile } from "../scanner/js/scanJs";
import writeGraphJson from "../persistence/writeGraphJson";
import writeGraphSqlite from "../persistence/writeGraphSqlite";
import chalk from "chalk";
import { loadScanConfig } from "../shared/config/scanRuntime";
import { parseScanCliOptions, scanIgnoreList } from "../shared/utils/scanCli";
import { collectGraphMeta } from "../shared/utils/graphMetaSource";
import { loadGraphJson, mergeGraphs } from "../persistence/loadGraphJson";
import { graph, resetGraph } from "../graph/graph";
import {
    printScanFailureSummary,
    resetScanFailures,
} from "../shared/reporting/scanFailures";
import { createScanProgress } from "../shared/reporting/scanProgress";

const {
    rootDirs,
    outputMode,
    sqlitePath,
    language,
    mergeExistingGraph,
    graphJsonPath,
    includeTests,
} = parseScanCliOptions(process.argv.slice(2));

const multiRoot = rootDirs.length > 1;
const foldersToIgnore = scanIgnoreList({ includeTests });

console.log("scan roots:", rootDirs.join(", "));
console.log("language:", language);
console.log("tests:", includeTests ? "scanned" : "excluded (--exclude-tests)");
console.log(chalk.blue.bold("🔍 Starting directory scan...\n"));

resetGraph();
resetScanFailures();

function pathPrefixForRoot(rootDir: string): string {
    if (!multiRoot) {
        return "";
    }

    return `${path.basename(rootDir.replace(/\/$/, ""))}/`;
}

function prefixRelativePaths<T extends { relativePath: string }>(
    files: T[],
    prefix: string
): T[] {
    if (!prefix) {
        return files;
    }

    return files.map(file => ({
        ...file,
        relativePath: `${prefix}${file.relativePath}`,
    }));
}

if (language === "php" || language === "both") {
    const phpParser = createPhpParser();
    const phpFiles: ScannedPhpFile[] = [];

    for (const rootDir of rootDirs) {
        const prefix = pathPrefixForRoot(rootDir);
        const discoverProgress = createScanProgress({ label: "Finding PHP files" });
        discoverProgress.start();
        const files = prefixRelativePaths(scanPhpFiles(rootDir, foldersToIgnore), prefix);
        discoverProgress.done(chalk.cyan(`PHP files (${rootDir}): ${files.length}`));
        phpFiles.push(...files);
    }

    processPhpFiles(phpFiles, phpParser);
    console.log(chalk.green("✅ finished PHP walk"));
}

if (language === "js" || language === "both") {
    const jsParser = createJsParser();

    for (let index = 0; index < rootDirs.length; index += 1) {
        const rootDir = rootDirs[index]!;
        const prefix = pathPrefixForRoot(rootDir);
        const scanConfig = loadScanConfig(rootDir, prefix);

        for (const scope of scanConfig.projectScopes ?? []) {
            const scopeId = `project_scope:${scope.directory || path.basename(rootDir)}`;
            graph.nodes.set(scopeId, {
                id: scopeId,
                type: "project_scope",
                name: scope.workspace,
                workspace: scope.workspace,
                packageName: scope.packageName,
                runtime: scope.runtime,
                runtimeConfidence: scope.confidence,
                runtimeReasons: scope.reasons,
                sources: scope.sources,
                scopeDirectory: scope.directory,
                description: `${scope.runtime} project scope (${scope.confidence.toFixed(2)} confidence)`,
            });
        }

        if (scanConfig.pathAliases && Object.keys(scanConfig.pathAliases).length > 0) {
            console.log(`scan config (${rootDir}): explicit path aliases loaded`);
        }
        if (scanConfig.pathAliasScopes && scanConfig.pathAliasScopes.length > 0) {
            const aliasCount = scanConfig.pathAliasScopes.reduce(
                (total, scope) => total + Object.keys(scope.pathAliases).length,
                0
            );
            console.log(
                `scan config (${rootDir}): auto-detected ${aliasCount} path aliases ` +
                `in ${scanConfig.pathAliasScopes.length} scope(s)`
            );
        }

        const discoverProgress = createScanProgress({ label: "Finding JS files" });
        discoverProgress.start();
        const jsFiles = prefixRelativePaths(scanJsFiles(rootDir, foldersToIgnore), prefix);
        discoverProgress.done(chalk.cyan(`JS files (${rootDir}): ${jsFiles.length}`));

        processJsFiles(jsFiles, jsParser, {
            resetHttpResourceRegistry: index === 0,
            linkCrossLanguageEndpoints: index === rootDirs.length - 1,
        });
    }

    console.log(chalk.green("✅ finished JS walk"));
}

if (mergeExistingGraph) {
    const mergeProgress = createScanProgress({ label: "Merging graph" });
    mergeProgress.start();
    const loadedGraph = loadGraphJson(graphJsonPath);
    mergeGraphs(graph, loadedGraph);
    mergeProgress.done();
}

console.log(chalk.blue(`Graph size: ${graph.nodes.size} nodes, ${graph.edges.size} edges`));
printScanFailureSummary();

if (outputMode === "json" || outputMode === "both") {
    const writeProgress = createScanProgress({ label: "Writing Graph.json" });
    writeProgress.start();
    writeGraphJson(graphJsonPath);
    writeProgress.done(chalk.green(`Wrote ${graphJsonPath}`));
}

if (outputMode === "sqlite" || outputMode === "both") {
    const writeProgress = createScanProgress({ label: "Writing SQLite" });
    writeProgress.start();
    writeGraphSqlite(sqlitePath, collectGraphMeta({
        rootDirs,
        includeTests,
        language,
        nodeCount: graph.nodes.size,
        edgeCount: graph.edges.size,
    }));
    writeProgress.done(chalk.green(`Wrote ${sqlitePath}`));
}
