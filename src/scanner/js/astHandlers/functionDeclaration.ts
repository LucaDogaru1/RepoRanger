import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { extractComponentKeywords } from "../resolvers/keyWordExtractor";
import { JsWalkContext } from "../walk/context";
import { attachVueComponentRoles } from "../semantic/componentRoles";

export function functionDeclarationType(
    node: Parser.SyntaxNode,
    context: JsWalkContext,
    options?: { exported?: boolean }
): string {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text;
    if (!name) {
        return "";
    }

    const functionId = `${context.moduleId}::${name}`;
    const keywords = extractComponentKeywords(node, { seed: name, skipStrings: true });
    const nodeType = options?.exported && name.startsWith("use") ? "composable" : "method";

    graph.nodes.set(functionId, {
        id: functionId,
        parent: context.moduleId,
        type: nodeType,
        name,
        file: context.file,
        keywords,
        description: options?.exported ? "Exported function" : "Function declaration",
    });

    graph.edges.set(`${context.moduleId}->${functionId}`, {
        from: context.moduleId,
        to: functionId,
        type: "CONTAINS",
    });

    if (options?.exported && name.startsWith("use")) {
        attachVueComponentRoles(functionId, name, context.file);
    }

    return functionId;
}

const FUNCTION_VALUE_TYPES = new Set(["arrow_function", "function_expression", "function"]);

export function functionVariableDeclarationType(
    node: Parser.SyntaxNode,
    context: JsWalkContext,
): string {
    const parent = node.parent;
    const exported = parent?.type === "export_statement";
    const topLevel = parent?.type === "program" || (exported && parent?.parent?.type === "program");
    if (!topLevel) return "";

    const declarators = node.namedChildren.filter(child => child.type === "variable_declarator");
    if (declarators.length !== 1) return "";

    const declarator = declarators[0]!;
    const value = declarator.childForFieldName("value");
    if (!value || !FUNCTION_VALUE_TYPES.has(value.type)) return "";
    if (declarator.childForFieldName("name")?.type !== "identifier") return "";

    return functionDeclarationType(declarator, context, { exported });
}
