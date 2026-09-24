import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { resolveClassName } from "../../resolvers/resolveClassName";
import { lookupMethodTarget, resolveStaticClassName } from "../../resolvers/lookupMethodOnType";
import { graph } from "../../../../graph/graph";
import { configReferenceType } from "./configReference";
import { isConfigFacadeGetCall } from "./functionCallExpression";
import {
    buildSingleRoute,
    expandResourceRoutes,
} from "../../routes/routeExpander";
import { resolveControllerClass } from "../../routes/parseUseStatements";
import { recordRoutes } from "../../routes/recordRoute";
import { classifyFileRole } from "../../../../shared/classification/fileRole";

export function scopedCallExpressionType(
    rootNodeChild: Parser.SyntaxNode,
    context: WalkContext,
    file?: string
): void {
    if (isRouteCall(rootNodeChild)) {
        if (classifyFileRole(file) !== "test") {
            handleRouteCall(rootNodeChild, context, file);
        }
        return;
    }

    const rawClass = rootNodeChild.children.find(child => child.type === "name")?.text;
    if (rawClass === "config") {
        configReferenceType(rootNodeChild, context);
    } else if (isConfigFacadeGetCall(rootNodeChild)) {
        configReferenceType(rootNodeChild, context);
    }

    handleStaticCall(rootNodeChild, context);
}

function handleStaticCall(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const currentMethod = context.currentMethod ?? "";
    const targetMethodName = node.childForFieldName("name")?.text
        ?? node.children.find(child => child.type === "name")?.text;
    const relativeScope = node.children.find(child => child.type === "relative_scope")?.text;
    const classNameNode = node.children.find(
        child => child.type === "name" && child.text !== targetMethodName
    );

    if (!currentMethod || !targetMethodName) {
        return;
    }

    let resolvedClass: string | undefined;

    if (relativeScope === "self" || relativeScope === "static") {
        resolvedClass = context.currentClass;
    } else if (relativeScope === "parent") {
        resolvedClass = context.currentClass
            ? resolveStaticClassName("parent", context)
            : undefined;
    } else if (classNameNode) {
        resolvedClass = resolveClassName(classNameNode.text, context);
    } else {
        return;
    }

    if (!resolvedClass) {
        return;
    }

    const targetMethod = lookupMethodTarget(resolvedClass, targetMethodName);

    if (!targetMethod) {
        return;
    }

    const edgeId = `${currentMethod}->${targetMethod}`;
    const previous = graph.edges.get(edgeId);
    const receiver = targetMethod.startsWith(`${resolvedClass}::`) ? undefined : resolvedClass;
    const receiverIsUnambiguous = receiver && (!previous || previous.via === receiver);

    graph.edges.set(edgeId, {
        from: currentMethod,
        to: targetMethod,
        type: "CALLS",
        callType: "STATIC",
        ...(receiverIsUnambiguous ? { via: receiver } : {}),
    });

    resolveStaticCallArgumentFlows(node, context, targetMethod);
}

function resolveStaticCallArgumentFlows(
    node: Parser.SyntaxNode,
    context: WalkContext,
    targetMethod: string
): void {
    if (!context.currentMethod) return;

    const args = node.childForFieldName("arguments");
    if (!args) return;

    args.namedChildren.forEach((arg, index) => {
        resolveDirectParameterArgument(arg, context, targetMethod, index);
        resolveArrayArgumentFlows(arg, context, targetMethod, index);
    });
}

function resolveDirectParameterArgument(
    arg: Parser.SyntaxNode,
    context: WalkContext,
    targetMethod: string,
    argumentIndex: number
): void {
    if (!context.currentMethod) return;

    const variableName = getRootVariableName(arg.text);
    if (!variableName) return;

    const sourceParameterId = `${context.currentMethod}::${variableName}`;

    if (!graph.nodes.has(sourceParameterId)) return;

    graph.edges.set(
        `${sourceParameterId}->${targetMethod}:FLOWS_TO:${argumentIndex}`,
        {
            from: sourceParameterId,
            to: targetMethod,
            type: "FLOWS_TO",
            via: variableName,
            argumentIndex,
            confidence: 1,
            reason: "Static call argument forwards current method parameter",
        }
    );
}

function resolveArrayArgumentFlows(
    arg: Parser.SyntaxNode,
    context: WalkContext,
    targetMethod: string,
    argumentIndex: number
): void {
    if (!context.currentMethod) return;

    const arrayAccesses = findArrayAccesses(arg);

    for (const access of arrayAccesses) {
        const sourceParameterId = `${context.currentMethod}::${access.variable}`;

        if (!graph.nodes.has(sourceParameterId)) continue;

        graph.edges.set(
            `${sourceParameterId}->${targetMethod}:FLOWS_TO:${argumentIndex}:${access.path}`,
            {
                from: sourceParameterId,
                to: targetMethod,
                type: "FLOWS_TO",
                via: `${access.variable}.${access.path}`,
                argumentIndex,
                confidence: 0.9,
                reason: "Static call array argument reads from current method parameter field",
            }
        );
    }
}

function findArrayAccesses(
    node: Parser.SyntaxNode
): Array<{ variable: string; path: string }> {
    const result: Array<{ variable: string; path: string }> = [];

    function walk(current: Parser.SyntaxNode): void {
        if (current.type === "subscript_expression") {
            const variable = getRootVariableName(current.text);
            const path = extractSubscriptPath(current.text);

            if (variable && path) {
                result.push({ variable, path });
            }
        }

        for (const child of current.namedChildren) {
            walk(child);
        }
    }

    walk(node);

    return result;
}

function extractSubscriptPath(value: string): string {
    const matches = value.match(/\[['"]([^'"]+)['"]\]/g);

    if (!matches) return "";

    return matches
        .map(match =>
            match
                .replace(/^\[['"]/, "")
                .replace(/['"]]$/, "")
        )
        .join(".");
}

function getRootVariableName(value: string): string | null {
    const match = value.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/);
    return match?.[0] ?? null;
}

function isRouteCall(node: Parser.SyntaxNode): boolean {
    const names = node.children
        .filter(child => child.type === "name")
        .map(child => child.text);

    return names[0] === "Route";
}

function isResourceVerb(verb: string): boolean {
    return verb === "resource" || verb === "apiresource";
}

const ROUTE_REGISTRATION_VERBS = new Set(["get", "post", "put", "patch", "delete", "options", "any", "resource", "apiresource"]);

function handleRouteCall(node: Parser.SyntaxNode, context: WalkContext, file?: string): void {
    const names = node.children
        .filter(child => child.type === "name")
        .map(child => child.text);

    const verb = names[1]?.toLowerCase();
    if (!verb || !ROUTE_REGISTRATION_VERBS.has(verb)) {
        return;
    }

    const imports = context.imports;
    const strings = collectStrings(node);
    const controllerRef = readControllerReferenceFromNode(node, imports);
    const modifiers = readRouteModifiersFromText(node.text, imports);

    if (!controllerRef) {
        return;
    }

    if (isResourceVerb(verb)) {
        const basePath = strings[0];
        if (!basePath) {
            return;
        }

        recordRoutes(
            expandResourceRoutes(
                verb.toLowerCase() === "apiresource" ? "apiResource" : "resource",
                basePath,
                controllerRef.controller,
                "",
                modifiers
            ),
            file
        );
        return;
    }

    const path = strings[0];
    if (!path) {
        return;
    }

    const action = controllerRef.action;

    recordRoutes([
        buildSingleRoute(
            verb,
            path,
            controllerRef.controller,
            action,
            "",
            modifiers.middleware
        ),
    ], file);
}

function readControllerReferenceFromNode(
    node: Parser.SyntaxNode,
    imports: Map<string, string>
): { controller: string; action: string } | null {
    const className = findControllerClass(node);
    if (!className) {
        return null;
    }

    const resolved = resolveControllerClass(className, imports);
    const strings = collectStrings(node);
    const arrayAction = strings.find(value =>
        value !== strings[0] &&
        !value.includes("/") &&
        !value.includes("\\")
    );

    return {
        controller: resolved,
        action: arrayAction ?? "__invoke",
    };
}

function readRouteModifiersFromText(
    text: string,
    imports: Map<string, string>
): { only?: string[]; except?: string[]; middleware?: string[] } {
    const readActions = (raw: string): string[] =>
        [...raw.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]!);

    const readMethod = (method: "only" | "except"): string[] | undefined => {
        const arrayMatch = text.match(new RegExp(`->${method}\\s*\\(\\s*\\[([^\\]]+)\\]`));
        if (arrayMatch) {
            const actions = readActions(arrayMatch[1]!);
            return actions.length > 0 ? actions : undefined;
        }

        const parenMatch = text.match(new RegExp(`->${method}\\s*\\(([^)]+)\\)`));
        if (parenMatch) {
            const actions = readActions(parenMatch[1]!);
            return actions.length > 0 ? actions : undefined;
        }

        return undefined;
    };

    const middleware: string[] = [];
    for (const match of text.matchAll(/->middleware\s*\(([^)]*)\)/g)) {
        middleware.push(...readActions(match[1]!));
        for (const classMatch of match[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_\\]*)::class/g)) {
            middleware.push(resolveControllerClass(classMatch[1]!, imports));
        }
    }

    return {
        only: readMethod("only"),
        except: readMethod("except"),
        middleware: [...new Set(middleware)],
    };
}

function collectStrings(node: Parser.SyntaxNode): string[] {
    const result: string[] = [];

    function walk(current: Parser.SyntaxNode): void {
        if (current.type === "string") {
            result.push(cleanPhpString(current.text));
        }

        for (const child of current.children) {
            walk(child);
        }
    }

    walk(node);

    return result;
}

function findControllerClass(node: Parser.SyntaxNode): string | null {
    let result: string | null = null;

    function walk(current: Parser.SyntaxNode): void {
        if (result) return;

        if (current.type === "class_constant_access_expression") {
            const text = current.text;

            if (text.endsWith("::class")) {
                result = text.replace("::class", "").trim();
                return;
            }
        }

        for (const child of current.children) {
            walk(child);
        }
    }

    walk(node);

    return result;
}

function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}
