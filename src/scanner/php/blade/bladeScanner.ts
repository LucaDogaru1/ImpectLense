import { graph } from "../../../graph/graph";

export function isBladeFile(relativePath: string): boolean {
    return relativePath.endsWith(".blade.php");
}

function viewRefId(viewName: string): string {
    return `view:${viewName}`;
}

function routeRefId(routeName: string): string {
    return `route:${routeName}`;
}

function addViewRef(viewName: string): string {
    const id = viewRefId(viewName);

    graph.nodes.set(id, {
        id,
        type: "blade_view_ref",
        name: viewName,
    });

    return id;
}

function addBladeViewEdge(from: string, type: string, viewName: string): void {
    const to = addViewRef(viewName);

    graph.edges.set(`${from}->${to}:${type}`, {
        from,
        to,
        type,
    });
}

function componentNameToViewRef(componentName: string): string {
    return componentName.replace(/-/g, ".");
}

export function scanBladeFile(file: string, content: string): void {
    const viewId = `blade:${file}`;

    graph.nodes.set(viewId, {
        id: viewId,
        type: "blade_view",
        name: file.split("/").pop() ?? file,
        file,
    });

    for (const match of content.matchAll(/@extends\(\s*['"]([^'"]+)['"]/g)) {
        addBladeViewEdge(viewId, "BLADE_EXTENDS", match[1]!);
    }

    for (const match of content.matchAll(/@include(?:If|When|Unless|First)?\(\s*['"]([^'"]+)['"]/g)) {
        addBladeViewEdge(viewId, "BLADE_INCLUDES", match[1]!);
    }

    for (const match of content.matchAll(/<x-([a-zA-Z0-9_.-]+)\b/g)) {
        addBladeViewEdge(viewId, "BLADE_INCLUDES", `components.${componentNameToViewRef(match[1]!)}`);
    }

    for (const match of content.matchAll(/route\(\s*['"]([^'"]+)['"]/g)) {
        const to = routeRefId(match[1]!);

        graph.nodes.set(to, {
            id: to,
            type: "route_name",
            name: match[1]!,
        });

        graph.edges.set(`${viewId}->${to}:BLADE_USES_ROUTE`, {
            from: viewId,
            to,
            type: "BLADE_USES_ROUTE",
        });
    }

    for (const match of content.matchAll(
        /action\(\s*\[([A-Za-z0-9_\\]+)::class,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g
    )) {
        const to = `${match[1]}::${match[2]}`;

        graph.edges.set(`${viewId}->${to}:BLADE_USES_ACTION`, {
            from: viewId,
            to,
            type: "BLADE_USES_ACTION",
        });
    }

    for (const match of content.matchAll(/([A-Za-z0-9_\\]+)::([A-Za-z0-9_]+)/g)) {
        const className = match[1]!;
        const symbol = match[2]!;

        if (className === "class" || symbol === "class") {
            continue;
        }

        const to = `${className}::${symbol}`;

        graph.edges.set(`${viewId}->${to}:BLADE_REFERENCES_SYMBOL`, {
            from: viewId,
            to,
            type: "BLADE_REFERENCES_SYMBOL",
        });
    }

    for (const match of content.matchAll(/\$([a-zA-Z_][\w]*)->([a-zA-Z_][\w]*)\s*\(/g)) {
        const methodName = match[2]!;
        const refId = `blade_method_ref:${methodName}`;

        graph.nodes.set(refId, {
            id: refId,
            type: "blade_method_ref",
            name: methodName,
        });

        graph.edges.set(`${viewId}->${refId}:BLADE_METHOD_CALL`, {
            from: viewId,
            to: refId,
            type: "BLADE_METHOD_CALL",
            via: match[1],
        });
    }
}
