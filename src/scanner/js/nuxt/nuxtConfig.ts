import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import { createTsParser } from "../ts/parser";

export const NUXT_CONFIG_FILE = /(^|\/)nuxt\.config\.(ts|js|mjs|mts)$/;

export const DYNAMIC = Symbol("dynamic");
export type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal } | typeof DYNAMIC;

export interface NuxtLayerConfig {
    layerDir: string;
    srcDir: string | typeof DYNAMIC;
    alias: Literal | undefined;
    components: Literal | undefined;
    extends: Literal | undefined;
}

export function nuxtLayerDirectories(relativePaths: string[]): string[] {
    return relativePaths
        .filter(file => NUXT_CONFIG_FILE.test(file))
        .map(file => file.slice(0, file.lastIndexOf("/") + 1));
}

export function layerDirectoryOf(file: string, layerDirs: Iterable<string>): string | undefined {
    let match: string | undefined;
    for (const dir of layerDirs) {
        if (file.startsWith(dir) && (!match || dir.length > match.length)) {
            match = dir;
        }
    }
    return match;
}

function stringValue(node: Parser.SyntaxNode): Literal {
    if (node.type === "template_string") {
        return node.namedChildren.some(child => child.type === "template_substitution")
            ? DYNAMIC
            : node.text.slice(1, -1);
    }
    const fragments = node.namedChildren.filter(child => child.type === "string_fragment");
    return fragments.map(fragment => fragment.text).join("");
}

function conditionalSpreadKeys(node: Parser.SyntaxNode | undefined): string[] | null {
    if (!node) return null;
    if (node.type === "parenthesized_expression") return conditionalSpreadKeys(node.namedChildren[0]);
    if (node.type === "object") {
        const value = evaluate(node);
        return value !== DYNAMIC && value !== null && typeof value === "object" && !Array.isArray(value)
            ? Object.keys(value)
            : null;
    }
    if (node.type === "ternary_expression") {
        const consequence = conditionalSpreadKeys(node.childForFieldName("consequence") ?? undefined);
        const alternative = conditionalSpreadKeys(node.childForFieldName("alternative") ?? undefined);
        return consequence && alternative ? [...consequence, ...alternative] : null;
    }
    return null;
}

function evaluate(node: Parser.SyntaxNode): Literal {
    switch (node.type) {
        case "string":
        case "template_string":
            return stringValue(node);
        case "number":
            return Number(node.text);
        case "true":
            return true;
        case "false":
            return false;
        case "null":
            return null;
        case "parenthesized_expression":
        case "as_expression":
        case "satisfies_expression":
            return node.namedChildren[0] ? evaluate(node.namedChildren[0]) : DYNAMIC;
        case "array": {
            const items: Literal[] = [];
            for (const child of node.namedChildren) {
                if (child.type === "comment") continue;
                if (child.type === "spread_element") return DYNAMIC;
                items.push(evaluate(child));
            }
            return items;
        }
        case "object": {
            const result: { [key: string]: Literal } = {};
            for (const child of node.namedChildren) {
                if (child.type === "comment") continue;
                if (child.type === "spread_element") {
                    const keys = conditionalSpreadKeys(child.namedChildren[0]);
                    if (!keys) return DYNAMIC;
                    keys.forEach(key => { result[key] = DYNAMIC; });
                    continue;
                }
                if (child.type === "shorthand_property_identifier") {
                    result[child.text] = DYNAMIC;
                    continue;
                }
                if (child.type === "method_definition") {
                    const name = child.childForFieldName("name");
                    if (!name || name.type === "computed_property_name") return DYNAMIC;
                    result[name.type === "string" ? String(stringValue(name)) : name.text] = DYNAMIC;
                    continue;
                }
                if (child.type !== "pair") return DYNAMIC;
                const keyNode = child.childForFieldName("key");
                const valueNode = child.childForFieldName("value");
                if (!keyNode || !valueNode) return DYNAMIC;
                const key = keyNode.type === "string" ? stringValue(keyNode) : keyNode.text;
                if (typeof key !== "string" || keyNode.type === "computed_property_name") return DYNAMIC;
                result[key] = evaluate(valueNode);
            }
            return result;
        }
        default:
            return DYNAMIC;
    }
}

function findConfigObject(root: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let found: Parser.SyntaxNode | null = null;
    const visit = (node: Parser.SyntaxNode): void => {
        if (found) return;
        if (node.type === "call_expression" && node.childForFieldName("function")?.text === "defineNuxtConfig") {
            found = node.childForFieldName("arguments")?.namedChildren.find(arg => arg.type === "object") ?? null;
            return;
        }
        if (node.type === "export_statement") {
            const value = node.childForFieldName("value") ?? node.namedChildren.find(child => child.type === "object");
            if (value?.type === "object") {
                found = value;
                return;
            }
        }
        node.namedChildren.forEach(visit);
    };
    visit(root);
    return found;
}

function defaultSrcDir(layerDir: string, relativePaths: string[]): string {
    const appDir = `${layerDir}app/`;
    return relativePaths.some(file => file.startsWith(appDir)) ? appDir : layerDir;
}

export function readNuxtLayerConfig(
    absolutePath: string,
    relativePath: string,
    relativePaths: string[],
): NuxtLayerConfig {
    const layerDir = relativePath.slice(0, relativePath.lastIndexOf("/") + 1);
    const unknown: NuxtLayerConfig = {
        layerDir,
        srcDir: defaultSrcDir(layerDir, relativePaths),
        alias: DYNAMIC,
        components: DYNAMIC,
        extends: DYNAMIC,
    };

    let source: string;
    try {
        source = fs.readFileSync(absolutePath, "utf8");
    } catch {
        return unknown;
    }

    const configObject = findConfigObject(createTsParser().parse(source).rootNode);
    if (!configObject) return unknown;

    const config = evaluate(configObject);
    if (config === DYNAMIC || typeof config !== "object" || config === null || Array.isArray(config)) {
        return unknown;
    }

    const srcDir = config.srcDir;
    return {
        layerDir,
        srcDir: typeof srcDir === "string"
            ? path.posix.normalize(`${layerDir}${srcDir}`).replace(/\/?$/, "/")
            : srcDir === undefined ? defaultSrcDir(layerDir, relativePaths) : DYNAMIC,
        alias: config.alias,
        components: config.components,
        extends: config.extends,
    };
}
