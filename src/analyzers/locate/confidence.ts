import type { SearchMatch } from "../../graph/queries/searchNodes";
import type { GraphFreshness } from "../../graph/queries/graphFreshness";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface LocateConfidence {
    level: ConfidenceLevel;
    reasons: string[];
    fallback: string | null;
}

export interface ConfidenceInput {
    query: string;
    match: SearchMatch;
    fileCount: number;
    hasEntry: boolean;
    missingCoverage: string[];
    ambiguous: boolean;
    routeHandlerCount?: number;
    missingRouteAction?: string;
    freshness: GraphFreshness;
}

function rgPattern(query: string): string {
    const tokens = query
        .replace(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, "")
        .split(/[\s/\\:{}.]+/)
        .filter(token => token.length >= 3 && !/^(api|v\d+|param|id)$/i.test(token));

    const pattern = tokens.length > 0 ? tokens.join("|") : query.trim();
    return `rg -n --glob '!vendor' --glob '!node_modules' '${pattern.replace(/'/g, "'\\''")}'`;
}

export function scoreConfidence(input: ConfidenceInput): LocateConfidence {
    const reasons: string[] = [];
    let penalty = 0;

    if (input.match.score < 500) {
        penalty += 2;
        reasons.push(`weak match (score ${input.match.score}, ${input.match.matchReason})`);
    } else if (input.match.score < 900) {
        penalty += 1;
        reasons.push(`indirect match (${input.match.matchReason})`);
    }

    if (input.ambiguous) {
        penalty += 1;
        reasons.push("several candidates scored alike");
    }

    if ((input.routeHandlerCount ?? 0) > 1) {
        penalty += 1;
        reasons.push(`URL is handled by ${input.routeHandlerCount} controllers in different route files`);
    }

    if (input.missingRouteAction) {
        penalty += 1;
        reasons.push(`route action ${input.missingRouteAction} is not defined in the controller or its scanned parents`);
    }

    if (!input.hasEntry) {
        penalty += 1;
        reasons.push("no entry point in graph");
    }

    if (input.fileCount === 0) {
        penalty += 2;
        reasons.push("no source locations recorded");
    }

    if (input.freshness.commitDrift === "different") {
        penalty += 1;
        reasons.push(`graph built at ${input.freshness.commit?.slice(0, 8)}, not current HEAD`);
    }

    if (input.freshness.ageDays !== null && input.freshness.ageDays > 14) {
        penalty += 1;
        reasons.push(`graph is ${input.freshness.ageDays} days old`);
    }

    if (input.freshness.includesTests === false) {
        reasons.push("graph was scanned without tests");
    }

    if (input.missingCoverage.length >= 3) {
        penalty += 1;
        reasons.push(`coverage gaps: ${input.missingCoverage.join(", ")}`);
    }

    const level: ConfidenceLevel = penalty >= 3 ? "low" : penalty >= 1 ? "medium" : "high";

    return {
        level,
        reasons,
        fallback: level === "high" ? null : rgPattern(input.query),
    };
}
