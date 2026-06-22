import Parser from "tree-sitter";

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
    visibility?: string;
    startPosition?: Parser.Point;
    endPosition?: Parser.Point;
    scope?: string;
    keywords?: string[];
    description?: string;
    dataType?: string;
}

export interface Graph {
    nodes: Map<string, GraphNode>;
    edges: Map<string, GraphEdge>;
}