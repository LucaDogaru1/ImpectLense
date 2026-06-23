import { WalkContext } from "../walk/context";

export function createWalkContext(overrides: Partial<WalkContext> = {}): WalkContext {
    return {
        imports: new Map<string, string>(),
        classPropertyTypes: new Map<string, string>(),
        variableTypes: new Map<string, string>(),
        extractedFields: [],
        dataFlows: new Map<string, Set<string>>(),
        ...overrides,
    };
}
