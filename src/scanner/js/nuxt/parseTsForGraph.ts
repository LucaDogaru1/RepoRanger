import Parser from "tree-sitter";
import { createTsParser } from "../ts/parser";
import { stripTypescript } from "./stripTypescript";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";

export function prepareTsSourceForJsParser(source: string): string {
    return stripTypescript(source);
}

export function parseTsSourceForGraph(source: string, parser?: Parser): Parser.Tree {
    const tsParser = parser ?? createTsParser();
    return parseTreeSitterSource(tsParser, source);
}

export function tsSourceParsesAsJs(source: string, parser?: Parser): boolean {
    const tree = parseTsSourceForGraph(source, parser);
    return !tree.rootNode.hasError;
}
