import { graph, resetGraph } from "../../../graph/graph";
import { resolveOverrideCalls } from "./resolveOverrideCalls";

resetGraph();

graph.nodes.set("App\\Cms\\Element", {
    id: "App\\Cms\\Element",
    type: "class",
    name: "Element",
});
graph.nodes.set("App\\Cms\\Element::onSave", {
    id: "App\\Cms\\Element::onSave",
    parent: "App\\Cms\\Element",
    type: "method",
    name: "onSave",
});
graph.nodes.set("App\\Cms\\Element\\DVV\\DvvInstagramElement", {
    id: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    type: "class",
    name: "DvvInstagramElement",
});
graph.nodes.set("App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave", {
    id: "App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave",
    parent: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    type: "method",
    name: "onSave",
});
graph.nodes.set("App\\Http\\Services\\PageElementService::saveConfig", {
    id: "App\\Http\\Services\\PageElementService::saveConfig",
    parent: "App\\Http\\Services\\PageElementService",
    type: "method",
    name: "saveConfig",
});

graph.edges.set("extends", {
    from: "App\\Cms\\Element\\DVV\\DvvInstagramElement",
    to: "App\\Cms\\Element",
    type: "EXTENDS",
});
graph.edges.set("call", {
    from: "App\\Http\\Services\\PageElementService::saveConfig",
    to: "App\\Cms\\Element::onSave",
    type: "CALLS",
});

resolveOverrideCalls();

const resolvedEdge = [...graph.edges.values()].find(
    edge =>
        edge.type === "CALLS" &&
        edge.callType === "OVERRIDE_RESOLVED" &&
        edge.to === "App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave"
);

if (!resolvedEdge) {
    throw new Error("expected OVERRIDE_RESOLVED call to subclass onSave");
}

console.log("resolveOverrideCalls test passed");
