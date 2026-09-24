import fs from "node:fs";
import {
    buildSingleRoute,
    expandResourceRoutes,
    RouteDefinition,
} from "./routeExpander";
import { parseUseStatements, resolveControllerClass } from "./parseUseStatements";
import { recordRoutes } from "./recordRoute";

const ROUTE_CALL_PATTERN = /Route::(get|post|put|patch|delete|resource|apiResource)\s*\(/gi;

interface RouteModifiers {
    only?: string[];
    except?: string[];
    middleware?: string[];
}

interface RouteGroupContext {
    start: number;
    end: number;
    prefix: string;
    middleware: string[];
}

export function isRouteFile(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    return /(?:^|\/)routes\/[^/]+\.php$/i.test(normalized);
}

function extractBalancedParentheses(source: string, openIndex: number): string | null {
    if (source[openIndex] !== "(") {
        return null;
    }

    let depth = 0;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];

        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(openIndex + 1, index);
            }
        }
    }

    return null;
}

function normalizeRouteVerb(verb: string): string {
    return verb.toLowerCase();
}

function isResourceVerb(verb: string): boolean {
    const normalized = normalizeRouteVerb(verb);
    return normalized === "resource" || normalized === "apiresource";
}

function resourceVerbForExpander(verb: string): "resource" | "apiResource" {
    return normalizeRouteVerb(verb) === "apiresource" ? "apiResource" : "resource";
}

function readStringLiterals(value: string): string[] {
    const strings: string[] = [];

    for (const match of value.matchAll(/(['"])(?:\\.|(?!\1)[^\\])*\1/g)) {
        strings.push(match[0].slice(1, -1));
    }

    return strings;
}

function readControllerReference(
    value: string,
    imports: Map<string, string>
): { controller: string; action: string } | null {
    const arrayMatch = value.match(/\[([A-Za-z0-9_\\]+)::class,\s*['"]([^'"]+)['"]\s*\]/);
    if (arrayMatch) {
        return {
            controller: resolveControllerClass(arrayMatch[1]!, imports),
            action: arrayMatch[2]!,
        };
    }

    const classMatch = value.match(/([A-Za-z0-9_\\]+)::class/);
    if (classMatch) {
        return {
            controller: resolveControllerClass(classMatch[1]!, imports),
            action: "__invoke",
        };
    }

    return null;
}

function readModifierActionList(raw: string): string[] {
    return [...raw.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!);
}

function readRouteModifierActions(tail: string, method: "only" | "except"): string[] | undefined {
    const arrayMatch = tail.match(new RegExp(`->${method}\\s*\\(\\s*\\[([^\\]]+)\\]`));
    if (arrayMatch) {
        const actions = readModifierActionList(arrayMatch[1]!);
        return actions.length > 0 ? actions : undefined;
    }

    const parenMatch = tail.match(new RegExp(`->${method}\\s*\\(([^)]+)\\)`));
    if (parenMatch) {
        const actions = readModifierActionList(parenMatch[1]!);
        return actions.length > 0 ? actions : undefined;
    }

    return undefined;
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function readMiddlewareArguments(value: string, imports: Map<string, string>): string[] {
    const strings = readStringLiterals(value);
    const classes = [...value.matchAll(/([A-Za-z_][A-Za-z0-9_\\]*)::class/g)]
        .map(match => resolveControllerClass(match[1]!, imports));
    return unique([...strings, ...classes]);
}

function readMiddlewareCalls(value: string, imports: Map<string, string>): string[] {
    const middleware: string[] = [];
    const pattern = /(?:Route::|->)middleware\s*\(/gi;

    for (const match of value.matchAll(pattern)) {
        const openIndex = match.index! + match[0].length - 1;
        const args = extractBalancedParentheses(value, openIndex);
        if (args !== null) {
            middleware.push(...readMiddlewareArguments(args, imports));
        }
    }

    return unique(middleware);
}

function readRouteModifiers(
    source: string,
    startIndex: number,
    imports: Map<string, string>
): RouteModifiers {
    const semicolon = source.indexOf(";", startIndex);
    const tail = source.slice(startIndex, semicolon >= 0 ? semicolon + 1 : source.length);

    return {
        only: readRouteModifierActions(tail, "only"),
        except: readRouteModifierActions(tail, "except"),
        middleware: readMiddlewareCalls(tail, imports),
    };
}

function readGroupPrefix(header: string): string {
    const prefixes: string[] = [];
    const chainedPattern = /(?:Route::|->)prefix\s*\(\s*(['"])([^'"]+)\1\s*\)/gi;
    for (const match of header.matchAll(chainedPattern)) {
        prefixes.push(match[2]!);
    }

    const arrayMatch = header.match(/['"]prefix['"]\s*=>\s*['"]([^'"]+)['"]/i);
    if (arrayMatch) {
        prefixes.push(arrayMatch[1]!);
    }

    return prefixes.join("/");
}

function readGroupMiddleware(header: string, imports: Map<string, string>): string[] {
    const middleware = readMiddlewareCalls(header, imports);
    const arrayMatch = header.match(
        /['"]middleware['"]\s*=>\s*(\[[\s\S]*?\]|['"][^'"]+['"]|[A-Za-z_][A-Za-z0-9_\\]*::class)/i
    );
    if (arrayMatch) {
        middleware.push(...readMiddlewareArguments(arrayMatch[1]!, imports));
    }
    return unique(middleware);
}

function findMatchingBrace(source: string, openIndex: number): number | null {
    let depth = 0;
    let quote: "'" | '"' | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index]!;
        const next = source[index + 1];

        if (lineComment) {
            if (char === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === "*" && next === "/") {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
        } else if ((char === "/" && next === "/") || char === "#") {
            lineComment = true;
            if (char === "/") index += 1;
        } else if (char === "/" && next === "*") {
            blockComment = true;
            index += 1;
        } else if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return null;
}

function collectRouteGroups(source: string, imports: Map<string, string>): RouteGroupContext[] {
    const groups: RouteGroupContext[] = [];

    for (const routeStart of source.matchAll(/Route::/g)) {
        const start = routeStart.index!;
        const remaining = source.slice(start);
        const groupMatch = remaining.match(/(?:Route::group|->group)\s*\(/i);
        if (!groupMatch || groupMatch.index === undefined) continue;

        const groupIndex = start + groupMatch.index;
        const semicolon = source.indexOf(";", start);
        if (semicolon >= 0 && semicolon < groupIndex) continue;

        const functionIndex = source.indexOf("function", groupIndex);
        if (functionIndex < 0 || (semicolon >= 0 && semicolon < functionIndex)) continue;

        const openBrace = source.indexOf("{", functionIndex);
        if (openBrace < 0) continue;
        const closeBrace = findMatchingBrace(source, openBrace);
        if (closeBrace === null) continue;

        const header = source.slice(start, openBrace);
        groups.push({
            start: openBrace,
            end: closeBrace,
            prefix: readGroupPrefix(header),
            middleware: readGroupMiddleware(header, imports),
        });
    }

    return groups.sort((a, b) => a.start - b.start);
}

function groupContextAtIndex(groups: RouteGroupContext[], index: number): { prefix: string; middleware: string[] } {
    const active = groups.filter(group => group.start < index && index < group.end);
    return {
        prefix: active.map(group => group.prefix).filter(Boolean).join("/"),
        middleware: unique(active.flatMap(group => group.middleware)),
    };
}

function parseRouteCall(
    verb: string,
    args: string,
    prefix: string,
    imports: Map<string, string>,
    modifiers: RouteModifiers
): RouteDefinition[] {
    const strings = readStringLiterals(args);
    const controllerRef = readControllerReference(args, imports);

    if (!controllerRef) {
        return [];
    }

    if (isResourceVerb(verb)) {
        const basePath = strings[0] ?? "";
        if (!basePath) {
            return [];
        }

        return expandResourceRoutes(
            resourceVerbForExpander(verb),
            basePath,
            controllerRef.controller,
            prefix,
            modifiers
        );
    }

    const path = strings[0];
    if (!path) {
        return [];
    }

    const action = controllerRef.action;

    return [
        buildSingleRoute(
            verb,
            path,
            controllerRef.controller,
            action,
            prefix,
            modifiers.middleware
        ),
    ];
}

export function extractRoutesFromSource(source: string, mountPrefix = ""): RouteDefinition[] {
    const imports = parseUseStatements(source);
    const routes: RouteDefinition[] = [];
    const groups = collectRouteGroups(source, imports);

    for (const match of source.matchAll(ROUTE_CALL_PATTERN)) {
        const verb = match[1]?.toLowerCase();
        if (!verb) {
            continue;
        }

        const openIndex = match.index! + match[0].length - 1;
        const args = extractBalancedParentheses(source, openIndex);
        if (!args) {
            continue;
        }

        const closeIndex = openIndex + args.length + 2;
        const group = groupContextAtIndex(groups, match.index!);
        const modifiers = readRouteModifiers(source, closeIndex, imports);
        modifiers.middleware = unique([...group.middleware, ...(modifiers.middleware ?? [])]);
        const prefix = [mountPrefix, group.prefix].filter(Boolean).join("/");
        const parsed = parseRouteCall(verb, args, prefix, imports, modifiers);
        routes.push(...parsed);
    }

    return routes;
}

export function extractRoutesFromRouteFile(
    absolutePath: string,
    relativePath: string,
    mountPrefix?: string,
): number {
    const source = fs.readFileSync(absolutePath, "utf-8");
    const routes = extractRoutesFromSource(source, mountPrefix ?? "");
    recordRoutes(routes, relativePath, mountPrefix);
    return routes.length;
}
