import { graph } from "../../../graph/graph";
import {
    extractVueTemplateMetadata,
    templateKeywords,
    VuePropBinding,
} from "../resolvers/templateExtractor";
import { JsWalkContext } from "../walk/context";

function resolveChildComponentId(
    tagName: string,
    context: JsWalkContext
): string {
    const importTarget = context.imports.get(tagName);
    if (importTarget) {
        return `${importTarget}::${tagName}`;
    }
    return `${context.moduleId}::${tagName}`;
}

function recordPropBindingEdge(
    fromComponentId: string,
    binding: VuePropBinding,
    context: JsWalkContext
): void {
    const toComponentId = resolveChildComponentId(binding.tag, context);
    const edgeId = `${fromComponentId}->${toComponentId}:PASSES_PROP:${binding.prop}`;

    graph.edges.set(edgeId, {
        from: fromComponentId,
        to: toComponentId,
        type: "PASSES_PROP",
        via: `${binding.expression}->${binding.prop}`,
        reason: `Template binds :${binding.prop}="${binding.expression}" on <${binding.tag}>`,
        confidence: 0.85,
    });
}

export function extractVuePropDeclarations(
    propsObjectNode: Parser.SyntaxNode,
    componentId: string,
    context: JsWalkContext
): string[] {
    const propNames: string[] = [];

    for (const child of propsObjectNode.children) {
        if (child.type !== "pair") {
            continue;
        }

        const propName = child.childForFieldName("key")?.text.replace(/["']/g, "");
        if (!propName) {
            continue;
        }

        propNames.push(propName);
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

    return propNames;
}

export function processVueTemplate(
    template: string,
    componentId: string,
    context: JsWalkContext
): string[] {
    const metadata = extractVueTemplateMetadata(template);

    for (const binding of metadata.propBindings) {
        recordPropBindingEdge(componentId, binding, context);
    }

    return templateKeywords(metadata);
}
