import Parser from "tree-sitter";
import {
    normalizeInferredFetchPath,
    resolveTemplateString,
} from "../resolvers/fetchEndpointExtractor";
import { JsWalkContext } from "../walk/context";

function readUrlExpression(
    node: Parser.SyntaxNode | null | undefined,
    constants: Map<string, string>
): string | null {
    if (!node) {
        return null;
    }

    let expression = node;
    if (expression.type === "parenthesized_expression") {
        expression = expression.namedChildren[0] ?? expression;
    }

    if (expression.type === "template_string") {
        return normalizeInferredFetchPath(resolveTemplateString(expression, constants));
    }

    if (expression.type === "call_expression") {
        const callee = expression.childForFieldName("function");
        if (callee?.type === "identifier") {
            return constants.get(callee.text) ?? null;
        }
    }

    return null;
}

function readArrowFunctionUrl(
    valueNode: Parser.SyntaxNode,
    constants: Map<string, string>
): string | null {
    if (valueNode.type !== "arrow_function") {
        return null;
    }

    return readUrlExpression(valueNode.childForFieldName("body"), constants);
}

function readComputedUrl(
    valueNode: Parser.SyntaxNode,
    constants: Map<string, string>
): string | null {
    if (valueNode.type !== "call_expression") {
        return null;
    }

    const callee = valueNode.childForFieldName("function");
    if (callee?.type !== "identifier" || callee.text !== "computed") {
        return null;
    }

    const args = valueNode.childForFieldName("arguments");
    const callback = args?.namedChildren[0];
    if (!callback || callback.type !== "arrow_function") {
        return null;
    }

    return readUrlExpression(callback.childForFieldName("body"), constants);
}

function readDeclaratorValue(node: Parser.SyntaxNode): string | null {
    const valueNode = node.childForFieldName("value");
    if (!valueNode) {
        return null;
    }

    if (valueNode.type === "string") {
        const fragment = valueNode.children.find(child => child.type === "string_fragment");
        return fragment?.text ?? valueNode.text.replace(/^["'`]|["'`]$/g, "");
    }

    return null;
}

export function trackModuleConstants(node: Parser.SyntaxNode, context: JsWalkContext): void {
    for (const child of node.children) {
        if (child.type !== "variable_declarator") {
            continue;
        }

        const name = child.childForFieldName("name")?.text;
        const valueNode = child.childForFieldName("value");
        const value =
            readDeclaratorValue(child) ??
            (valueNode
                ? readArrowFunctionUrl(valueNode, context.moduleConstants) ??
                    readComputedUrl(valueNode, context.moduleConstants)
                : null);
        if (name && value) {
            context.moduleConstants.set(name, value);
        }
    }
}
