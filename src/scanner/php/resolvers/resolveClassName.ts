import {WalkContext} from "../walk/context";

export function resolveClassName(className: string, context:WalkContext):string
{
    if (className.startsWith("\\")) {
        return className.substring(1);
    }

    if (context.imports.has(className)) {
        return context.imports.get(className)!;
    }

    if (context.currentNamespace) {
        return `${context.currentNamespace}\\${className}`;
    }

    return className;
}