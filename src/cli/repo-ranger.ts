import path from "node:path";

type CommandDef = {
    script: string;
    description: string;
};

const COMMANDS: Record<string, CommandDef> = {
    scan: {
        script: "scan.ts",
        description: "Build Graph.sqlite / Graph.json from a codebase",
    },
    find: {
        script: "commands/find.ts",
        description: "Search graph symbols, routes, and fields (alias: analyze:find)",
    },
    "analyze:find": {
        script: "commands/find.ts",
        description: "Same as find",
    },
    "ai-context": {
        script: "commands/aiContext.ts",
        description: "Compact report for one symbol (alias: analyze:ai-context)",
    },
    "analyze:ai-context": {
        script: "commands/aiContext.ts",
        description: "Same as ai-context",
    },
    "change-impact": {
        script: "commands/changeImpact.ts",
        description: "Blast radius for a symbol (alias: analyze:change-impact)",
    },
    "analyze:change-impact": {
        script: "commands/changeImpact.ts",
        description: "Same as change-impact",
    },
    impact: {
        script: "commands/impact.ts",
        description: "Richer impact report (alias: analyze:impact)",
    },
    "analyze:impact": {
        script: "commands/impact.ts",
        description: "Same as impact",
    },
    architecture: {
        script: "commands/architecture.ts",
        description: "Layer / dependency rule violations",
    },
    "analyze:architecture": {
        script: "commands/architecture.ts",
        description: "Same as architecture",
    },
    cycles: {
        script: "commands/cycles.ts",
        description: "Circular dependency detection",
    },
    "analyze:cycles": {
        script: "commands/cycles.ts",
        description: "Same as cycles",
    },
    "dead-code": {
        script: "commands/deadCode.ts",
        description: "Likely unreachable nodes",
    },
    "analyze:dead-code": {
        script: "commands/deadCode.ts",
        description: "Same as dead-code",
    },
    hotspots: {
        script: "commands/hotspots.ts",
        description: "Heavily connected nodes",
    },
    "analyze:hotspots": {
        script: "commands/hotspots.ts",
        description: "Same as hotspots",
    },
    risk: {
        script: "commands/risk.ts",
        description: "Combined risk ranking",
    },
    "analyze:risk": {
        script: "commands/risk.ts",
        description: "Same as risk",
    },
    trace: {
        script: "commands/trace.ts",
        description: "End-to-end flow trace for a symbol (alias: analyze:trace)",
    },
    "analyze:trace": {
        script: "commands/trace.ts",
        description: "Same as trace",
    },
    locate: {
        script: "commands/locate.ts",
        description: "Compact best-match flow and prioritized files",
    },
    "analyze:locate": {
        script: "commands/locate.ts",
        description: "Same as locate",
    },
    "install-skill": {
        script: "",
        description: "Write .cursor/skills/repo-ranger/SKILL.md in the current project",
    },
};

function printCommands(): void {
    console.log(`RepoRanger commands

Usage:
  repo-ranger <command> [args...]
  npx repo-ranger <command> [args...]

Commands:`);

    const seen = new Set<string>();
    for (const [name, def] of Object.entries(COMMANDS)) {
        if (def.script && seen.has(def.script)) {
            continue;
        }
        if (def.script) {
            seen.add(def.script);
        }
        console.log(`  ${name.padEnd(22)} ${def.description}`);
    }
}

function printHelp(): void {
    console.log(`RepoRanger — static code graph navigation

`);
    printCommands();
    console.log(`
Examples:
  repo-ranger scan /path/to/repo --lang=both --output=both
  repo-ranger find sqlite/Graph.sqlite PaymentController
  repo-ranger locate sqlite/Graph.sqlite "GET /api/v3/contents"
  repo-ranger trace sqlite/Graph.sqlite "App\\\\Services\\\\Foo::bar"
  repo-ranger ai-context sqlite/Graph.sqlite "App\\\\Services\\\\Foo::bar" --compact

List commands only:  repo-ranger --commands
Full help:           repo-ranger --help

After npm install, the agent skill is written to:
  .cursor/skills/repo-ranger/SKILL.md

Skip auto-install: REPO_RANGER_SKIP_SKILL=1 npm install repo-ranger
Docs: https://github.com/LucaDogaru1/RepoRanger
`);
}

function isSandboxLaunchError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EPERM") {
        return false;
    }

    const message = String(err.message ?? "");
    const syscall = String(err.syscall ?? "");

    if (syscall === "listen" && message.includes(".pipe")) {
        return true;
    }

    if (syscall === "spawn" || message.includes("tsx/dist/cli.mjs")) {
        return true;
    }

    return false;
}

function printSandboxLaunchHint(): void {
    console.error(`RepoRanger failed to start the command.

Cause: EPERM while launching the command runtime.
Restricted sandbox environments may block subprocess creation.
Try running the same command in a terminal with full permissions.`);
}

function runTsScript(relativeScript: string, args: string[]): number {
    const scriptPath = path.join(__dirname, relativeScript);
    const previousArgv = process.argv;

    process.argv = [process.execPath, scriptPath, ...args];
    process.exitCode = 0;

    try {
        // bin/repo-ranger.js registers tsx/cjs; require() runs commands in-process.
        // Dynamic import() does not use that loader for .ts files in this CJS package.
        require(scriptPath);
        return process.exitCode ?? 0;
    } catch (error) {
        if (isSandboxLaunchError(error)) {
            printSandboxLaunchHint();
        }
        console.error(error);
        return 1;
    } finally {
        process.argv = previousArgv;
    }
}

function runInstallSkill(): number {
    const { installAgentSkill } = require("../../scripts/postinstall.js") as {
        installAgentSkill: (io?: { log?: (msg: string) => void; warn?: (msg: string) => void }) => { ok: boolean };
    };
    installAgentSkill({ log: console.log, warn: console.warn });
    return 0;
}

function main(): number {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === "--help" || command === "-h" || command === "help") {
        printHelp();
        return 0;
    }

    if (command === "--commands" || command === "commands") {
        printCommands();
        return 0;
    }

    const def = COMMANDS[command];
    if (!def) {
        console.error(`Unknown command: ${command}\n`);
        printHelp();
        return 1;
    }

    if (command === "install-skill") {
        return runInstallSkill();
    }

    return runTsScript(def.script, args.slice(1));
}

try {
    process.exit(main());
} catch (error) {
    if (isSandboxLaunchError(error)) {
        printSandboxLaunchHint();
    }
    console.error(error);
    process.exit(1);
}
