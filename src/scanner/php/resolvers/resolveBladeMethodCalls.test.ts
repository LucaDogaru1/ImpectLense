import { graph, resetGraph } from "../../../graph/graph";
import { resolveBladeMethodCalls } from "./resolveBladeMethodCalls";

resetGraph();

graph.nodes.set("App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents", {
    id: "App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents",
    parent: "App\\Cms\\Element\\DVV\\DvvCalendarElement",
    type: "method",
    name: "getAllEvents",
    visibility: "public",
});

graph.nodes.set("blade:resources/views/calendar.blade.php", {
    id: "blade:resources/views/calendar.blade.php",
    type: "blade_view",
    name: "calendar.blade.php",
});

graph.nodes.set("blade_method_ref:getallEvents", {
    id: "blade_method_ref:getallEvents",
    type: "blade_method_ref",
    name: "getallEvents",
});

graph.edges.set("blade-call", {
    from: "blade:resources/views/calendar.blade.php",
    to: "blade_method_ref:getallEvents",
    type: "BLADE_METHOD_CALL",
});

resolveBladeMethodCalls();

const bladeCallsEdge = [...graph.edges.values()].find(
    edge =>
        edge.type === "BLADE_CALLS" &&
        edge.to === "App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents"
);

if (!bladeCallsEdge) {
    throw new Error("expected case-insensitive blade method match for getAllEvents");
}

console.log("resolveBladeMethodCalls test passed");
