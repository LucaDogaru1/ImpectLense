export interface JsWalkContext {
    moduleId: string;
    file: string;
    currentComponent?: string;
    currentFunction?: string;
    imports: Map<string, string>;
    moduleConstants: Map<string, string>;
    /** SFC <template> block passed from Vue file parser. */
    externalTemplate?: string;
}
