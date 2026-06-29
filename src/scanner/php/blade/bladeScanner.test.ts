import { graph, resetGraph } from "../../../graph/graph";
import { scanBladeFile } from "./bladeScanner";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

resetGraph();

const sample = `
@extends('layouts.app')
@include('partials.header')
<x-button />
{{ route('login') }}
{{ action([LoginController::class, 'logout']) }}
`;

scanBladeFile("resources/views/auth/login.blade.php", sample);

const viewId = "blade:resources/views/auth/login.blade.php";

assert(graph.nodes.has(viewId), "blade view node missing");
assert(graph.nodes.has("view:layouts.app"), "extends view ref missing");
assert(graph.nodes.has("view:partials.header"), "include view ref missing");
assert(graph.nodes.has("route:login"), "route name node missing");

const edges = [...graph.edges.values()].filter(edge => edge.from === viewId);

assert(
    edges.some(edge => edge.type === "BLADE_EXTENDS" && edge.to === "view:layouts.app"),
    "BLADE_EXTENDS missing"
);
assert(
    edges.some(edge => edge.type === "BLADE_INCLUDES" && edge.to === "view:components.button"),
    "component include missing"
);
assert(
    edges.some(edge => edge.type === "BLADE_USES_ROUTE" && edge.to === "route:login"),
    "BLADE_USES_ROUTE missing"
);
assert(
    edges.some(
        edge => edge.type === "BLADE_USES_ACTION" && edge.to === "LoginController::logout"
    ),
    "BLADE_USES_ACTION missing"
);

console.log("All bladeScanner tests passed.");
