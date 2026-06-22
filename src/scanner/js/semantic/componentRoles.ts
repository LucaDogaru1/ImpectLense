import { graph } from "../../../graph/graph";

export type VueComponentRole = "vue_page" | "vue_component" | "vue_composable" | "vue_layout";

function normalizePath(file: string): string {
    return file.replace(/\\/g, "/").toLowerCase();
}

export function inferVueComponentRoles(name: string, file: string): VueComponentRole[] {
    const lowerFile = normalizePath(file);
    const lowerName = name.toLowerCase();
    const roles = new Set<VueComponentRole>();

    if (lowerFile.includes("/views/") || lowerName.endsWith("page")) {
        roles.add("vue_page");
    }

    if (lowerFile.includes("/composables/") || lowerName.startsWith("use")) {
        roles.add("vue_composable");
    }

    if (/layout/i.test(lowerName) || lowerFile.includes("/layout")) {
        roles.add("vue_layout");
    }

    if (roles.size === 0) {
        roles.add("vue_component");
    }

    return [...roles];
}

export function attachVueComponentRoles(nodeId: string, name: string, file: string): void {
    for (const role of inferVueComponentRoles(name, file)) {
        const integrationId = `integration:${nodeId}:${role}`;
        graph.nodes.set(integrationId, {
            id: integrationId,
            parent: nodeId,
            type: "integration_entrypoint",
            name: role,
            file,
            keywords: [name.toLowerCase(), role.replace("vue_", "")],
            description: `Vue-style ${role.replace("vue_", "")} entrypoint`,
        });

        graph.edges.set(`${nodeId}->${integrationId}`, {
            from: nodeId,
            to: integrationId,
            type: "HAS_ROLE",
        });
    }
}
