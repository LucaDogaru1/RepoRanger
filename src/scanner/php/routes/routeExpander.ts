export interface RouteDefinition {
    method: string;
    path: string;
    controller: string;
    action: string;
    middleware?: string[];
}

const RESOURCE_ACTIONS: Array<{ method: string; suffix: string; action: string }> = [
    { method: "GET", suffix: "", action: "index" },
    { method: "GET", suffix: "/create", action: "create" },
    { method: "POST", suffix: "", action: "store" },
    { method: "GET", suffix: "/{param}", action: "show" },
    { method: "GET", suffix: "/{param}/edit", action: "edit" },
    { method: "PUT", suffix: "/{param}", action: "update" },
    { method: "PATCH", suffix: "/{param}", action: "update" },
    { method: "DELETE", suffix: "/{param}", action: "destroy" },
];

const WEB_ONLY_ACTIONS = new Set(["create", "edit"]);

function joinRoutePath(prefix: string, routePath: string): string {
    const left = prefix.replace(/\/+$/, "");
    const right = routePath.startsWith("/") ? routePath : `/${routePath}`;
    const combined = `${left}${right}`.replace(/\/+/g, "/");
    return combined || "/";
}

function normalizeBasePath(path: string): string {
    if (!path) {
        return "/";
    }

    return path.startsWith("/") ? path : `/${path}`;
}

function expandNestedResourcePath(path: string): string {
    const segments = path.split(".").filter(Boolean);
    if (segments.length <= 1) {
        return path;
    }

    return segments
        .flatMap((segment, index) => index < segments.length - 1
            ? [segment, "{param}"]
            : [segment])
        .join("/");
}

export function expandResourceRoutes(
    verb: "resource" | "apiResource",
    basePath: string,
    controller: string,
    prefix: string,
    options?: { only?: string[]; except?: string[]; middleware?: string[] }
): RouteDefinition[] {
    const normalizedBase = joinRoutePath(
        prefix,
        normalizeBasePath(expandNestedResourcePath(basePath)),
    );
    const allowed = new Set(
        RESOURCE_ACTIONS
            .map(item => item.action)
            .filter(action => verb === "resource" || !WEB_ONLY_ACTIONS.has(action))
    );

    if (options?.only?.length) {
        for (const action of [...allowed]) {
            if (!options.only.includes(action)) {
                allowed.delete(action);
            }
        }
    }

    if (options?.except?.length) {
        for (const action of options.except) {
            allowed.delete(action);
        }
    }

    const routes: RouteDefinition[] = [];

    for (const item of RESOURCE_ACTIONS) {
        if (!allowed.has(item.action)) {
            continue;
        }

        routes.push({
            method: item.method,
            path: `${normalizedBase}${item.suffix}`.replace(/\/+/g, "/"),
            controller,
            action: item.action,
            middleware: options?.middleware,
        });
    }

    return routes;
}

export function buildSingleRoute(
    method: string,
    path: string,
    controller: string,
    action: string,
    prefix: string,
    middleware?: string[]
): RouteDefinition {
    return {
        method: method.toUpperCase(),
        path: joinRoutePath(prefix, normalizeBasePath(path)),
        controller,
        action,
        middleware,
    };
}
