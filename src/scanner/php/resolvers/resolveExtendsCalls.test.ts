import { graph, resetGraph } from "../../../graph/graph";
import { resolveExtendsCalls } from "./resolveExtendsCalls";

resetGraph();

graph.nodes.set("Area", { id: "Area", type: "class", name: "Area" });
graph.nodes.set("Area::getPossibleElements", {
    id: "Area::getPossibleElements",
    parent: "Area",
    type: "method",
    name: "getPossibleElements",
    isAbstract: true,
});
graph.nodes.set("DvvNewsletterArea", {
    id: "DvvNewsletterArea",
    type: "class",
    name: "DvvNewsletterArea",
});
graph.nodes.set("DvvNewsletterArea::getPossibleElements", {
    id: "DvvNewsletterArea::getPossibleElements",
    parent: "DvvNewsletterArea",
    type: "method",
    name: "getPossibleElements",
});
graph.nodes.set("Factory::build", {
    id: "Factory::build",
    parent: "Factory",
    type: "method",
    name: "build",
});

graph.edges.set("extends", {
    from: "DvvNewsletterArea",
    to: "Area",
    type: "EXTENDS",
});
graph.edges.set("call", {
    from: "Factory::build",
    to: "Area::getPossibleElements",
    type: "CALLS",
});

resolveExtendsCalls();

const resolvedEdge = [...graph.edges.values()].find(
    edge =>
        edge.type === "CALLS" &&
        edge.callType === "EXTENDS_RESOLVED" &&
        edge.to === "DvvNewsletterArea::getPossibleElements"
);

if (!resolvedEdge) {
    throw new Error("expected EXTENDS_RESOLVED call to concrete implementation");
}

console.log("resolveExtendsCalls test passed");
