import type { CodeRuntime } from "../../shared/classification/codeLocation";

const SUPPORTED_RUNTIMES = new Set<CodeRuntime>([
    "legacy-vue", "nuxt", "vue", "shared", "backend", "unknown",
]);

export function parseRuntime(value: string | undefined): CodeRuntime | undefined {
    if (!value) return undefined;
    if (!SUPPORTED_RUNTIMES.has(value as CodeRuntime)) {
        throw new Error(`Unsupported runtime "${value}". Use nuxt, legacy-vue, vue, shared, backend, or unknown.`);
    }
    return value as CodeRuntime;
}
