import Parser from "tree-sitter";
import { JsWalkContext } from "../walk/context";
import { classDeclarationType } from "./classDeclaration";
import { functionDeclarationType } from "./functionDeclaration";
import { trackHttpResourcesInObject } from "./httpResourceExport";
import {
    isVueComponentOptionsObject,
    registerVueComponentFromOptionsObject,
} from "../vue/vueComponentRegistry";

function isDefineComponentCall(node: Parser.SyntaxNode): boolean {
    if (node.type !== "call_expression") {
        return false;
    }

    const fn = node.childForFieldName("function");
    return fn?.type === "identifier" && fn.text === "defineComponent";
}

function readDefineComponentObject(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (!isDefineComponentCall(node)) {
        return null;
    }

    const args = node.childForFieldName("arguments");
    return args?.namedChildren.find(child => child.type === "object") ?? null;
}

function fallbackComponentName(file: string): string {
    const base = file.split("/").pop() ?? "default";
    if (base === "index.vue" || base === "index.js") {
        const parts = file.split("/");
        return parts[parts.length - 2] ?? "default";
    }

    return base.replace(/\.(vue|js|ts)$/i, "");
}

export function exportStatementType(node: Parser.SyntaxNode, context: JsWalkContext): JsWalkContext {
    const declaration = node.children.find(child =>
        child.type === "function_declaration" ||
        child.type === "class_declaration" ||
        child.type === "object" ||
        child.type === "call_expression" ||
        child.type === "lexical_declaration"
    );

    if (!declaration) {
        return context;
    }

    if (declaration.type === "function_declaration") {
        const functionId = functionDeclarationType(declaration, context, { exported: true });
        return { ...context, currentFunction: functionId || context.currentFunction };
    }

    if (declaration.type === "class_declaration") {
        const classId = classDeclarationType(declaration, context, { exported: true });
        return { ...context, currentComponent: classId || context.currentComponent };
    }

    const defineComponentObject = readDefineComponentObject(declaration);
    if (defineComponentObject) {
        if (isVueComponentOptionsObject(defineComponentObject) || context.file.endsWith(".vue")) {
            const componentId = registerVueComponentFromOptionsObject(defineComponentObject, context, {
                externalTemplate: context.externalTemplate,
                fallbackName: fallbackComponentName(context.file),
            });
            return { ...context, currentComponent: componentId };
        }

        trackHttpResourcesInObject(defineComponentObject, context);
        return context;
    }

    if (declaration.type === "object") {
        trackHttpResourcesInObject(declaration, context);

        if (isVueComponentOptionsObject(declaration) || context.file.endsWith(".vue")) {
            const componentId = registerVueComponentFromOptionsObject(declaration, context, {
                externalTemplate: context.externalTemplate,
                fallbackName: fallbackComponentName(context.file),
            });
            return { ...context, currentComponent: componentId };
        }

        return context;
    }

    return context;
}
