export function canonicalFieldName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^request_field:/i, "")
        .replace(/^model_field:[^:]+:/i, "")
        .replace(/^response_field:[^:]+:/i, "")
        .replace(/[_-]/g, "");
}

function fieldPathSegments(value: string): string[] {
    return value
        .trim()
        .toLowerCase()
        .split(".")
        .map(segment => canonicalFieldName(segment))
        .filter(Boolean);
}

export function fieldNamesMatch(a: string, b: string): boolean {
    const left = a.trim().toLowerCase();
    const right = b.trim().toLowerCase();

    if (canonicalFieldName(left) === canonicalFieldName(right)) {
        return true;
    }

    const leftSegments = fieldPathSegments(left);
    const rightSegments = fieldPathSegments(right);

    if (leftSegments.length === 0 || rightSegments.length === 0) {
        return false;
    }

    if (left.includes(".") && right.includes(".")) {
        const leftCanonical = leftSegments.join(".");
        const rightCanonical = rightSegments.join(".");
        return (
            leftCanonical === rightCanonical ||
            leftCanonical.endsWith(`.${rightCanonical}`) ||
            rightCanonical.endsWith(`.${leftCanonical}`)
        );
    }

    const shortSegments = left.includes(".") ? rightSegments : leftSegments;
    const longSegments = left.includes(".") ? leftSegments : rightSegments;
    const shortKey = shortSegments[shortSegments.length - 1];
    const longKey = longSegments[longSegments.length - 1];

    return shortKey === longKey && shortKey.length >= 2;
}

export function haystackContainsField(haystack: string, field: string): boolean {
    const canonical = canonicalFieldName(field);
    if (!canonical) {
        return false;
    }

    const normalizedHaystack = haystack.toLowerCase();
    const normalizedField = field.trim().toLowerCase();

    if (normalizedHaystack.includes(normalizedField)) {
        return true;
    }

    const tokens = normalizedHaystack
        .split(/[^a-z0-9._]+/)
        .filter(Boolean);

    if (tokens.some(token => fieldNamesMatch(token, field))) {
        return true;
    }

    return tokens.some(token => canonicalFieldName(token) === canonical);
}
