export interface VueSfcBlock {
    content: string;
    lang?: string;
    setup?: boolean;
}

export interface VueSfc {
    template?: VueSfcBlock;
    script?: VueSfcBlock;
}

const BLOCK_PATTERN = /^<(template|script)(\s[^>]*)?>([\s\S]*?)<\/\1>/gm;

function readLang(attributes: string | undefined, defaultLang: string): string {
    if (!attributes) {
        return defaultLang;
    }

    const match = attributes.match(/\blang=["']([^"']+)["']/);
    return match?.[1]?.toLowerCase() ?? defaultLang;
}

export function splitSfc(source: string): VueSfc {
    const result: VueSfc = {};

    for (const match of source.matchAll(BLOCK_PATTERN)) {
        const blockType = match[1]?.toLowerCase();
        const attributes = match[2] ?? "";
        const content = match[3]?.trim() ?? "";

        if (!blockType || !content) {
            continue;
        }

        if (blockType === "template") {
            result.template = {
                content,
                lang: readLang(attributes, "html"),
            };
        } else if (blockType === "script") {
            result.script = {
                content,
                lang: readLang(attributes, "js"),
                setup: /\bsetup\b/.test(attributes),
            };
        }
    }

    return result;
}
