import { registerHttpResource } from "../resolvers/httpResourceRegistry";

const RESOURCE_PROPERTY_PATTERN =
    /^\s*([A-Za-z_$][\w$]*)\s*:\s*new\s+[A-Za-z_$][\w$]*\s*\(\s*\{[^}]*\burl\s*:\s*['"`]([^'"`]+)['"`]/gm;

export function extractHttpResourcesFromSource(source: string, moduleId: string): number {
    let count = 0;

    for (const match of source.matchAll(RESOURCE_PROPERTY_PATTERN)) {
        const propertyName = match[1];
        const urlTemplate = match[2];
        if (!propertyName || !urlTemplate) {
            continue;
        }

        registerHttpResource(moduleId, propertyName, { urlTemplate });
        count += 1;
    }

    return count;
}
