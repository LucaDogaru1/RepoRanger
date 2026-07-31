import fs from "node:fs";
import {
    buildSingleRoute,
    expandResourceRoutes,
    RouteDefinition,
} from "./routeExpander";
import { parseUseStatements, resolveControllerClass } from "./parseUseStatements";
import { recordRoutes } from "./recordRoute";

const ROUTE_CALL_PATTERN = /Route::(get|post|put|patch|delete|resource|apiResource)\s*\(/gi;

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
    const arrayMatch = tail.match(new RegExp(`^\\s*->${method}\\s*\\(\\s*\\[([^\\]]+)\\]`));
    if (arrayMatch) {
        const actions = readModifierActionList(arrayMatch[1]!);
        return actions.length > 0 ? actions : undefined;
    }

    const parenMatch = tail.match(new RegExp(`^\\s*->${method}\\s*\\(([^)]+)\\)`));
    if (parenMatch) {
        const actions = readModifierActionList(parenMatch[1]!);
        return actions.length > 0 ? actions : undefined;
    }

    return undefined;
}

function readRouteModifiers(source: string, startIndex: number): { only?: string[]; except?: string[] } {
    const tail = source.slice(startIndex);

    return {
        only: readRouteModifierActions(tail, "only"),
        except: readRouteModifierActions(tail, "except"),
    };
}

function readPrefixFromLine(line: string): string | null {
    const groupMatch = line.match(/['"]prefix['"]\s*=>\s*['"]([^'"]+)['"]/);
    if (groupMatch) {
        return groupMatch[1]!;
    }

    const prefixMatch = line.match(/Route::prefix\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (prefixMatch) {
        return prefixMatch[1]!;
    }

    return null;
}

function prefixAtIndex(source: string, index: number): string {
    const before = source.slice(0, index);
    const stack: string[] = [];
    let depth = 0;

    for (const line of before.split("\n")) {
        const prefix = readPrefixFromLine(line);
        if (prefix !== null) {
            stack[depth] = prefix;
        }

        for (const char of line) {
            if (char === "{") {
                depth += 1;
            } else if (char === "}") {
                depth = Math.max(0, depth - 1);
                stack.length = depth;
            }
        }
    }

    return stack.filter(Boolean).join("/");
}

function parseRouteCall(
    verb: string,
    args: string,
    prefix: string,
    imports: Map<string, string>,
    modifiers: { only?: string[]; except?: string[] }
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
            prefix
        ),
    ];
}

export function extractRoutesFromSource(source: string): RouteDefinition[] {
    const imports = parseUseStatements(source);
    const routes: RouteDefinition[] = [];

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
        const prefix = prefixAtIndex(source, match.index!);
        const modifiers = readRouteModifiers(source, closeIndex);
        const parsed = parseRouteCall(verb, args, prefix, imports, modifiers);
        routes.push(...parsed);
    }

    return routes;
}

export function extractRoutesFromRouteFile(absolutePath: string, relativePath: string): number {
    const source = fs.readFileSync(absolutePath, "utf-8");
    const routes = extractRoutesFromSource(source);
    recordRoutes(routes, relativePath);
    return routes.length;
}
