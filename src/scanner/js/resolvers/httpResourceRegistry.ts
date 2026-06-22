export interface HttpResourceDefinition {
    urlTemplate: string;
    resourceClass?: string;
}

const registryByModule = new Map<string, Map<string, HttpResourceDefinition>>();

export function registerHttpResource(
    moduleId: string,
    propertyName: string,
    definition: HttpResourceDefinition
): void {
    const bucket = registryByModule.get(moduleId) ?? new Map<string, HttpResourceDefinition>();
    bucket.set(propertyName, definition);
    registryByModule.set(moduleId, bucket);
}

export function lookupHttpResource(
    moduleId: string,
    propertyName: string
): HttpResourceDefinition | undefined {
    return registryByModule.get(moduleId)?.get(propertyName);
}

export function resolveHttpResourceChain(
    moduleId: string,
    imports: Map<string, string>,
    chain: string[]
): HttpResourceDefinition | undefined {
    if (chain.length === 0) {
        return undefined;
    }

    if (chain.length === 1) {
        return lookupHttpResource(moduleId, chain[0]!);
    }

    const [root, ...rest] = chain;
    const importTarget = imports.get(root!);
    if (!importTarget) {
        return lookupHttpResource(moduleId, chain[chain.length - 1]!);
    }

    let currentModule = importTarget;
    for (let index = 0; index < rest.length; index += 1) {
        const segment = rest[index]!;
        const resource = lookupHttpResource(currentModule, segment);
        if (index === rest.length - 1) {
            return resource;
        }

        if (!resource) {
            return undefined;
        }
    }

    return undefined;
}

export function resetHttpResourceRegistry(): void {
    registryByModule.clear();
}
