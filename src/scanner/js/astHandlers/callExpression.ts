import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import {
    extractFetchEndpoint,
    fetchEndpointNodeId,
    isDirectFetchCallee,
} from "../resolvers/fetchEndpointExtractor";
import { recordHttpClientEndpoint } from "../resolvers/httpClientCallExtractor";
import { isBuiltinCall, isExternalApiCall, normalizeCalleeName } from "../resolvers/builtins";
import { JsWalkContext } from "../walk/context";

function readCalleeName(node: Parser.SyntaxNode): string | null {
    const fn = node.childForFieldName("function");
    if (!fn) {
        return null;
    }

    if (fn.type === "identifier") {
        return fn.text;
    }

    if (fn.type === "member_expression") {
        const property = fn.childForFieldName("property");
        return property?.text ?? null;
    }

    return null;
}

function recordExternalApiCall(
    caller: string,
    callee: string,
    via: string,
    context: JsWalkContext
): void {
    const targetId = `external:${normalizeCalleeName(callee)}`;

    if (!graph.nodes.has(targetId)) {
        graph.nodes.set(targetId, {
            id: targetId,
            type: "external_api_call",
            name: callee,
            file: context.file,
            description: "Browser or runtime API call",
        });
    }

    graph.edges.set(`${caller}->${targetId}:EXTERNAL:${via}`, {
        from: caller,
        to: targetId,
        type: "EXTERNAL_API_CALL",
        via,
        confidence: 0.2,
        reason: "Runtime API — not a project symbol",
    });
}

function recordFetchEndpoint(
    callNode: Parser.SyntaxNode,
    caller: string,
    context: JsWalkContext,
    via: string
): void {
    const endpoint = extractFetchEndpoint(callNode, context);
    if (!endpoint) {
        recordExternalApiCall(caller, via, via, context);
        return;
    }

    const endpointId = fetchEndpointNodeId(endpoint);
    const label = `${endpoint.method} ${endpoint.path}`;

    graph.nodes.set(endpointId, {
        id: endpointId,
        type: "api_endpoint",
        name: label,
        file: context.file,
        keywords: [
            endpoint.method.toLowerCase(),
            ...endpoint.path.split("/").filter(part => part && !part.startsWith("{")),
        ],
        description: `HTTP endpoint inferred from ${via}()`,
    });

    graph.edges.set(`${caller}->${endpointId}:HTTP`, {
        from: caller,
        to: endpointId,
        type: "HTTP_REQUEST",
        via,
        reason: label,
        confidence: via === "fetch" ? 0.9 : 0.88,
    });
}

function readDirectFetchCallee(node: Parser.SyntaxNode): string | null {
    const fn = node.childForFieldName("function");
    if (fn?.type !== "identifier") {
        return null;
    }

    return isDirectFetchCallee(fn.text) ? fn.text : null;
}

export function callExpressionType(node: Parser.SyntaxNode, context: JsWalkContext): void {
    const callee = readCalleeName(node);
    const caller = context.currentFunction ?? context.currentComponent ?? context.moduleId;
    if (!callee || !caller) {
        return;
    }

    if (isBuiltinCall(callee)) {
        return;
    }

    if (recordHttpClientEndpoint(node, caller, context)) {
        return;
    }

    const fetchCallee = readDirectFetchCallee(node);
    if (fetchCallee) {
        recordFetchEndpoint(node, caller, context, fetchCallee);
        return;
    }

    if (isExternalApiCall(callee)) {
        recordExternalApiCall(caller, callee, callee, context);
        return;
    }

    const importTarget = context.imports.get(callee);
    const targetId = importTarget ? `${importTarget}::${callee}` : `${context.moduleId}::${callee}`;

    graph.edges.set(`${caller}->${targetId}:CALLS:${callee}`, {
        from: caller,
        to: targetId,
        type: "CALLS",
        via: callee,
        confidence: importTarget ? 0.8 : 0.4,
        reason: importTarget ? "Imported symbol call" : "Local or unresolved call",
    });
}
