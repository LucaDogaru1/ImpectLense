import { graph } from "../../../graph/graph";
import { extractComponentKeywords } from "../resolvers/keyWordExtractor";
import { attachVueComponentRoles } from "../semantic/componentRoles";
import { extractVuePropDeclarations, processVueTemplate } from "../astHandlers/vueTemplate";
import { findMethodDefinition } from "./findComponentOptions";
import { JsWalkContext } from "../walk/context";
import walk from "../walk/jsWalker";
import Parser from "tree-sitter";

function readObjectPropertyValue(objectNode: Parser.SyntaxNode, key: string): string | null {
    for (const child of objectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const property = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (property !== key) {
            continue;
        }

        const valueNode = child.childForFieldName("value");
        if (!valueNode) {
            return null;
        }

        if (valueNode.type === "string") {
            const fragment = valueNode.children.find(child => child.type === "string_fragment");
            return fragment?.text ?? valueNode.text.replace(/^["']|["']$/g, "");
        }

        if (valueNode.type === "identifier") {
            return valueNode.text;
        }
    }

    return null;
}

function readObjectPropertyNode(objectNode: Parser.SyntaxNode, key: string): Parser.SyntaxNode | null {
    for (const child of objectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const property = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (property !== key) {
            continue;
        }

        return child.childForFieldName("value") ?? null;
    }

    return null;
}

function readComponentReferences(objectNode: Parser.SyntaxNode): string[] {
    const componentsNode = readObjectPropertyNode(objectNode, "components");
    if (!componentsNode || componentsNode.type !== "object") {
        return [];
    }

    return componentsNode.children
        .filter(node => node.type === "shorthand_property_identifier" || node.type === "pair")
        .map(node => {
            if (node.type === "shorthand_property_identifier") {
                return node.text;
            }
            return node.childForFieldName("key")?.text.replace(/["']/g, "") ?? "";
        })
        .filter(Boolean);
}

function componentNameFromPath(file: string): string {
    const base = file.split("/").pop() ?? "default";
    if (base === "index.vue" || base === "index.js" || base === "index.ts") {
        const parts = file.split("/");
        return parts[parts.length - 2] ?? base.replace(/\.(vue|js|ts)$/i, "");
    }

    return base.replace(/\.(vue|js|ts)$/i, "");
}

function walkMethodBodies(
    objectNode: Parser.SyntaxNode,
    componentId: string,
    context: JsWalkContext
): void {
    for (const child of objectNode.children) {
        if (child.type !== "method_definition") {
            continue;
        }

        const methodName = child.childForFieldName("name")?.text ?? "anonymous";
        const methodId = `${componentId}::${methodName}`;
        const body = child.childForFieldName("body");

        if (body) {
            walk(body, context.file, {
                ...context,
                currentComponent: componentId,
                currentFunction: methodId,
            });
        }
    }
}

export interface RegisterVueComponentOptions {
    externalTemplate?: string;
    fallbackName?: string;
}

export function registerVueComponentFromOptionsObject(
    objectNode: Parser.SyntaxNode,
    context: JsWalkContext,
    options: RegisterVueComponentOptions = {}
): string {
    const componentName = readObjectPropertyValue(objectNode, "name") ??
        options.fallbackName ??
        componentNameFromPath(context.file);

    const componentId = `${context.moduleId}::${componentName}`;
    const inlineTemplate = readObjectPropertyValue(objectNode, "template");
    const templateText = options.externalTemplate ?? inlineTemplate ?? context.externalTemplate;
    const propsNode = readObjectPropertyNode(objectNode, "props");

    const templateKeywordTags = templateText
        ? processVueTemplate(templateText, componentId, context)
        : [];

    const declaredProps = propsNode?.type === "object"
        ? extractVuePropDeclarations(propsNode, componentId, context)
        : [];

    graph.nodes.set(componentId, {
        id: componentId,
        parent: context.moduleId,
        type: "vue_component",
        name: componentName,
        file: context.file,
        keywords: [
            ...extractComponentKeywords(objectNode, {
                seed: componentName,
                skipStrings: true,
                extra: [
                    ...templateKeywordTags,
                    ...declaredProps.map(prop => `prop:${prop}`),
                ],
            }),
        ],
        description: context.file.endsWith(".vue")
            ? "Vue single-file component"
            : "Vue-style component",
    });

    graph.edges.set(`${context.moduleId}->${componentId}`, {
        from: context.moduleId,
        to: componentId,
        type: "CONTAINS",
    });

    attachVueComponentRoles(componentId, componentName, context.file);

    for (const childComponent of readComponentReferences(objectNode)) {
        const importTarget = context.imports.get(childComponent);
        const targetId = importTarget ? `${importTarget}::${childComponent}` : `${context.moduleId}::${childComponent}`;

        graph.edges.set(`${componentId}->${targetId}:REFERENCES`, {
            from: componentId,
            to: targetId,
            type: "REFERENCES",
            via: childComponent,
            reason: "components map entry",
        });
    }

    for (const child of objectNode.children) {
        if (child.type === "method_definition") {
            const methodName = child.childForFieldName("name")?.text ?? "anonymous";
            const methodId = `${componentId}::${methodName}`;

            graph.nodes.set(methodId, {
                id: methodId,
                parent: componentId,
                type: "method",
                name: methodName,
                file: context.file,
                keywords: extractComponentKeywords(child, { seed: methodName, skipStrings: true }),
                description: "Vue component option method",
            });

            graph.edges.set(`${componentId}->${methodId}`, {
                from: componentId,
                to: methodId,
                type: "CONTAINS",
            });
        }
    }

    walkMethodBodies(objectNode, componentId, context);

    return componentId;
}

export function isVueComponentOptionsObject(objectNode: Parser.SyntaxNode): boolean {
    for (const child of objectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const key = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (key === "props" || key === "template" || key === "components" || key === "setup") {
            return true;
        }
    }

    return false;
}

export function extractScriptSetupPropNames(script: string): string[] {
    const props: string[] = [];

    const objectMatch = script.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (objectMatch?.[1]) {
        for (const match of objectMatch[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) {
            props.push(match[1]!);
        }
    }

    const genericMatch = script.match(/defineProps<\{([\s\S]*?)\}>/);
    if (genericMatch?.[1]) {
        for (const match of genericMatch[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)) {
            props.push(match[1]!);
        }
    }

    return [...new Set(props)];
}

export function registerScriptSetupComponent(
    script: string,
    context: JsWalkContext,
    options: RegisterVueComponentOptions = {}
): string | null {
    if (!/\bdefineProps\s*\(/.test(script) && !/<script[^>]*setup/.test(context.file)) {
        return null;
    }

    const nameMatch = script.match(/\bname\s*:\s*['"]([^'"]+)['"]/);
    const componentName = nameMatch?.[1] ??
        options.fallbackName ??
        componentNameFromPath(context.file);
    const componentId = `${context.moduleId}::${componentName}`;

    const declaredProps = extractScriptSetupPropNames(script);
    const templateText = options.externalTemplate ?? context.externalTemplate;
    const templateKeywordTags = templateText
        ? processVueTemplate(templateText, componentId, context)
        : [];

    graph.nodes.set(componentId, {
        id: componentId,
        parent: context.moduleId,
        type: "vue_component",
        name: componentName,
        file: context.file,
        keywords: [
            componentName.toLowerCase(),
            ...templateKeywordTags,
            ...declaredProps.map(prop => `prop:${prop}`),
        ],
        description: "Vue script-setup component",
    });

    graph.edges.set(`${context.moduleId}->${componentId}`, {
        from: context.moduleId,
        to: componentId,
        type: "CONTAINS",
    });

    attachVueComponentRoles(componentId, componentName, context.file);

    for (const propName of declaredProps) {
        const propNodeId = `${componentId}@prop:${propName}`;
        graph.nodes.set(propNodeId, {
            id: propNodeId,
            parent: componentId,
            type: "vue_prop",
            name: propName,
            file: context.file,
            keywords: [`prop:${propName}`],
            description: "Vue component prop declaration",
        });

        graph.edges.set(`${componentId}->${propNodeId}`, {
            from: componentId,
            to: propNodeId,
            type: "DECLARES_PROP",
        });
    }

    return componentId;
}
