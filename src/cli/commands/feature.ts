import Database from "better-sqlite3";
import fs from "node:fs";
import { discoverFeature } from "../../analyzers/features/featureDiscovery";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import { parseRuntime } from "../shared/runtimeFilter";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);
if (!dbPath || !query) {
    console.log("Usage: repo-ranger feature <db.sqlite> \"<feature>\" [--runtime=nuxt] [--workspace=name] [--files=20] [--json] [--output=file]");
    process.exit(2);
}
let runtime;
try {
    runtime = parseRuntime(getOptionValue(args, "--runtime"));
} catch (error) {
    console.error((error as Error).message);
    process.exit(2);
}
const workspace = getOptionValue(args, "--workspace");
const maxFiles = getIntOption(args, "--files", 20, 1);
const json = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const db = new Database(dbPath);
try {
    const result = discoverFeature(db, query, { runtime, workspace, maxFiles });
    const output = json
        ? `${JSON.stringify(result, null, 2)}\n`
        : [
            `# Feature: ${result.label}`,
            `Scope: ${result.workspaces.join(", ") || "unknown"} | runtime: ${result.runtimes.join(", ") || "unknown"}`,
            "",
            ...result.files.map((file, index) =>
                `${index + 1}. ${file.file} — ${file.role}; ${file.reasons.join("; ")}`
            ),
            ...(result.warnings.length ? ["", ...result.warnings.map(item => `warning: ${item}`)] : []),
            "",
        ].join("\n");
    console.log(output.trimEnd());
    if (outputPath) fs.writeFileSync(outputPath, output, "utf8");
} finally {
    db.close();
}
