import Database from "better-sqlite3";
import fs from "node:fs";
import { findSimilarFiles } from "../../analyzers/features/featureDiscovery";
import { searchNodes } from "../../graph/queries/searchNodes";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import { parseRuntime } from "../shared/runtimeFilter";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);
if (!dbPath || !query) {
    console.log("Usage: repo-ranger similar <db.sqlite> \"<file|symbol>\" [--runtime=nuxt] [--workspace=name] [--limit=10] [--json] [--output=file]");
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
const limit = getIntOption(args, "--limit", 10, 1);
const json = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const db = new Database(dbPath);
try {
    const seed = searchNodes(db, query, { kind: "all", limit: 1, runtime, workspace, dedupeByFile: true })[0];
    if (!seed?.file) {
        console.error(`No source file found for "${query}".`);
        process.exitCode = 1;
    } else {
        const matches = findSimilarFiles(db, seed.file, { runtime, workspace, maxFiles: limit });
        const output = json
            ? `${JSON.stringify({ query, seed: seed.file, matches }, null, 2)}\n`
            : [
                `# Similar to: ${seed.file}`,
                "",
                ...matches.map((file, index) =>
                    `${index + 1}. ${file.file} — ${Math.round(file.similarity * 100)}%; ${file.reasons.join("; ")}`
                ),
                "",
            ].join("\n");
        console.log(output.trimEnd());
        if (outputPath) fs.writeFileSync(outputPath, output, "utf8");
    }
} finally {
    db.close();
}
