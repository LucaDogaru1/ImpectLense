/**
 * Prepare Nuxt/Vue TypeScript for tree-sitter-javascript.
 * Heuristic strip — not a full TS compiler; targets composables, stores, and SFC script blocks.
 */

function removeBalancedBlock(source: string, openBraceIndex: number): number {
    let depth = 0;

    for (let index = openBraceIndex; index < source.length; index += 1) {
        const char = source[index];

        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return index + 1;
            }
        }
    }

    return source.length;
}

function lineStart(source: string, index: number): number {
    let start = index;

    while (start > 0 && source[start - 1] !== "\n") {
        start -= 1;
    }

    return start;
}

function removeTopLevelBlockDeclarations(source: string, keywords: string[]): string {
    let result = source;

    for (const keyword of keywords) {
        const pattern = new RegExp(`^\\s*(?:export\\s+)?${keyword}\\s+`, "gm");
        let match = pattern.exec(result);

        while (match) {
            const braceIndex = result.indexOf("{", match.index);

            if (braceIndex === -1) {
                match = pattern.exec(result);
                continue;
            }

            const end = removeBalancedBlock(result, braceIndex);
            const start = lineStart(result, match.index);
            result = `${result.slice(0, start)}${result.slice(end)}`;
            pattern.lastIndex = start;
            match = pattern.exec(result);
        }
    }

    return result;
}

function removeImportTypeStatements(source: string): string {
    let result = source;
    const pattern = /^\s*import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
    result = result.replace(pattern, "");

    result = result.replace(
        /import\s+\{([^}]+)\}\s*from\s+["'][^"']+["'];?/g,
        (statement, inner: string) => {
            const kept = inner
                .split(",")
                .map(part => part.trim())
                .filter(part => part.length > 0 && !part.startsWith("type "));

            if (kept.length === 0) {
                return "";
            }

            const fromMatch = statement.match(/from\s+["'][^"']+["'];?/);
            return `import { ${kept.join(", ")} } ${fromMatch?.[0] ?? ""}`;
        }
    );

    return result;
}

function removeExportTypeStatements(source: string): string {
    return source.replace(/^\s*export\s+type\s+[\s\S]*?;\s*$/gm, "");
}

function removeSingleLineTypeAliases(source: string): string {
    return source.replace(
        /^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*[^;\n]+;?\s*$/gm,
        ""
    );
}

function stripGenericInstantiations(source: string): string {
    let result = source;
    const pattern = /([A-Za-z_$][\w$]*)<(?:[^<>]|<[^<>]*>)*>/g;

    for (let pass = 0; pass < 8; pass += 1) {
        const next = result.replace(pattern, "$1");
        if (next === result) {
            break;
        }
        result = next;
    }

    return result;
}

function stripInlineObjectTypeAnnotations(source: string): string {
    return source.replace(/:\s*\{[^{}]*\[[^\]]+\][^{}]*\}(?=\s*=)/g, "");
}

function stripArrowFunctionReturnTypes(source: string): string {
    let result = source;

    result = result.replace(
        /\(([^)]*)\):\s*(?:string|number|boolean|void|unknown|any|never)\s*=>/g,
        "($1) =>"
    );
    result = result.replace(
        /\(([^)]*)\):\s*[A-Za-z_$][\w$|&[\]"'[\]]*(?:\s*\|\s*(?:null|[A-Za-z_$][\w$|&[\]"'[\]]*|\[\]))*\s*=>/g,
        "($1) =>"
    );
    result = result.replace(
        /\)\s*:\s*[A-Za-z_$][\w$|&[\]"'[\]]*(?:\s*\|\s*(?:null|[A-Za-z_$][\w$|&[\]"'[\]]*|\[\]))*\s*=>/g,
        ") =>"
    );

    return result;
}

function stripInlineObjectParameterTypes(source: string): string {
    return source.replace(/\((\w+):\s*\{[^{}]*\}\)/g, "($1)");
}

function stripTypeAssertions(source: string): string {
    let result = source;

    result = result.replace(/\s+as\s+const\b/g, "");
    result = result.replace(
        /\s+as\s+(?:[A-Za-z_$][\w$|&[\]"'.]*(?:\[[^\]]+\])?(?:\s*\|\s*(?:null|[A-Za-z_$][\w$|&[\]"'.]*|\[\]))*)+/g,
        ""
    );

    return result;
}

function stripColonTypeAnnotations(source: string): string {
    const typePattern =
        /:\s*(?:string|number|boolean|void|unknown|any|never|[A-Z][\w$|&[\]"'[\]]*)(?:\s*\|\s*(?:null|string|number|boolean|[A-Z][\w$|&[\]"'[\]]*|\[\]))*(?=\s*[,)={])/g;

    return source.replace(typePattern, "");
}

function stripTypeAnnotations(source: string): string {
    let result = source;

    result = stripArrowFunctionReturnTypes(result);
    result = stripInlineObjectParameterTypes(result);
    result = result.replace(/\)\s*:\s*[^{;]+(\s*\{)/g, ")$1");
    result = stripColonTypeAnnotations(result);
    result = stripTypeAssertions(result);

    return result;
}

function collapseBlankLines(source: string): string {
    return source.replace(/\n{3,}/g, "\n\n");
}

export function stripTypescript(source: string): string {
    let result = source;

    result = removeImportTypeStatements(result);
    result = removeExportTypeStatements(result);
    result = removeSingleLineTypeAliases(result);
    result = removeTopLevelBlockDeclarations(result, ["interface", "enum"]);
    result = stripInlineObjectTypeAnnotations(result);
    result = stripGenericInstantiations(result);
    result = stripTypeAnnotations(result);
    result = collapseBlankLines(result);

    return result;
}
