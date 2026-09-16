import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildLocate, renderLocate } from "../../analyzers/locate/locate";
import { DEFAULT_MAX_TOKENS } from "../../analyzers/locate/outputBudget";
import type { SearchKind } from "../../graph/queries/searchNodes";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);
const kind = (getOptionValue(args, "--kind") ?? "auto") as SearchKind;
const depth = getIntOption(args, "--depth", 3, 1);
const limit = getIntOption(args, "--limit", 12, 1);
const maxFiles = Math.min(5, getIntOption(args, "--files", 5, 1));
const maxTokens = getIntOption(args, "--max-tokens", DEFAULT_MAX_TOKENS, 200);
const jsonOutput = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");
const noSnippets = hasFlag(args, "--no-snippets");
const includeTests = !hasFlag(args, "--no-tests");
const sourceRoot = noSnippets
    ? undefined
    : path.resolve(getOptionValue(args, "--source-root") ?? process.cwd());

if (!dbPath || !query) {
    console.log("Usage: repo-ranger locate <db.sqlite> \"<route|class|method|field>\" [--kind=auto|symbol|route|field|config|all] [--depth=3] [--limit=12] [--files=5] [--max-tokens=800] [--source-root=.] [--no-snippets] [--no-tests] [--json] [--output=file.txt]");
    process.exit(2);
}

const db = new Database(dbPath);
try {
    const result = buildLocate(db, query, {
        kind,
        depth,
        limit,
        maxFiles,
        sourceRoot,
        dbPath,
        maxTokens,
        includeTests,
    });
    if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
    } else {
        const output = jsonOutput
            ? `${JSON.stringify(result.data, null, 2)}\n`
            : renderLocate(result.data, maxTokens);
        console.log(output.trimEnd());
        if (outputPath) fs.writeFileSync(outputPath, output, "utf8");
    }
} finally {
    db.close();
}
