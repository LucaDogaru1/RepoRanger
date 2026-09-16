import Database from "better-sqlite3";
import fs from "node:fs";
import { analyzeArchitectureForNodes } from "../../analyzers/architecture/ArchitectureAnalyzer";
import { detectCyclesFromNodes } from "../../analyzers/cycles/CycleAnalyzer";
import { analyzeChangeImpact, buildImpactGraphIndex } from "../../analyzers/impact/ImpactScoringAnalyzer";
import {
    findDependsOnRelations,
    findIncomingCalls,
    findInheritanceChain,
    findMethodsByParent,
    findNode,
    getRelationTargetId,
    resolveMethodThroughInheritance,
} from "../../graph/queries/GraphQueries";
import { findOutgoingCallChain, type CallChainRow } from "../../graph/queries/callChainQueries";
import { formatLocation, toBulletList } from "../../shared/formatting/text";
import { getIntOption, getOptionValue, hasFlag } from "../shared/cliArgs";
import { buildRiskRanking } from "../shared/riskRanking";
import { gatherNavigationContext } from "../../analyzers/navigation/gatherNavigationContext";
import {
    findRouteControllerMethod,
    formatGraphEntryLabel,
    resolveInterfaceMethodImplementation,
    shortNavigationLabel,
} from "../../graph/queries/navigationQueries";

type CallItem = {
    id: string;
    depth: number;
    callType: string | null;
    via: string | null;
    file: string | null;
    resolvedTo?: string;
};

type DependencyItem = {
    direction: "outgoing" | "incoming";
    id: string;
    file: string | null;
};

type AiContextPayload = {
    target: {
        id: string;
        type: string;
        location: string | null;
        resolvesTo?: string | null;
    };
    summary: {
        changeRisk: string;
        impactScore: number;
        riskRank: number | null;
        riskPopulation: number;
        riskPercentileTop: number | null;
        riskCandidatePool: number;
        upstreamConsumers: number;
        entryPoints: number;
        callChainCallers: number;
        /** @deprecated use upstreamConsumers */
        affectedCallers: number;
        methodsUsedByTarget: number;
        affectedFiles: number;
    };
    purposeGuess: {
        likelyResponsibility: string;
        primaryConsumers: string[];
        mainDependencies: string[];
        riskDrivers: string[];
    };
    callers: CallItem[];
    graphEntries: Array<{ kind: string; from: string; to: string; file: string | null }>;
    callees: CallItem[];
    calleesTruncated: boolean;
    dependencies: DependencyItem[];
    inheritance: string[];
    architecture: Array<{
        severity: string;
        fromId: string;
        toId: string;
        reason: string;
        expected: string;
        detected: string;
        isLikelyFalsePositive: boolean;
        falsePositiveReason: string | null;
    }>;
    cycles: Array<{
        nodes: string[];
        files: string[];
        edgeTypes: string[];
        length: number;
    }>;
    affectedFiles: string[];
    navigation: {
        routeEntries: Array<{ endpointId: string; controllerMethod: string }>;
        bladeEntries: Array<{ bladeViewId: string; controllerMethod: string }>;
        graphEntries: Array<{ kind: string; from: string; to: string; file: string | null }>;
        httpUpstream: Array<{ componentId: string; endpointId: string; controllerMethod: string | null }>;
        fieldAssignments: Array<{ type: string; from: string; to: string; via?: string | null }>;
        fieldFlowsOut: Array<{ type: string; from: string; to: string; via?: string | null }>;
        validates: Array<{ type: string; from: string; to: string; via?: string | null }>;
        persists: Array<{ type: string; from: string; to: string; via?: string | null }>;
        configRefs: Array<{ type: string; from: string; to: string; via?: string | null }>;
        warnings: string[];
    };
};

function toShortName(id: string): string {
    const classPart = id.includes("::") ? id.split("::")[0] : id;
    const className = classPart.split("\\").pop() ?? classPart;
    const method = id.includes("::") ? id.split("::")[1] : "";
    return method ? `${className}::${method}` : className;
}

function formatFlowEdge(edge: { type: string; from: string; to: string; via?: string | null }): string {
    const via = edge.via ? ` via ${edge.via}` : "";
    return `${shortNavigationLabel(edge.from)} → ${shortNavigationLabel(edge.to)} (${edge.type}${via})`;
}

function renderNavigationSections(payload: AiContextPayload, compact: boolean): string[] {
    const nav = payload.navigation;
    const lines: string[] = [];

    lines.push(compact ? "## Navigation" : "## Graph Navigation");
    lines.push("");

    if (nav.routeEntries.length > 0) {
        lines.push(compact ? "### Route entry" : "### HTTP entry (ROUTES_TO)");
        lines.push(toBulletList(nav.routeEntries.map(route =>
            `${shortNavigationLabel(route.endpointId)} → ${shortNavigationLabel(route.controllerMethod)}`,
        )));
        lines.push("");
    }

    if (nav.bladeEntries.length > 0) {
        lines.push("### Blade entry (BLADE_USES_ACTION)");
        lines.push(toBulletList(nav.bladeEntries.map(entry =>
            `${shortNavigationLabel(entry.bladeViewId)} → ${shortNavigationLabel(entry.controllerMethod)}`,
        )));
        lines.push("");
    }

    if (nav.httpUpstream.length > 0) {
        lines.push(nav.routeEntries.some(route => route.endpointId === payload.target.id)
            ? "### HTTP clients (HTTP_REQUEST)"
            : "### UI upstream (HTTP_REQUEST)");
        lines.push(toBulletList(nav.httpUpstream.map(item =>
            `${shortNavigationLabel(item.componentId)} → ${shortNavigationLabel(item.endpointId)}`,
        )));
        lines.push("");
    }

    if (nav.fieldAssignments.length > 0) {
        lines.push("### Request / field intake (ASSIGNS)");
        lines.push(toBulletList(nav.fieldAssignments.map(formatFlowEdge)));
        lines.push("");
    }

    if (nav.fieldFlowsOut.length > 0) {
        lines.push("### Field flow to callees (FLOWS_TO / ARGUMENT_TO)");
        lines.push(toBulletList(nav.fieldFlowsOut.map(formatFlowEdge)));
        lines.push("");
    }

    if (nav.validates.length > 0) {
        lines.push("### Validation");
        lines.push(toBulletList(nav.validates.map(formatFlowEdge)));
        lines.push("");
    }

    if (nav.persists.length > 0) {
        lines.push("### Persistence (PERSISTS)");
        lines.push(toBulletList(nav.persists.map(formatFlowEdge)));
        lines.push("");
    }

    if (nav.configRefs.length > 0) {
        lines.push("### Config references");
        lines.push(toBulletList(nav.configRefs.map(formatFlowEdge)));
        lines.push("");
    }

    lines.push("### Graph coverage");
    lines.push(
        nav.warnings.length === 0
            ? "- No obvious navigation gaps detected for this symbol."
            : toBulletList(nav.warnings),
    );
    lines.push("");

    return lines;
}

function renderCalledBySection(payload: AiContextPayload): string[] {
    const lines: string[] = ["## Called By", ""];

    const graphEntryFromIds = new Set(
        payload.graphEntries.filter(entry => entry.kind === "call").map(entry => entry.from),
    );

    const graphEntryLabels = payload.graphEntries.map(entry => {
        const fileSuffix = entry.file ? ` (${entry.file})` : "";
        return `${formatGraphEntryLabel(entry as Parameters<typeof formatGraphEntryLabel>[0])}${fileSuffix}`;
    });

    const extraCallLabels = payload.callers
        .filter(item => !graphEntryFromIds.has(item.id))
        .map(item => item.file ? `${item.id} (${item.file})` : item.id);

    const combined = [...graphEntryLabels, ...extraCallLabels];

    lines.push(combined.length === 0 ? "- None" : toBulletList(combined));
    lines.push("");
    return lines;
}

function formatCalleeLine(item: CallItem): string {
    const label = item.resolvedTo ? `${item.id} -> ${item.resolvedTo}` : item.id;
    const fileSuffix = !item.resolvedTo && item.file ? ` (${item.file})` : "";
    const content = `${label}${fileSuffix}`;
    if (item.depth <= 1) {
        return content;
    }
    return `${"  ".repeat(item.depth - 1)}- ${content}`;
}

function renderCalleeLines(callees: CallItem[], truncated = false, resultLimit = 20): string[] {
    if (callees.length === 0) {
        return ["- None"];
    }
    const lines = callees.map(item => {
        const line = formatCalleeLine(item);
        return item.depth <= 1 ? `- ${line}` : line;
    });
    if (truncated) {
        lines.push(`- … truncated (--limit=${resultLimit}, increase --depth or --limit for more)`);
    }
    return lines;
}
function dedupeIncomingCalls(
    items: Array<{ id: string; callType: string | null; via: string | null; file: string | null }>,
    limit: number,
): Array<{ id: string; callType: string | null; via: string | null; file: string | null }> {
    const seen = new Set<string>();
    const result: Array<{ id: string; callType: string | null; via: string | null; file: string | null }> = [];

    for (const item of items) {
        const key = `${item.id}|${item.callType ?? ""}|${item.via ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
        if (result.length >= limit) {
            break;
        }
    }

    return result;
}

function dedupeCallChain(items: CallChainRow[], limit: number): CallChainRow[] {
    const seen = new Set<string>();
    const result: CallChainRow[] = [];

    for (const item of items) {
        const key = `${item.id}|${item.callType ?? ""}|${item.via ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
        if (result.length >= limit) {
            break;
        }
    }

    return result;
}

function formatUpstreamConsumersSummary(summary: AiContextPayload["summary"]): string {
    const base = `${summary.upstreamConsumers} upstream consumers`;
    if (summary.entryPoints > 0 || summary.callChainCallers > 0) {
        return `${base} (entry points: ${summary.entryPoints}, call-chain: ${summary.callChainCallers})`;
    }
    return base;
}

function guessPurpose(
    targetId: string,
    targetType: string,
    callers: CallItem[],
    callees: CallItem[],
    routeEntries: Array<{ endpointId: string }>,
    bladeEntries: Array<{ bladeViewId: string }>,
    dependencies: DependencyItem[],
    summary: AiContextPayload["summary"],
): AiContextPayload["purposeGuess"] {
    const lower = targetId.toLowerCase();
    let likelyResponsibility = "Application/domain service orchestration";

    if (lower.includes("interface") && (lower.includes("connector") || lower.includes("api"))) {
        likelyResponsibility = "API connector contract / external API read operation";
    } else if (targetType === "interface" || lower.includes("interface")) {
        likelyResponsibility = "Contract/interface definition";
    } else if (lower.includes("connector") || lower.includes("api")) {
        likelyResponsibility = "External API integration";
    } else if (lower.includes("repository")) {
        likelyResponsibility = "Persistence / data access";
    } else if (lower.includes("controller")) {
        likelyResponsibility = "HTTP/API request handling and orchestration";
    } else if (lower.includes("parser")) {
        likelyResponsibility = "Parsing / transformation";
    } else if (lower.includes("provider")) {
        likelyResponsibility = "Framework / bootstrap configuration";
    } else if (lower.includes("content") && lower.includes("service")) {
        likelyResponsibility = "Content retrieval and filtering service";
    } else if (lower.includes("service")) {
        likelyResponsibility = "Business / application logic";
    } else if (lower.includes("job")) {
        likelyResponsibility = "Background job processing";
    }

    const primaryConsumers = Array.from(new Set([
        ...callers.map(item => toShortName(item.id)),
        ...routeEntries.map(item => shortNavigationLabel(item.endpointId)),
        ...bladeEntries.map(item => shortNavigationLabel(item.bladeViewId)),
    ])).slice(0, 5);
    const mainDependencies = Array.from(new Set([
        ...dependencies
            .filter(dep => dep.direction === "outgoing")
            .map(dep => toShortName(dep.id)),
        ...callees.map(item => toShortName(item.id)),
    ])).slice(0, 5);

    const riskDrivers = [
        formatUpstreamConsumersSummary(summary),
        `${summary.affectedFiles} affected files`,
    ];

    return {
        likelyResponsibility,
        primaryConsumers,
        mainDependencies,
        riskDrivers,
    };
}

const dbPath = process.argv[2];
const targetId = process.argv[3];
const args = process.argv.slice(4);

const includeDependsOn = hasFlag(args, "--include-depends-on");
const includeInterfaceResolved = hasFlag(args, "--include-interface-resolved");
const jsonOutput = hasFlag(args, "--json");
const compactOutput = hasFlag(args, "--compact");

const depth = getIntOption(args, "--depth", 2, 1);
const limit = getIntOption(args, "--limit", 20, 1);
const riskCandidatePool = 100;
const outputPath = getOptionValue(args, "--output");

if (!dbPath || !targetId) {
    console.log('Usage: npx tsx src/cli/commands/aiContext.ts Graph.sqlite "ClassOrMethodId" [--depth=2] [--limit=20] [--include-depends-on] [--include-interface-resolved] [--json] [--compact] [--output=report.md]');
    process.exit(2);
}

const db = new Database(dbPath);

function renderDefaultMarkdown(payload: AiContextPayload): string {
    return [
        "# AI Context",
        "",
        "## Target",
        `- id: ${payload.target.id}`,
        `- type: ${payload.target.type}`,
        `- location: ${payload.target.location ?? "unknown"}`,
        ...(payload.target.resolvesTo
            ? [`- resolves to: ${payload.target.resolvesTo}`]
            : []),
        "",
        "## Summary",
        `- change risk: ${payload.summary.changeRisk}`,
        `- risk rank: ${payload.summary.riskRank !== null
            ? `${payload.summary.riskRank}/${payload.summary.riskPopulation}`
            : `outside top ${payload.summary.riskCandidatePool} hotspot candidates`
        }`,
        `- percentile: ${payload.summary.riskPercentileTop !== null
            ? `top ${payload.summary.riskPercentileTop}%`
            : "n/a (outside candidate pool)"
        }`,
        `- impact score: ${payload.summary.impactScore}`,
        `- candidate pool: top ${payload.summary.riskCandidatePool} hotspot candidates`,
        `- population: ${payload.summary.riskPopulation} nodes`,
        `- ${formatUpstreamConsumersSummary(payload.summary)}`,
        `- methods used by target: ${payload.summary.methodsUsedByTarget}`,
        `- affected files: ${payload.summary.affectedFiles}`,
        "",
        "## Purpose Guess",
        `Likely Responsibility: ${payload.purposeGuess.likelyResponsibility}`,
        "",
        "Primary Consumers:",
        payload.purposeGuess.primaryConsumers.length === 0 ? "- None" : toBulletList(payload.purposeGuess.primaryConsumers),
        "",
        "Main Dependencies:",
        payload.purposeGuess.mainDependencies.length === 0 ? "- None" : toBulletList(payload.purposeGuess.mainDependencies),
        "",
        "Risk Drivers:",
        payload.purposeGuess.riskDrivers.length === 0 ? "- None" : toBulletList(payload.purposeGuess.riskDrivers),
        "",
        ...renderCalledBySection(payload),
        "## Calls",
        ...renderCalleeLines(payload.callees, payload.calleesTruncated, limit),
        "",
        ...renderNavigationSections(payload, false),
        "## Dependencies",
        payload.dependencies.length === 0
            ? "- None"
            : toBulletList(payload.dependencies.map(dep => dep.file
                ? `${dep.direction}: ${dep.id} (${dep.file})`
                : `${dep.direction}: ${dep.id}`,
            )),
        "",
        "## Inheritance",
        payload.inheritance.length === 0
            ? "- None"
            : toBulletList(payload.inheritance),
        "",
        "## Architecture Notes",
        payload.architecture.length === 0
            ? "- No violations detected"
            : toBulletList(payload.architecture.map(item => {
                const fpMarker = item.isLikelyFalsePositive ? " [likely false positive]" : "";
                const fpNote = item.falsePositiveReason ? ` (${item.falsePositiveReason})` : "";
                return `${item.severity}: ${item.reason} (detected: ${item.detected})${fpMarker}${fpNote}`;
            })),
        "",
        "## Cycles",
        payload.cycles.length === 0
            ? "- No cycles detected"
            : toBulletList(payload.cycles.map(cycle => cycle.nodes.join(" -> "))),
        "",
        "## Suggested Review Scope",
        payload.affectedFiles.length === 0
            ? "- None"
            : toBulletList(payload.affectedFiles),
        "",
        "## Suggested AI Instruction",
        "Use this context to review the target method. Focus on breaking changes, affected callers, dependencies, architecture risks, and files that should be inspected.",
        "",
    ].join("\n");
}

function renderCompactMarkdown(payload: AiContextPayload): string {
    const dependencyIds = payload.dependencies.map(item => `${item.direction}: ${item.id}`);
    const architectureIds = payload.architecture.map(item => {
        const fpMarker = item.isLikelyFalsePositive ? " [likely false positive]" : "";
        return `${item.severity}: ${item.detected}${fpMarker}`;
    });
    const cyclePaths = payload.cycles.map(cycle => cycle.nodes.join(" -> "));

    return [
        "# AI Context",
        "",
        `- target: ${payload.target.id} (${payload.target.type})`,
        `- location: ${payload.target.location ?? "unknown"}`,
        ...(payload.target.resolvesTo
            ? [`- resolves to: ${payload.target.resolvesTo}`]
            : []),
        `- risk: ${payload.summary.changeRisk}`,
        `- risk rank: ${payload.summary.riskRank !== null
            ? `${payload.summary.riskRank}/${payload.summary.riskPopulation}`
            : `outside top ${payload.summary.riskCandidatePool} hotspot candidates`
        }`,
        `- percentile: ${payload.summary.riskPercentileTop !== null
            ? `top ${payload.summary.riskPercentileTop}%`
            : "n/a (outside candidate pool)"
        }`,
        `- impact score: ${payload.summary.impactScore}`,
        `- candidate pool: top ${payload.summary.riskCandidatePool} hotspot candidates`,
        `- population: ${payload.summary.riskPopulation} nodes`,
        `- ${formatUpstreamConsumersSummary(payload.summary)}`,
        `- methods used by target: ${payload.summary.methodsUsedByTarget}`,
        `- affected files: ${payload.summary.affectedFiles}`,
        "",
        "## Purpose Guess",
        `- likely responsibility: ${payload.purposeGuess.likelyResponsibility}`,
        `- primary consumers: ${payload.purposeGuess.primaryConsumers.join(", ") || "None"}`,
        `- main dependencies: ${payload.purposeGuess.mainDependencies.join(", ") || "None"}`,
        `- risk drivers: ${payload.purposeGuess.riskDrivers.join(", ") || "None"}`,
        "",
        ...renderCalledBySection(payload),
        "## Calls",
        ...renderCalleeLines(payload.callees, payload.calleesTruncated, limit),
        "",
        ...renderNavigationSections(payload, true),
        "## Dependencies",
        dependencyIds.length === 0 ? "- None" : toBulletList(dependencyIds),
        "",
        "## Architecture Notes",
        architectureIds.length === 0 ? "- No violations detected" : toBulletList(architectureIds),
        "",
        "## Cycles",
        cyclePaths.length === 0 ? "- No cycles detected" : toBulletList(cyclePaths),
        "",
        "## Suggested Review Scope",
        payload.affectedFiles.length === 0 ? "- None" : toBulletList(payload.affectedFiles),
        "",
        "## Suggested AI Instruction",
        "Use this context to review the target method. Focus on breaking changes, affected callers, dependencies, architecture risks, and files that should be inspected.",
        "",
    ].join("\n");
}

try {
    const target = findNode(db, targetId);

    if (!target) {
        console.log(`Target not found: ${targetId}`);
        process.exit(1);
    }

    const controllerMethodId = target.type === "api_endpoint"
        ? findRouteControllerMethod(db, target.id)
        : null;
    const analysisNodeId = controllerMethodId ?? target.id;

    const callers = target.type === "class"
        ? dedupeIncomingCalls(
            findMethodsByParent(db, target.id)
                .flatMap(methodId => findIncomingCalls(db, methodId, { includeInterfaceResolved, limit })),
            limit,
        )
        : findIncomingCalls(db, analysisNodeId, { includeInterfaceResolved, limit });

    let rawCallees: CallChainRow[];
    let calleesTruncated = false;

    if (target.type === "class") {
        const chains = findMethodsByParent(db, target.id)
            .map(methodId => findOutgoingCallChain(db, methodId, {
                depth,
                limit,
                includeInterfaceResolved,
            }));
        rawCallees = dedupeCallChain(
            chains.flatMap(chain => chain.calls),
            limit,
        );
        calleesTruncated = chains.some(chain => chain.truncated) || rawCallees.length >= limit;
    } else {
        const chain = findOutgoingCallChain(db, analysisNodeId, {
            depth,
            limit,
            includeInterfaceResolved,
        });
        rawCallees = chain.calls;
        calleesTruncated = chain.truncated;
    }
    const relationTargetId = getRelationTargetId(target);
    const inheritance = relationTargetId ? findInheritanceChain(db, relationTargetId) : [];
    const dependencies: DependencyItem[] = includeDependsOn && relationTargetId
        ? findDependsOnRelations(db, relationTargetId, limit)
        : [];

    const relatedNodeIds = target.type === "class"
        ? [target.id, ...findMethodsByParent(db, target.id)]
        : controllerMethodId
            ? [controllerMethodId]
            : [target.id];

    const graphIndex = buildImpactGraphIndex(db, {
        includeDependsOn,
        includeInterfaceResolved,
    });

    const changeImpact = analyzeChangeImpact(db, analysisNodeId, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        limit,
        graphIndex,
    });

    const riskRanking = buildRiskRanking(db, {
        includeDependsOn,
        includeInterfaceResolved,
        depth,
        impactLimit: limit,
        candidatePool: riskCandidatePool,
        graphIndex,
    });
    const riskPosition = riskRanking.items.find(item => item.id === analysisNodeId);

    const architectureViolations = analyzeArchitectureForNodes(db, relatedNodeIds, {
        includeDependsOn,
        includeInterfaceResolved,
    });

    const cycleItems = detectCyclesFromNodes(db, relatedNodeIds, {
        includeDependsOn,
        includeInterfaceResolved,
        limit,
    });

    const filteredArchitecture = architectureViolations
        .slice(0, limit)
        .map(violation => ({
            severity: violation.severity,
            fromId: violation.fromId,
            toId: violation.toId,
            reason: violation.reason,
            expected: violation.expected,
            detected: violation.detected,
            isLikelyFalsePositive: violation.isLikelyFalsePositive,
            falsePositiveReason: violation.falsePositiveReason,
        }));

    const filteredCycles = cycleItems
        .slice(0, limit)
        .map(cycle => ({
            nodes: cycle.nodes,
            files: cycle.files,
            edgeTypes: cycle.edgeTypes,
            length: cycle.length,
        }));

    const navigation = gatherNavigationContext(db, target, {
        limit,
        callersCount: callers.length,
        callees: rawCallees.map(item => item.id),
        includeInterfaceResolved,
    });

    const calleeItems: CallItem[] = rawCallees.map(item => {
        const isMissingTarget = !item.file;
        const resolvedTo = isMissingTarget
            ? resolveMethodThroughInheritance(db, item.id)
            : item.id.includes("Interface")
                ? resolveInterfaceMethodImplementation(db, item.id)
                : null;
        return {
            id: item.id,
            depth: item.depth,
            callType: item.callType,
            via: item.via,
            file: item.file,
            resolvedTo: resolvedTo && resolvedTo !== item.id ? resolvedTo : undefined,
        };
    });

    const payload: AiContextPayload = {
        target: {
            id: target.id,
            type: target.type,
            location: formatLocation(target.file, target.start_row, target.end_row),
            resolvesTo: controllerMethodId,
        },
        summary: {
            changeRisk: changeImpact.risk,
            impactScore: changeImpact.score,
            riskRank: riskPosition?.riskRank ?? null,
            riskPopulation: riskRanking.population,
            riskPercentileTop: riskPosition?.percentileTop ?? null,
            riskCandidatePool,
            upstreamConsumers: changeImpact.affectedCallers,
            entryPoints: changeImpact.components.directEntryPoints,
            callChainCallers: changeImpact.components.directCallChainCallers,
            affectedCallers: changeImpact.affectedCallers,
            methodsUsedByTarget: changeImpact.methodsUsedByTarget,
            affectedFiles: changeImpact.affectedFiles,
        },
        purposeGuess: guessPurpose(
            target.id,
            target.type,
            callers.map(item => ({
                id: item.id,
                depth: 1,
                callType: item.callType,
                via: item.via,
                file: item.file,
            })),
            calleeItems,
            navigation.routeEntries,
            navigation.bladeEntries,
            dependencies,
            {
                changeRisk: changeImpact.risk,
                impactScore: changeImpact.score,
                riskRank: riskPosition?.riskRank ?? null,
                riskPopulation: riskRanking.population,
                riskPercentileTop: riskPosition?.percentileTop ?? null,
                riskCandidatePool,
                upstreamConsumers: changeImpact.affectedCallers,
                entryPoints: changeImpact.components.directEntryPoints,
                callChainCallers: changeImpact.components.directCallChainCallers,
                affectedCallers: changeImpact.affectedCallers,
                methodsUsedByTarget: changeImpact.methodsUsedByTarget,
                affectedFiles: changeImpact.affectedFiles,
            },
        ),
        callers: callers.map(item => ({
            id: item.id,
            depth: 1,
            callType: item.callType,
            via: item.via,
            file: item.file,
        })),
        graphEntries: navigation.graphEntries,
        callees: calleeItems,
        calleesTruncated,
        dependencies,
        inheritance,
        architecture: filteredArchitecture,
        cycles: filteredCycles,
        affectedFiles: changeImpact.affectedFilesList,
        navigation,
    };

    if (jsonOutput) {
        const output = JSON.stringify(payload, null, 2);
        console.log(output);
        if (outputPath) {
            fs.writeFileSync(outputPath, output, "utf8");
        }
        process.exit(0);
    }

    const markdown = compactOutput ? renderCompactMarkdown(payload) : renderDefaultMarkdown(payload);

    console.log(markdown);
    if (outputPath) {
        fs.writeFileSync(outputPath, markdown, "utf8");
    }
} finally {
    db.close();
}

