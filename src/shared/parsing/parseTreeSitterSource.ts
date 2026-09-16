import Parser from "tree-sitter";

// The tree-sitter Node binding uses a 32 KiB default read buffer. Passing a
// larger source as one string can make the native binding throw
// `Invalid argument`, so every scanner grammar reads from bounded chunks.
const INPUT_CHUNK_SIZE = 16 * 1024;

function isHighSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
}

function isLowSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xDC00 && codeUnit <= 0xDFFF;
}

export function parseTreeSitterSource(parser: Parser, source: string): Parser.Tree {
    return parser.parse(offset => {
        let end = Math.min(source.length, offset + INPUT_CHUNK_SIZE);

        // Tree-sitter's JavaScript binding uses UTF-16 offsets. Keep astral
        // characters intact so syntax-node offsets and node.text stay exact.
        if (
            end < source.length &&
            end > offset &&
            isHighSurrogate(source.charCodeAt(end - 1)) &&
            isLowSurrogate(source.charCodeAt(end))
        ) {
            end += 1;
        }

        return source.slice(offset, end);
    });
}
