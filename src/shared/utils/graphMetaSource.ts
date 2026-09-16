import { execFileSync } from "node:child_process";

export interface GraphMetaInput {
    rootDirs: string[];
    includeTests: boolean;
    language: string;
    nodeCount: number;
    edgeCount: number;
}

function git(rootDir: string, args: string[]): string | null {
    try {
        return execFileSync("git", args, {
            cwd: rootDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null;
    } catch {
        return null;
    }
}

export function collectGraphMeta(input: GraphMetaInput): Record<string, string> {
    const rootDir = input.rootDirs[0] ?? process.cwd();
    const meta: Record<string, string> = {
        scanned_at: new Date().toISOString(),
        scan_roots: input.rootDirs.join(","),
        scan_language: input.language,
        scan_includes_tests: String(input.includeTests),
        node_count: String(input.nodeCount),
        edge_count: String(input.edgeCount),
    };

    const commit = git(rootDir, ["rev-parse", "HEAD"]);
    if (commit) meta.git_commit = commit;

    const branch = git(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch) meta.git_branch = branch;

    const commitDate = git(rootDir, ["show", "-s", "--format=%cI", "HEAD"]);
    if (commitDate) meta.git_commit_date = commitDate;

    const dirty = git(rootDir, ["status", "--porcelain"]);
    if (dirty !== null) meta.git_dirty = String(dirty.length > 0);

    return meta;
}
