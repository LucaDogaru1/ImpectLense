export function canonicalFieldName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^request_field:/i, "")
        .replace(/^model_field:[^:]+:/i, "")
        .replace(/^response_field:[^:]+:/i, "")
        .replace(/[_-]/g, "");
}

export function fieldNamesMatch(a: string, b: string): boolean {
    const left = canonicalFieldName(a);
    const right = canonicalFieldName(b);

    if (!left || !right) {
        return false;
    }

    return left === right;
}

export function haystackContainsField(haystack: string, field: string): boolean {
    const canonical = canonicalFieldName(field);
    if (!canonical) {
        return false;
    }

    const tokens = haystack
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    return tokens.some(token => canonicalFieldName(token) === canonical);
}
