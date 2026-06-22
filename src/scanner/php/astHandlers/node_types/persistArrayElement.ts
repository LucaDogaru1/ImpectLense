import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import {
    cleanPhpString,
    ensureModelField,
    isLikelyFieldName,
    linkPersists,
} from "../../semantic/fieldNodes";

export function persistArrayElementType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentMethod || !context.currentClass) return;

    const keyNode = node.namedChildren[0];
    if (!keyNode) return;

    const key = cleanPhpString(keyNode.text);
    if (!isLikelyFieldName(key)) return;

    const methodLower = context.currentMethod.toLowerCase();
    const isPersistenceMethod =
        /::(update|create|store|save|archive|persist|insert)/i.test(methodLower) ||
        /service|repository|model/i.test(methodLower);

    if (!isPersistenceMethod) return;

    const targetClass = inferTargetModelClass(context);
    const modelFieldNodeId = ensureModelField(targetClass, key, file);
    linkPersists(context.currentMethod, modelFieldNodeId, key);
}

function inferTargetModelClass(context: WalkContext): string {
    for (const type of context.variableTypes.values()) {
        if (/content|model|entity/i.test(type)) {
            return type;
        }
    }

    for (const type of context.classPropertyTypes.values()) {
        if (/content|model|entity/i.test(type)) {
            return type;
        }
    }

    if (context.currentClass?.includes("ContentService")) {
        return "Content";
    }

    if (context.currentClass && /service|repository/i.test(context.currentClass)) {
        if (context.currentClass.toLowerCase().includes("content")) {
            return "Content";
        }
    }

    return context.currentClass ?? "UnknownModel";
}
