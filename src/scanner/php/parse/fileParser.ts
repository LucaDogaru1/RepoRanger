import Parser from "tree-sitter";
import fs from "node:fs";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";

export function parsePhpSource(parser: Parser, source: string): Parser.Tree {
    return parseTreeSitterSource(parser, source);
}

export function parsePhpFile(parser: Parser ,filePath:string):Parser.Tree {
    const source = fs.readFileSync(filePath, "utf-8");
    return parsePhpSource(parser, source);
}
