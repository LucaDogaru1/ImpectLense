import { graph } from "../../../graph/graph";
import { isBuiltinTypeName } from "./builtinTypes";

export function modelFieldId(className: string, fieldName: string): string {
    return `model_field:${className}:${fieldName}`;
}

export function responseFieldId(className: string, fieldName: string): string {
    return `response_field:${className}:${fieldName}`;
}

export function ensureModelField(className: string, fieldName: string, file?: string): string {
    const id = modelFieldId(className, fieldName);
    const leafClassName = className.split("\\").pop() ?? className;

    if (isBuiltinTypeName(leafClassName)) {
        return id;
    }

    graph.nodes.set(id, {
        id,
        type: "model_field",
        name: fieldName,
        parent: className,
        file,
        keywords: [fieldName, "model", "field", "persisted"],
    });

    graph.edges.set(`${className}->${id}`, {
        from: className,
        to: id,
        type: "CONTAINS",
    });

    return id;
}

export function ensureResponseField(className: string, fieldName: string, file?: string): string {
    const id = responseFieldId(className, fieldName);

    graph.nodes.set(id, {
        id,
        type: "response_field",
        name: fieldName,
        parent: className,
        file,
        keywords: [fieldName, "response", "api", "serialize", "output"],
    });

    graph.edges.set(`${className}->${id}`, {
        from: className,
        to: id,
        type: "CONTAINS",
    });

    return id;
}

export function linkPersists(
    methodId: string,
    modelFieldNodeId: string,
    via?: string
): void {
    graph.edges.set(`${methodId}->${modelFieldNodeId}:PERSISTS`, {
        from: methodId,
        to: modelFieldNodeId,
        type: "PERSISTS",
        via: via ?? undefined,
        confidence: 1,
        reason: "Method writes/persists model field",
    });
}

export function linkSerializes(
    methodId: string,
    responseFieldNodeId: string
): void {
    graph.edges.set(`${methodId}->${responseFieldNodeId}:SERIALIZES`, {
        from: methodId,
        to: responseFieldNodeId,
        type: "SERIALIZES",
        confidence: 1,
        reason: "Method serializes field in API/output payload",
    });
}

export function cleanPhpString(value: string): string {
    return value
        .trim()
        .replace(/^['"]/, "")
        .replace(/['"]$/, "");
}

export function isLikelyFieldName(value: string): boolean {
    return /^[a-zA-Z0-9_][a-zA-Z0-9_.]*$/.test(value) && value.length >= 2;
}
