export interface ParsedEndpointId {
    method: string;
    path: string;
}

/** Normalize path segments so `{id}` and `{presetId}` match the same route. */
export function normalizeEndpointPath(path: string): string {
    return path
        .replace(/\$\{[^}]+\}/g, "{param}")
        .replace(/\{[^}]+\}/g, "{param}")
        .replace(/\/+/g, "/")
        .replace(/\/$/, "") || "/";
}

export function endpointCanonicalKey(method: string, path: string): string {
    return `${method.toUpperCase()}:${normalizeEndpointPath(path)}`;
}

export function canonicalEndpointId(method: string, path: string): string {
    return `api:${endpointCanonicalKey(method, path)}`;
}

export function parseApiEndpointId(id: string): ParsedEndpointId | null {
    if (!id.startsWith("api:")) {
        return null;
    }

    const rest = id.slice(4);
    const colonIndex = rest.indexOf(":");
    if (colonIndex <= 0) {
        return null;
    }

    return {
        method: rest.slice(0, colonIndex).toUpperCase(),
        path: rest.slice(colonIndex + 1),
    };
}

export function canonicalKeyFromEndpointId(id: string): string | null {
    const parsed = parseApiEndpointId(id);
    if (!parsed) {
        return null;
    }

    return endpointCanonicalKey(parsed.method, parsed.path);
}
