import { graph } from "../../../graph/graph";
import { toJsModuleId } from "../resolvers/resolveImportPath";

export function ensureJsModuleNode(relativePath: string): string {
    const moduleId = toJsModuleId(relativePath);
    const baseName = relativePath.split("/").pop() ?? relativePath;
    const isVue = relativePath.endsWith(".vue");

    graph.nodes.set(moduleId, {
        id: moduleId,
        type: "js_module",
        name: relativePath,
        file: relativePath,
        keywords: [baseName.replace(/\.(vue|js|mjs|cjs)$/i, "")],
        description: isVue ? "Vue single-file component module" : "JavaScript module",
    });

    return moduleId;
}
