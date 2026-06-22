import { graph } from "../../../graph/graph";
import { endpointNodeId } from "./endpointId";
import { RouteDefinition } from "./routeExpander";

export function recordRoutes(routes: RouteDefinition[], file?: string): void {
    for (const route of routes) {
        const endpointId = endpointNodeId(route.method, route.path);
        const controllerMethod = `${route.controller}::${route.action}`;
        const label = `${route.method.toUpperCase()} ${route.path}`;

        graph.nodes.set(endpointId, {
            id: endpointId,
            type: "api_endpoint",
            name: label,
            file,
            description: "HTTP route inferred from Laravel Route definition",
        });

        graph.edges.set(`${endpointId}->${controllerMethod}:ROUTES_TO`, {
            from: endpointId,
            to: controllerMethod,
            type: "ROUTES_TO",
            via: route.action,
            reason: label,
        });
    }
}
