import fs from "node:fs";
import path from "node:path";

export interface RouteMountSource {
    absolutePath: string;
    relativePath: string;
}

const MOUNT_SOURCE_FILE = /(?:^|\/)(?:app\/Providers\/[^/]*RouteServiceProvider\.php|bootstrap\/app\.php)$/;
const GROUP_ROUTE_FILE = /->group\s*\(\s*base_path\s*\(\s*['"](routes\/[^'"]+\.php)['"]\s*\)\s*\)/;
const PREFIX_CALL = /(?:Route::|->)prefix\s*\(\s*['"]([^'"]*)['"]\s*\)/g;
const WITH_ROUTING_FILE = /\b(web|api)\s*:\s*__DIR__\s*\.\s*['"]\/\.\.\/(routes\/[^'"]+\.php)['"]/g;
const WITH_ROUTING_API_PREFIX = /\bapiPrefix\s*:\s*['"]([^'"]*)['"]/;

export function isRouteMountSource(relativePath: string): boolean {
    return MOUNT_SOURCE_FILE.test(relativePath.replace(/\\/g, "/"));
}

function appRootOf(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/");
    const marker = normalized.match(/(?:^|\/)(?:app\/Providers|bootstrap)\//);
    return marker?.index !== undefined ? normalized.slice(0, marker.index) : "";
}

function joinMountPrefix(parts: string[]): string {
    const joined = parts
        .map(part => part.replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .join("/");
    return joined ? `/${joined}` : "";
}

function routeFileKey(appRoot: string, routeFile: string): string {
    return path.posix.join(appRoot, routeFile);
}

function collectProviderMounts(source: string, appRoot: string, mounts: Map<string, string>): void {
    for (const statement of source.split(";")) {
        const routeFile = statement.match(GROUP_ROUTE_FILE)?.[1];
        if (!routeFile) {
            continue;
        }

        const prefixes = [...statement.matchAll(PREFIX_CALL)].map(match => match[1]!);
        mounts.set(routeFileKey(appRoot, routeFile), joinMountPrefix(prefixes));
    }
}

function collectWithRoutingMounts(source: string, appRoot: string, mounts: Map<string, string>): void {
    const apiPrefix = source.match(WITH_ROUTING_API_PREFIX)?.[1] ?? "api";

    for (const match of source.matchAll(WITH_ROUTING_FILE)) {
        const kind = match[1]!;
        const routeFile = match[2]!;
        mounts.set(routeFileKey(appRoot, routeFile), kind === "api" ? joinMountPrefix([apiPrefix]) : "");
    }
}

export function collectRouteMountsFromSource(
    source: string,
    relativePath: string,
    mounts: Map<string, string> = new Map(),
): Map<string, string> {
    const appRoot = appRootOf(relativePath);

    if (/(?:^|\/)bootstrap\/app\.php$/.test(relativePath)) {
        collectWithRoutingMounts(source, appRoot, mounts);
    } else {
        collectProviderMounts(source, appRoot, mounts);
    }

    return mounts;
}

export function collectRouteMounts(files: RouteMountSource[]): Map<string, string> {
    const mounts = new Map<string, string>();

    for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
        if (!isRouteMountSource(file.relativePath)) {
            continue;
        }

        collectRouteMountsFromSource(fs.readFileSync(file.absolutePath, "utf-8"), file.relativePath, mounts);
    }

    return mounts;
}
