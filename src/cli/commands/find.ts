import Database from "better-sqlite3";
import fs from "node:fs";
import { searchNodes, type SearchKind } from "../../graph/queries/searchNodes";
import { suggestFollowUpQueries } from "../../graph/queries/searchQueryVariants";
import { suggestRouteFollowUpQueries } from "../../graph/queries/routeSearchVariants";
import { shortNavigationLabel } from "../../graph/queries/navigationQueries";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import type { CodeRuntime } from "../../shared/classification/codeLocation";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);

const kind = (getOptionValue(args, "--kind") ?? "auto") as SearchKind;
const limit = getIntOption(args, "--limit", 20, 1);
const jsonOutput = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const runtimeArg = getOptionValue(args, "--runtime");
const workspace = getOptionValue(args, "--workspace");
const supportedRuntimes = new Set<CodeRuntime>([
    "legacy-vue",
    "nuxt",
    "vue",
    "shared",
    "backend",
    "unknown",
]);
const runtime = runtimeArg && supportedRuntimes.has(runtimeArg as CodeRuntime)
    ? runtimeArg as CodeRuntime
    : undefined;
const autoRouteQuery = kind === "auto" && (
    query?.startsWith("api:")
    || /^(get|post|put|patch|delete)\s+\//i.test(query ?? "")
);
const dedupeByFile = kind !== "route" && !autoRouteQuery && !hasFlag(args, "--no-dedupe");

if (!dbPath || !query) {
    console.log(`Usage: repo-ranger find <db.sqlite> "<query>" [--kind=auto|symbol|route|field|config|all] [--runtime=nuxt|legacy-vue|vue|shared|backend|unknown] [--workspace=name] [--no-dedupe] [--limit=20] [--json] [--output=file.txt]`);
    process.exit(2);
}

if (runtimeArg && !runtime) {
    console.error(`Unsupported runtime "${runtimeArg}". Use nuxt, legacy-vue, vue, shared, backend, or unknown.`);
    process.exit(2);
}

const db = new Database(dbPath);

try {
    const matches = searchNodes(db, query, {
        kind,
        limit,
        runtime,
        workspace,
        dedupeByFile,
    });

    if (jsonOutput) {
        const payload = { query, kind, runtime: runtime ?? null, workspace: workspace ?? null, dedupeByFile, limit, matches };
        const json = JSON.stringify(payload, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(matches.length === 0 ? 1 : 0);
    }

    if (matches.length === 0) {
        const effectiveKind = kind === "auto"
            ? (/\b(get|post|put|patch|delete)\s+\//i.test(query) || query.includes("/") ? "route" : kind)
            : kind;
        const suggestions = effectiveKind === "route"
            ? suggestRouteFollowUpQueries(query)
            : suggestFollowUpQueries(query);

        console.log(`No matches for "${query}" (kind=${kind}).`);
        if (suggestions.length > 0) {
            console.log("Try these normalized queries:");
            for (const suggestion of suggestions) {
                const suggestionKind = effectiveKind === "route" ? "route" : kind;
                console.log(`  repo-ranger find ${dbPath} "${suggestion}" --kind=${suggestionKind}`);
            }
        }
        if (effectiveKind === "route") {
            console.log("Route tips: ticket URLs often include /api/v3 — the graph stores paths without that prefix.");
            console.log("Use path suffixes like config/settings, multiview, or related-contents.");
        } else if (effectiveKind === "field") {
            console.log("Field tips: only fields present in the scanned graph are searchable.");
            console.log("If the symbol is new, search by controller/class name instead.");
        } else {
            console.log("Try --kind=route for paths like POST /payments, --kind=field for request/model fields, or --kind=all to widen search.");
        }
        process.exit(1);
    }

    const lines = [
        `# Find: ${query}`,
        "",
        `- kind: ${kind}`,
        `- runtime: ${runtime ?? "all"}`,
        `- workspace: ${workspace ?? "all"}`,
        `- dedupe by file: ${dedupeByFile}`,
        `- matches: ${matches.length}`,
        "",
        "## Results",
        "",
    ];

    for (const match of matches) {
        lines.push(`- **${match.id}** (${match.type}) — score ${match.score}, ${match.matchReason}`);
        if (match.file) {
            lines.push(`  file: ${match.file}`);
        }
        lines.push(`  scope: ${match.workspace ?? "unknown"} / ${match.runtime ?? "unknown"} (${(match.runtimeConfidence ?? 0).toFixed(2)})`);
        if ((match.groupedNodeCount ?? 1) > 1) {
            lines.push(`  grouped: ${match.groupedNodeCount} nodes [${(match.groupedNodeTypes ?? []).join(", ")}]`);
        }
        lines.push(`  label: ${shortNavigationLabel(match.id)}`);
    }

    lines.push("");
    lines.push("## Next");
    lines.push("");
    lines.push(`repo-ranger ai-context ${dbPath} "${matches[0]!.id.replace(/\\/g, "\\\\")}" --compact`);
    lines.push("");

    const output = lines.join("\n");
    console.log(output);
    if (outputPath) {
        fs.writeFileSync(outputPath, output, "utf8");
    }
} finally {
    db.close();
}
