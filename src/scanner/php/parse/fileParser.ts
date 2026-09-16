import Parser from "tree-sitter";
import fs from "node:fs";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";

function maskSyntax(value: string): string {
    return value.replace(/[^\r\n]/g, " ");
}

function findClosingBrace(source: string, openIndex: number): number | undefined {
    let depth = 0;
    let quote: string | undefined;
    let lineComment = false;
    let blockComment = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index]!;
        const next = source[index + 1];

        if (lineComment) {
            if (char === "\n") lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === "*" && next === "/") {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (char === "\\") {
                index += 1;
            } else if (char === quote) {
                quote = undefined;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char === "/" && next === "/") {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === "/" && next === "*") {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === "#") {
            lineComment = true;
            continue;
        }
        if (char === "{") depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    return undefined;
}

function maskEnumConstants(source: string): string {
    const enumPattern = /\benum\s+[A-Za-z_][\w]*(?:\s*:\s*[A-Za-z_\\][\w\\]*)?\s*\{/g;
    const constantPattern = /^[ \t]*(?:(?:public|protected|private)\s+)?const\s+(?:(?:[?A-Za-z_\\][\w\\|&?]*)\s+)?[A-Za-z_][\w]*\s*=\s*[^;\n]+;[ \t]*$/gm;
    let result = source;
    let match = enumPattern.exec(source);

    while (match) {
        const openIndex = source.indexOf("{", match.index);
        const closeIndex = findClosingBrace(source, openIndex);
        if (closeIndex === undefined) break;

        const body = result.slice(openIndex + 1, closeIndex);
        const maskedBody = body.replace(constantPattern, value => maskSyntax(value));
        result = result.slice(0, openIndex + 1) + maskedBody + result.slice(closeIndex);
        enumPattern.lastIndex = closeIndex + 1;
        match = enumPattern.exec(source);
    }

    return result;
}

function normalizePhpForTreeSitter(source: string): string {
    let normalized = maskEnumConstants(source);

    // tree-sitter-php 0.22 parses match expressions and scalar casts, but
    // misparses a scalar cast applied directly to a match expression.
    normalized = normalized.replace(
        /\((?:bool|boolean|int|integer|float|double|string|array|object|unset|binary)\)(?=\s*match\s*\()/g,
        value => maskSyntax(value)
    );

    return normalized;
}

export function parsePhpSource(parser: Parser, source: string): Parser.Tree {
    const tree = parseTreeSitterSource(parser, source);
    if (!tree.rootNode.hasError) {
        return tree;
    }

    const normalized = normalizePhpForTreeSitter(source);
    if (normalized === source) {
        return tree;
    }

    const normalizedTree = parseTreeSitterSource(parser, normalized);
    return normalizedTree.rootNode.hasError ? tree : normalizedTree;
}

export function parsePhpFile(parser: Parser ,filePath:string):Parser.Tree {
    const source = fs.readFileSync(filePath, "utf-8");
    return parsePhpSource(parser, source);
}
