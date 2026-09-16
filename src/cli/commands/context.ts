import Database from "better-sqlite3";
import fs from "node:fs";
import { buildTaskContext, renderTaskContext } from "../../analyzers/context/taskContext";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import { parseRuntime } from "../shared/runtimeFilter";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);
if (!dbPath || !query) {
    console.log("Usage: repo-ranger context <db.sqlite> \"<task>\" [--max-tokens=2500] [--runtime=nuxt] [--workspace=name] [--files=20] [--json] [--output=file]");
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
const maxTokens = getIntOption(args, "--max-tokens", 2500, 200);
const maxFiles = Math.min(20, getIntOption(args, "--files", 20, 1));
const json = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const db = new Database(dbPath);
try {
    const result = buildTaskContext(db, query, { runtime, workspace, maxTokens, maxFiles });
    const output = json ? `${JSON.stringify(result)}\n` : renderTaskContext(result);
    console.log(output.trimEnd());
    if (outputPath) fs.writeFileSync(outputPath, output, "utf8");
} finally {
    db.close();
}
