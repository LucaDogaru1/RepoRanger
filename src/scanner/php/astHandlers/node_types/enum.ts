import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { GraphNode } from "../../../../graph/GraphTypes";
import { WalkContext } from "../../walk/context";

export function enumType(
    node: Parser.SyntaxNode,
    file: string,
    context: WalkContext
): string {
    const name = node.childForFieldName("name")?.text;
    if (!name) return "";

    const id = context.currentNamespace ? `${context.currentNamespace}\\${name}` : name;
    graph.nodes.set(id, <GraphNode>{
        id,
        type: "enum",
        name,
        file,
        startPosition: node.startPosition,
        endPosition: node.endPosition,
    });

    return id;
}
