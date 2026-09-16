import fs from "node:fs";
import path from "node:path";

export function toLineNumber(row: number): number {
    return row + 1;
}

export function formatLineRange(
    file: string,
    startRow: number | null,
    endRow: number | null,
): string {
    if (startRow === null) {
        return file;
    }
    const start = toLineNumber(startRow);
    if (endRow === null || endRow === startRow) {
        return `${file}:${start}`;
    }
    return `${file}:${start}-${toLineNumber(endRow)}`;
}

export interface SnippetOptions {
    sourceRoot: string;
    maxLines?: number;
}

const fileCache = new Map<string, string[] | null>();

function readLines(absolutePath: string): string[] | null {
    const cached = fileCache.get(absolutePath);
    if (cached !== undefined) {
        return cached;
    }

    let lines: string[] | null = null;
    try {
        const stats = fs.statSync(absolutePath);
        if (stats.isFile() && stats.size <= 2_000_000) {
            lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
        }
    } catch {
        lines = null;
    }

    fileCache.set(absolutePath, lines);
    return lines;
}

function resolveCandidates(sourceRoot: string, file: string): string[] {
    if (path.isAbsolute(file)) {
        return [file];
    }

    const candidates = [path.join(sourceRoot, file)];
    const withoutFirstSegment = file.split("/").slice(1).join("/");
    if (withoutFirstSegment) {
        candidates.push(path.join(sourceRoot, withoutFirstSegment));
    }
    return candidates;
}

export function readSourceSnippet(
    file: string,
    startRow: number | null,
    options: SnippetOptions,
): string[] | null {
    if (startRow === null) {
        return null;
    }

    const maxLines = Math.max(1, options.maxLines ?? 2);

    for (const candidate of resolveCandidates(options.sourceRoot, file)) {
        const lines = readLines(candidate);
        if (!lines) {
            continue;
        }

        const snippet: string[] = [];
        for (let index = startRow; index < lines.length && snippet.length < maxLines; index += 1) {
            const text = lines[index]!.trim();
            if (text.length === 0) {
                continue;
            }
            snippet.push(`${toLineNumber(index)}| ${text.slice(0, 120)}`);
        }

        if (snippet.length > 0) {
            return snippet;
        }
    }

    return null;
}

export function resetSnippetCache(): void {
    fileCache.clear();
}
