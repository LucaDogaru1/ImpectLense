export interface VuePropBinding {
    tag: string;
    prop: string;
    expression: string;
}

export interface VueTemplateMetadata {
    tags: string[];
    props: string[];
    classes: string[];
    directives: string[];
    propBindings: VuePropBinding[];
}

const VUE_TAG_PATTERN = /<([A-Z][A-Za-z0-9]*)\b/g;
const CLASS_PATTERN = /class=(?:"([^"]+)"|'([^']+)'|:class="[^"]+")/g;
const DIRECTIVE_PATTERN = /\b(v-[a-z-]+|:[a-z][a-z0-9-]*|@[a-z][a-z0-9-]+)/g;
const BINDING_ATTR_PATTERN = /:([a-z][a-z0-9-]*)="([^"]+)"/g;
const TAG_BLOCK_PATTERN = /<([A-Z][A-Za-z0-9]*)\b([\s\S]*?)(\/?)>/g;

function kebabToCamel(value: string): string {
    return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function extractVueTemplateMetadata(template: string): VueTemplateMetadata {
    const tags = new Set<string>();
    const props = new Set<string>();
    const classes = new Set<string>();
    const directives = new Set<string>();
    const propBindings: VuePropBinding[] = [];

    for (const match of template.matchAll(TAG_BLOCK_PATTERN)) {
        const tag = match[1];
        const attrBlock = match[2] ?? "";
        if (!tag || tag === "template") {
            continue;
        }

        tags.add(tag);

        for (const bindingMatch of attrBlock.matchAll(BINDING_ATTR_PATTERN)) {
            const prop = bindingMatch[1];
            const expression = bindingMatch[2]?.trim() ?? "";
            if (!prop) {
                continue;
            }

            const normalizedProp = kebabToCamel(prop);
            props.add(normalizedProp);
            propBindings.push({ tag, prop: normalizedProp, expression });
        }
    }

    for (const match of template.matchAll(VUE_TAG_PATTERN)) {
        const tag = match[1];
        if (tag) {
            tags.add(tag);
        }
    }

    for (const match of template.matchAll(CLASS_PATTERN)) {
        const classValue = match[1] ?? match[2] ?? "";
        for (const className of classValue.split(/\s+/).filter(Boolean)) {
            classes.add(className);
        }
    }

    for (const match of template.matchAll(DIRECTIVE_PATTERN)) {
        const directive = match[1];
        if (directive.startsWith(":")) {
            props.add(kebabToCamel(directive.slice(1)));
        } else {
            directives.add(directive);
        }
    }

    return {
        tags: [...tags],
        props: [...props],
        classes: [...classes],
        directives: [...directives].filter(item => item.startsWith("v-")),
        propBindings,
    };
}

export function templateKeywords(metadata: VueTemplateMetadata): string[] {
    return [
        ...metadata.tags.map(tag => `tag:${tag}`),
        ...metadata.props.map(prop => `prop:${prop}`),
        ...metadata.classes.map(className => `class:${className}`),
        ...metadata.directives.map(directive => `directive:${directive}`),
    ];
}
