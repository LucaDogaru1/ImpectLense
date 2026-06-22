export interface ExtractedField {
    kind: "array_field" | "request_field" | "validation_field" | "array_access";
    key: string;
    value?: string;
    className?: string;
    methodName?: string;
}

export interface WalkContext {
    currentNamespace?: string;
    currentInterface?: string;
    imports: Map<string, string>;
    currentClass?: string;
    currentMethod?: string;
    classPropertyTypes: Map<string, string>;
    variableTypes: Map<string, string>;
    extractedFields: ExtractedField[];

    dataFlows: Map<string, Set<string>>;
}
