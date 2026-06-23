import path from "node:path";
import { getScanConfig } from "../../../shared/config/scanRuntime";

const PACKAGE_ROOT_PATTERN = /^(packages\/[^/]+|apps\/[^/]+|clientPackages\/[^/]+)/;

function resolvePackageRootPrefix(currentFile: string, importSource: string): string {
    const rootMatch = currentFile.match(PACKAGE_ROOT_PATTERN);
    if (!rootMatch) {
        return importSource;
    }

    const root = rootMatch[1];

    if (importSource === "~" || importSource.startsWith("~/")) {
        const suffix = importSource === "~" ? "" : importSource.slice(2);
        return `${root}/${suffix}`;
    }

    if (importSource === "@/" || importSource.startsWith("@/")) {
        const suffix = importSource === "@/" ? "" : importSource.slice(2);
        return `${root}/${suffix}`;
    }

    return importSource;
}

function applyPathAliases(importSource: string): string {
    const aliases = getScanConfig().pathAliases ?? {};
    const entries = Object.entries(aliases).sort((left, right) => right[0].length - left[0].length);

    for (const [alias, target] of entries) {
        if (importSource === alias || importSource.startsWith(alias)) {
            return `${target}${importSource.slice(alias.length)}`;
        }
    }

    return importSource;
}

function withDefaultJsExtension(relativePath: string): string {
    if (/\.(js|ts|vue|mjs|cjs|jsx|tsx)$/i.test(relativePath)) {
        return relativePath;
    }

    return `${relativePath}.js`;
}

export function resolveImportSource(currentFile: string, importSource: string): string {
    const normalizedFile = currentFile.replace(/\\/g, "/");
    let cleaned = resolvePackageRootPrefix(
        normalizedFile,
        importSource.replace(/^["']|["']$/g, "")
    );
    cleaned = applyPathAliases(cleaned);
    if (!cleaned.startsWith(".")) {
        return withDefaultJsExtension(cleaned);
    }

    const dir = path.posix.dirname(currentFile.replace(/\\/g, "/"));
    const joined = path.posix.normalize(path.posix.join(dir, cleaned));
    const normalized = joined.startsWith(".") ? joined.slice(2) : joined;
    return withDefaultJsExtension(normalized);
}

export function toJsModuleId(relativePath: string): string {
    return `js:${relativePath.replace(/\\/g, "/")}`;
}
