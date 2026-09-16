import Parser from "tree-sitter";
import fs from "node:fs";
import { ScannedJsFile } from "../scanJs";
import walk, { createWalkContext } from "../walk/jsWalker";
import { parseTreeSitterSource } from "../../../shared/parsing/parseTreeSitterSource";

export function processTsFile(file: ScannedJsFile, parser: Parser): void {
    const source = fs.readFileSync(file.absolutePath, "utf-8");
    const tree = parseTreeSitterSource(parser, source);

    if (tree.rootNode.hasError) {
        throw new Error(`parse errors in ${file.relativePath}`);
    }

    walk(tree.rootNode, file.relativePath, createWalkContext(file.relativePath));
}
