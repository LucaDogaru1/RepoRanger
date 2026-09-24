import Parser from "tree-sitter";
import type { CodeRuntime } from "../shared/classification/codeLocation";

export interface GraphEdge {
    from: string;
    to: string;
    type: string;

    callType?: string;
    via?: string;

    argumentIndex?: number;
    confidence?: number;
    reason?: string;
}

export interface GraphNode {
    id: string;
    parent?: string;
    type: string;
    name: string;
    file?: string;
    isStatic?: boolean;
    isAbstract?: boolean;
    returnType?: string;
    visibility?: string;
    startPosition?: Parser.Point;
    endPosition?: Parser.Point;
    scope?: string;
    keywords?: string[];
    description?: string;
    dataType?: string;
    workspace?: string;
    packageName?: string;
    runtime?: CodeRuntime;
    runtimeConfidence?: number;
    runtimeReasons?: string[];
    sources?: string[];
    scopeDirectory?: string;
    routeMount?: string;
}

export interface Graph {
    nodes: Map<string, GraphNode>;
    edges: Map<string, GraphEdge>;
}
