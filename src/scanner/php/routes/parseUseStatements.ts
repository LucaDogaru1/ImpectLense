export function parseUseStatements(source: string): Map<string, string> {
    const imports = new Map<string, string>();

    for (const match of source.matchAll(/^use\s+([^;]+);/gm)) {
        const statement = match[1]?.trim() ?? "";
        if (!statement || statement.startsWith("function ")) {
            continue;
        }

        const parts = statement.split(/\s+as\s+/i);
        const fqcn = parts[0]?.trim().replace(/^\\/, "") ?? "";
        const alias = (parts[1]?.trim() || fqcn.split("\\").pop()) ?? "";

        if (fqcn && alias) {
            imports.set(alias, fqcn);
        }
    }

    return imports;
}

export function resolveControllerClass(raw: string, imports: Map<string, string>): string {
    const trimmed = raw.trim().replace(/^\\/, "");
    if (trimmed.includes("\\")) {
        return trimmed;
    }

    return imports.get(trimmed) ?? trimmed;
}
