const BUILTIN_TYPE_NAMES = new Set([
    "array",
    "bool",
    "boolean",
    "callable",
    "false",
    "float",
    "int",
    "integer",
    "iterable",
    "mixed",
    "never",
    "null",
    "object",
    "resource",
    "string",
    "true",
    "void",
    "static",
    "self",
    "parent",
]);

export function isBuiltinTypeName(typeName: string): boolean {
    const normalized = typeName.replace(/^\?/, "").split("|")[0]?.trim().toLowerCase() ?? "";

    return BUILTIN_TYPE_NAMES.has(normalized);
}
