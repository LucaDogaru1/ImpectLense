/** Built-in methods/globals — never treated as project symbols. */
export const BUILTIN_CALLS = new Set([
    "map",
    "filter",
    "includes",
    "slice",
    "splice",
    "push",
    "pop",
    "shift",
    "unshift",
    "join",
    "split",
    "trim",
    "tolowercase",
    "touppercase",
    "tostring",
    "valueof",
    "keys",
    "values",
    "entries",
    "set",
    "get",
    "has",
    "add",
    "delete",
    "foreach",
    "reduce",
    "find",
    "some",
    "every",
    "sort",
    "reverse",
    "concat",
    "flat",
    "flatmap",
    "boolean",
    "structuredclone",
    "parseint",
    "parsefloat",
    "isnan",
    "isfinite",
    "object",
    "array",
    "string",
    "number",
    "promise",
    "date",
    "math",
    "settimeout",
    "setinterval",
    "cleartimeout",
    "clearinterval",
]);

/** Browser / runtime APIs — tracked separately from project CALLS. */
export const EXTERNAL_API_CALLS = new Set([
    "fetch",
    "json",
    "stringify",
    "parse",
    "text",
    "blob",
    "arraybuffer",
    "formdata",
    "headers",
    "request",
    "response",
]);

export function normalizeCalleeName(name: string): string {
    return name.toLowerCase();
}

export function isBuiltinCall(callee: string): boolean {
    return BUILTIN_CALLS.has(normalizeCalleeName(callee));
}

export function isExternalApiCall(callee: string): boolean {
    return EXTERNAL_API_CALLS.has(normalizeCalleeName(callee));
}
