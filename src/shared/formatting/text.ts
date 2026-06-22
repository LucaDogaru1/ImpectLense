export function formatLocation(
    file: string | null | undefined,
    startRow: number | null | undefined,
    endRow: number | null | undefined,
): string | null {
    if (!file) {
        return null;
    }

    const start = startRow ?? "?";
    const end = endRow ?? "?";
    return `${file}:${start}-${end}`;
}

export function toBulletList(items: string[]): string {
    if (items.length === 0) {
        return "- None";
    }
    return items.map(item => `- ${item}`).join("\n");
}

export function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

