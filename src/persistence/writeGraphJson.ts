import fs from "node:fs";
import { graph } from "../graph/graph";

export default function graphWriter(graphJsonPath = "Graph.json"): void {
    fs.writeFileSync(
        graphJsonPath,
        JSON.stringify(
            {
                nodes: Array.from(graph.nodes.values()),
                edges: Array.from(graph.edges.values()),
            },
            null,
            2
        ),
        "utf-8"
    );
}
