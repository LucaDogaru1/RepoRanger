import Database from "better-sqlite3";
import chalk from "chalk";
import fs from "node:fs";
import {
    buildTrace,
    formatGraphEntries,
    formatTargetLocation,
    type TraceResult,
} from "../../analyzers/trace/trace";
import { shortNavigationLabel } from "../../graph/queries/navigationQueries";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";

const dbPath = process.argv[2];
const query = process.argv[3];
const args = process.argv.slice(4);

const limit = getIntOption(args, "--limit", 20, 1);
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const outputPath = getOptionValue(args, "--output");

if (!dbPath || !query) {
    console.log("Usage: impactlens trace <db.sqlite> \"<symbol>\" [--limit=20] [--include-interface-resolved] [--json] [--output=file.txt]");
    process.exit(2);
}

const db = new Database(dbPath);

function section(title: string, color: (text: string) => string): void {
    console.log(chalk.gray("\n──────────────────────────────────────────────"));
    console.log(color(title));
}

function bulletLines(items: string[], emptyLabel = "(none)"): void {
    if (items.length === 0) {
        console.log(chalk.gray(`  ${emptyLabel}`));
        return;
    }
    for (const item of items) {
        console.log(`  ${chalk.white("•")} ${item}`);
    }
}

function renderTrace(data: TraceResult): string {
    const lines: string[] = [];

    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("Trace");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");
    lines.push("Symbol");
    lines.push(`  ${data.query}`);
    lines.push(`  → ${data.target.id} (${data.target.type})`);
    const location = formatTargetLocation(data.target);
    if (location) {
        lines.push(`  → ${location}`);
    }
    if (data.resolvesTo) {
        lines.push(`  → resolves to: ${data.resolvesTo}`);
    }
    lines.push(`  match: ${data.matchReason}`);

    lines.push("");
    lines.push("Flow (best path)");
    if (data.flowLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const line of data.flowLines) {
            lines.push(`  ${line}`);
        }
    }

    lines.push("");
    lines.push("Coverage");
    lines.push(`  complete: ${data.coverage.complete.join(", ") || "(none)"}`);
    lines.push(`  partial: ${data.coverage.partial.join(", ") || "(none)"}`);
    lines.push(`  missing: ${data.coverage.missing.join(", ") || "(none)"}`);

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Entry Points");
    const entryLines: string[] = [];
    for (const route of data.navigation.routeEntries) {
        entryLines.push(`${shortNavigationLabel(route.endpointId)} [ROUTES_TO]`);
    }
    for (const blade of data.navigation.bladeEntries) {
        entryLines.push(`${shortNavigationLabel(blade.bladeViewId)} [BLADE_USES_ACTION]`);
    }
    if (entryLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const item of entryLines) {
            lines.push(`  • ${item}`);
        }
    }

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Context");
    lines.push(
        `  upstream consumers: ${data.changeImpact.affectedCallers} `
        + `(entry points: ${data.changeImpact.components.directEntryPoints}, `
        + `call-chain: ${data.changeImpact.components.directCallChainCallers})`,
    );
    lines.push(`  risk: ${data.changeImpact.risk} · impact score: ${data.changeImpact.score}`);

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Reads");
    const readLines = data.reads.map(edge => `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)}`);
    if (readLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const item of readLines) {
            lines.push(`  • ${item}`);
        }
    }

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Validation");
    const validateLines = data.navigation.validates.map(edge =>
        `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type})`,
    );
    if (validateLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const item of validateLines) {
            lines.push(`  • ${item}`);
        }
    }

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Calls");
    lines.push("  outgoing");
    const outgoingLines = data.outgoingCalls.map(call =>
        call.resolvedTo ? `${call.id} → ${call.resolvedTo}` : call.id,
    );
    if (outgoingLines.length === 0) {
        lines.push("    (none)");
    } else {
        for (const item of outgoingLines) {
            lines.push(`    • ${item}`);
        }
    }
    lines.push("  incoming (call-chain)");
    if (data.incomingCalls.length === 0) {
        lines.push("    (none)");
    } else {
        for (const call of data.incomingCalls) {
            lines.push(`    • ${call.id}`);
        }
    }

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Assignments");
    const assignLines = data.navigation.fieldAssignments.map(edge =>
        `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type})`,
    );
    if (assignLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const item of assignLines) {
            lines.push(`  • ${item}`);
        }
    }

    lines.push("");
    lines.push("──────────────────────────────────────────────");
    lines.push("Other");
    const otherLines: string[] = [];
    if (data.navigation.persists.length > 0) {
        otherLines.push(...data.navigation.persists.map(edge => `PERSISTS ${shortNavigationLabel(edge.to)}`));
    }
    if (data.navigation.configRefs.length > 0) {
        otherLines.push(...data.navigation.configRefs.map(edge => `REFERENCES ${shortNavigationLabel(edge.to)}`));
    }
    for (const entry of formatGraphEntries(
        data.navigation.graphEntries.filter(e => e.kind === "http_client" || e.kind === "call"),
    )) {
        otherLines.push(entry);
    }
    if (data.navigation.warnings.length > 0) {
        otherLines.push(...data.navigation.warnings.map(w => `⚠ ${w}`));
    }
    if (otherLines.length === 0) {
        lines.push("  (none)");
    } else {
        for (const item of otherLines) {
            lines.push(`  • ${item}`);
        }
    }

    if (data.navigation.suggestedNext.length > 0) {
        lines.push("");
        lines.push("Suggested next");
        for (const step of data.navigation.suggestedNext.slice(0, 8)) {
            lines.push(`  • ${step}`);
        }
    }

    lines.push("");
    lines.push(`Hint: impactlens ai-context ${dbPath} "${data.analysisNodeId.replace(/\\/g, "\\\\")}" --compact`);

    return lines.join("\n");
}

function printTrace(data: TraceResult): void {
    console.log(chalk.bold.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold.cyan("Trace"));
    console.log(chalk.bold.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));

    console.log(chalk.bold("Symbol"));
    console.log(`  ${data.query}`);
    console.log(`  ${chalk.gray("→")} ${chalk.white(data.target.id)} ${chalk.gray(`(${data.target.type})`)}`);
    const location = formatTargetLocation(data.target);
    if (location) {
        console.log(`  ${chalk.gray("→")} ${chalk.gray(location)}`);
    }
    if (data.resolvesTo) {
        console.log(`  ${chalk.gray("→")} resolves to: ${chalk.white(data.resolvesTo)}`);
    }
    console.log(`  ${chalk.gray("match:")} ${chalk.white(data.matchReason)}`);

    console.log(chalk.bold("\nFlow (best path)"));
    if (data.flowLines.length === 0) {
        console.log(chalk.gray("  (none)"));
    } else {
        for (const line of data.flowLines) {
            console.log(`  ${chalk.white(line)}`);
        }
    }

    console.log(chalk.bold("\nCoverage"));
    console.log(`  ${chalk.green("complete:")} ${data.coverage.complete.join(", ") || chalk.gray("(none)")}`);
    console.log(`  ${chalk.yellow("partial:")} ${data.coverage.partial.join(", ") || chalk.gray("(none)")}`);
    console.log(`  ${chalk.red("missing:")} ${data.coverage.missing.join(", ") || chalk.gray("(none)")}`);

    section("Entry Points", chalk.bold.yellow);
    const entryItems = [
        ...data.navigation.routeEntries.map(route =>
            `${shortNavigationLabel(route.endpointId)} [ROUTES_TO]`,
        ),
        ...data.navigation.bladeEntries.map(blade =>
            `${shortNavigationLabel(blade.bladeViewId)} [BLADE_USES_ACTION]`,
        ),
    ];
    bulletLines(entryItems);

    section("Context", chalk.bold.blue);
    console.log(
        `  upstream consumers: ${chalk.white(String(data.changeImpact.affectedCallers))} `
        + chalk.gray(`(entry points: ${data.changeImpact.components.directEntryPoints}, `
        + `call-chain: ${data.changeImpact.components.directCallChainCallers})`),
    );
    console.log(`  risk: ${chalk.white(data.changeImpact.risk)} · impact score: ${chalk.white(String(data.changeImpact.score))}`);

    section("Reads", chalk.bold.green);
    bulletLines(data.reads.map(edge =>
        `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)}`,
    ));

    section("Validation", chalk.bold.magenta);
    bulletLines(data.navigation.validates.map(edge =>
        `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type})`,
    ));

    section("Calls", chalk.bold.red);
    console.log(chalk.gray("  outgoing"));
    bulletLines(
        data.outgoingCalls.map(call =>
            call.resolvedTo ? `${call.id} → ${call.resolvedTo}` : call.id,
        ),
        "(none)",
    );
    console.log(chalk.gray("  incoming (call-chain)"));
    bulletLines(data.incomingCalls.map(call => call.id), "(none)");

    section("Assignments", chalk.bold.cyan);
    bulletLines(data.navigation.fieldAssignments.map(edge =>
        `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type})`,
    ));

    section("Other", chalk.bold.white);
    const otherItems = [
        ...data.navigation.persists.map(edge => `PERSISTS ${shortNavigationLabel(edge.to)}`),
        ...data.navigation.configRefs.map(edge => `REFERENCES ${shortNavigationLabel(edge.to)}`),
        ...formatGraphEntries(
            data.navigation.graphEntries.filter(entry => entry.kind === "http_client" || entry.kind === "call"),
        ),
        ...data.navigation.warnings.map(w => `⚠ ${w}`),
    ];
    bulletLines(otherItems);

    if (data.navigation.suggestedNext.length > 0) {
        section("Suggested next", chalk.bold.white);
        bulletLines(data.navigation.suggestedNext.slice(0, 8));
    }

    console.log(chalk.gray(`\nHint: impactlens ai-context ${dbPath} "${data.analysisNodeId.replace(/\\/g, "\\\\")}" --compact`));
}

try {
    const result = buildTrace(db, query, { limit, includeInterfaceResolved });

    if (!result.ok) {
        console.log(chalk.red.bold(result.error));
        process.exit(1);
    }

    if (jsonOutput) {
        const json = JSON.stringify(result.data, null, 2);
        console.log(json);
        if (outputPath) {
            fs.writeFileSync(outputPath, json, "utf8");
        }
        process.exit(0);
    }

    const plain = renderTrace(result.data);
    printTrace(result.data);

    if (outputPath) {
        fs.writeFileSync(outputPath, plain, "utf8");
    }
} finally {
    db.close();
}
