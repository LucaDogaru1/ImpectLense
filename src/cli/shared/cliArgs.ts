export function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

export function getOptionValue(args: string[], option: string): string | undefined {
    const prefix = `${option}=`;
    const raw = args.find(arg => arg.startsWith(prefix));
    return raw ? raw.slice(prefix.length) : undefined;
}

export function getIntOption(args: string[], option: string, fallback: number, min?: number): number {
    const value = Number(getOptionValue(args, option) ?? String(fallback));
    const normalized = Number.isFinite(value) ? Math.floor(value) : fallback;
    return min === undefined ? normalized : Math.max(min, normalized);
}

export function getFloatOption(args: string[], option: string, fallback: number, min?: number, max?: number): number {
    const value = Number(getOptionValue(args, option) ?? String(fallback));
    if (!Number.isFinite(value)) {
        return fallback;
    }

    let normalized = value;
    if (min !== undefined) {
        normalized = Math.max(min, normalized);
    }
    if (max !== undefined) {
        normalized = Math.min(max, normalized);
    }

    return normalized;
}

