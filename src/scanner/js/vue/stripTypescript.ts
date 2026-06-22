/** Rough TS → JS strip so tree-sitter-javascript can parse Vue <script lang="ts">. */
export function stripTypescript(source: string): string {
    let result = source;

    result = result.replace(/^\s*type\s+[A-Za-z0-9_<>,\s|&]+=\s*[\s\S]*?;\s*$/gm, "");
    result = result.replace(/^\s*interface\s+[A-Za-z0-9_<>,\s|&]+\s*\{[\s\S]*?\}\s*$/gm, "");
    result = result.replace(/\)\s*:\s*[A-Za-z0-9_<>,[\]|&?\s]+(\s*\{)/g, ")$1");
    result = result.replace(/:\s*[A-Za-z0-9_<>,[\]|&?\s]+(?=\s*[,)=;])/g, "");
    result = result.replace(/\bas\s+[A-Za-z0-9_<>,[\]|&?\s]+/g, "");
    result = result.replace(/<[A-Za-z0-9_,\s|&]+>/g, "");
    result = result.replace(/\?\./g, ".");

    return result;
}
