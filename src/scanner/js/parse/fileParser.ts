import Parser from "tree-sitter";
import fs from "node:fs";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";

export function parseJsFile(parser: Parser, filePath: string): Parser.Tree {
    const source = fs.readFileSync(filePath, "utf-8");
    return parseTreeSitterSource(parser, source);
}
