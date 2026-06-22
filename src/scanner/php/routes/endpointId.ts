export function normalizeEndpointPath(path: string): string {
    return path
        .replace(/\{[^}]+\}/g, "{param}")
        .replace(/\/+/g, "/")
        .replace(/\/$/, "") || "/";
}

export function endpointNodeId(method: string, path: string): string {
    const normalized = normalizeEndpointPath(path);
    return `api:${method.toUpperCase()}:${normalized}`;
}
