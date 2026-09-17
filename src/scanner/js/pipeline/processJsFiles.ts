import Parser from "tree-sitter";
import fs from "node:fs";
import { linkCrossLanguageEndpoints } from "../linking/crossLanguageEndpoints";
import { extractHttpResourcesFromSource } from "../resolvers/httpResourceRegexExtractor";
import { resetHttpResourceRegistry } from "../resolvers/httpResourceRegistry";
import { ensureJsModuleNode } from "../astHandlers/jsModule";
import { ScannedJsFile } from "../scanJs";
import { stripTypescript } from "../nuxt/stripTypescript";
import { createTsParser, createTsxParser } from "../ts/parser";
import { processTsFile } from "../ts/processTsFile";
import { processVueFile } from "../vue/processVueFile";
import walk, { createWalkContext } from "../walk/jsWalker";
import { errorDetail, recordScanFailure } from "../../../shared/reporting/scanFailures";
import { createScanProgress } from "../../../shared/reporting/scanProgress";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";
import { pruneUnresolvedJsCalls } from "../resolvers/pruneUnresolvedCalls";

function isVueFile(relativePath: string): boolean {
    return relativePath.endsWith(".vue");
}

function isTypeScriptFile(relativePath: string): boolean {
    return relativePath.endsWith(".ts") || relativePath.endsWith(".tsx");
}

function isTsxFile(relativePath: string): boolean {
    return relativePath.endsWith(".tsx");
}

function readSource(file: ScannedJsFile): string {
    return fs.readFileSync(file.absolutePath, "utf-8");
}

function readJsFallbackSource(file: ScannedJsFile): string {
    const rawSource = readSource(file);
    return isTypeScriptFile(file.relativePath) ? stripTypescript(rawSource) : rawSource;
}

function populateHttpResourceRegistry(files: ScannedJsFile[]): void {
    for (const file of files) {
        if (isVueFile(file.relativePath)) {
            continue;
        }

        const source = readSource(file);
        extractHttpResourcesFromSource(source, ensureJsModuleNode(file.relativePath));
    }
}

function walkJsSource(source: string, relativePath: string, parser: Parser): void {
    const tree = parseTreeSitterSource(parser, source);

    if (tree.rootNode.hasError) {
        throw new Error(`parse errors in ${relativePath}`);
    }

    const context = createWalkContext(relativePath);
    walk(tree.rootNode, relativePath, context);
}

function recoverHttpResources(source: string, relativePath: string): number {
    return extractHttpResourcesFromSource(source, ensureJsModuleNode(relativePath));
}

export function processJsFiles(
    files: ScannedJsFile[],
    parser: Parser,
    options?: { resetHttpResourceRegistry?: boolean; linkCrossLanguageEndpoints?: boolean }
): void {
    if (options?.resetHttpResourceRegistry !== false) {
        resetHttpResourceRegistry();
    }
    populateHttpResourceRegistry(files);

    const tsParser = createTsParser();
    const tsxParser = createTsxParser();
    let vueFiles = 0;
    let vueTsScripts = 0;
    let vueStripFallbackScripts = 0;
    let tsFiles = 0;
    let tsFallbackFiles = 0;

    const jsProgress = createScanProgress({ label: "JS", total: files.length });
    jsProgress.start();

    for (const file of files) {
        if (isVueFile(file.relativePath)) {
            try {
                const result = processVueFile(file, { jsParser: parser, tsParser });
                vueFiles += 1;
                if (result.usedTsParser) {
                    vueTsScripts += 1;
                } else if (result.usedStripFallback) {
                    vueStripFallbackScripts += 1;
                }
                if (result.parseError) {
                    recordScanFailure({
                        file: file.relativePath,
                        reason: "vue_parse_error",
                        detail: "tree-sitter hasError",
                    });
                }
            } catch (error) {
                recordScanFailure({
                    file: file.relativePath,
                    reason: "vue_parser_crash",
                    detail: errorDetail(error),
                });
            }
            jsProgress.tick(file.relativePath);
            continue;
        }

        if (isTypeScriptFile(file.relativePath)) {
            try {
                processTsFile(file, isTsxFile(file.relativePath) ? tsxParser : tsParser);
                tsFiles += 1;
            } catch (error) {
                try {
                    walkJsSource(readJsFallbackSource(file), file.relativePath, parser);
                    tsFallbackFiles += 1;
                } catch (fallbackError) {
                    const recovered = recoverHttpResources(readSource(file), file.relativePath);
                    if (recovered === 0) {
                        recordScanFailure({
                            file: file.relativePath,
                            reason: "ts_parse_failed",
                            detail: errorDetail(error) ?? errorDetail(fallbackError),
                        });
                    }
                }
            }
            jsProgress.tick(file.relativePath);
            continue;
        }

        try {
            walkJsSource(readSource(file), file.relativePath, parser);
        } catch (error) {
            const recovered = recoverHttpResources(readSource(file), file.relativePath);
            if (recovered === 0) {
                recordScanFailure({
                    file: file.relativePath,
                    reason: "js_parse_error",
                    detail: errorDetail(error),
                });
            }
        }
        jsProgress.tick(file.relativePath);
    }

    jsProgress.done();

    if (vueFiles > 0) {
        console.log(`Parsed ${vueFiles} Vue SFC files`);
    }

    if (vueTsScripts > 0) {
        console.log(`Parsed ${vueTsScripts} Vue <script lang="ts"> blocks (tree-sitter-typescript)`);
    }

    if (vueStripFallbackScripts > 0) {
        console.log(`Parsed ${vueStripFallbackScripts} Vue TS scripts via strip fallback`);
    }

    if (tsFiles > 0) {
        console.log(`Parsed ${tsFiles} TypeScript files (tree-sitter-typescript)`);
    }

    if (tsFallbackFiles > 0) {
        console.log(`Parsed ${tsFallbackFiles} TypeScript files via strip fallback`);
    }

    if (options?.linkCrossLanguageEndpoints !== false) {
        const linkProgress = createScanProgress({ label: "JS link" });
        linkProgress.start();
        const linkStats = linkCrossLanguageEndpoints();
        const prunedCalls = pruneUnresolvedJsCalls();
        linkProgress.done();

        if (linkStats.canonicalized > 0 || linkStats.merged > 0 || linkStats.backendLinked > 0) {
            console.log(
                `Cross-language endpoints: ${linkStats.canonicalized} canonicalized, ` +
                `${linkStats.merged} merged, ${linkStats.backendLinked} linked to PHP backend`
            );
        }
        if (prunedCalls > 0) {
            console.log(`Pruned ${prunedCalls} unresolved JS call edges`);
        }
    }
}
