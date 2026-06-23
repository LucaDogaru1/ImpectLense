import assert from "node:assert/strict";
import { createPhpParser } from "../../parse/parser";
import { resetGraph, graph } from "../../../../graph/graph";
import walk from "../../walk/phpWalker";
import { createWalkContext } from "../testWalkContext";

function testNestedResourceResponseFields(): void {
    resetGraph();

    const source = `<?php
class ContentResource {
    public function toArray(): array {
        return [
            'editorial' => [
                'images' => [
                    '16x9' => $this->editorial['images']['16x9'],
                    '1x1' => $this->editorial['images']['1x1'],
                ],
            ],
        ];
    }
}`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    walk(tree.rootNode, "app/Resources/ContentResource.php", createWalkContext());

    assert.ok(graph.nodes.has("response_field:ContentResource:editorial"));
    assert.ok(graph.nodes.has("response_field:ContentResource:editorial.images"));
    assert.ok(graph.nodes.has("response_field:ContentResource:editorial.images.16x9"));
    assert.ok(graph.nodes.has("response_field:ContentResource:editorial.images.1x1"));

    assert.ok(graph.edges.has("ContentResource::toArray->response_field:ContentResource:editorial.images.16x9:SERIALIZES"));
}

function testPassthroughToArrayUsesModelShape(): void {
    resetGraph();

    const source = `<?php
class Content {
    public function __construct(array $attributes = []) {
        $this->editorial = $attributes['editorial'] ?? [
            'images' => [
                '16x9' => null,
                '1x1' => null,
            ],
        ];
    }

    public function toArray(): array {
        return [
            'editorial' => $this->editorial,
        ];
    }
}`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    walk(tree.rootNode, "app/Models/Content.php", createWalkContext());

    assert.ok(graph.nodes.has("model_field:Content:editorial.images.16x9"));
    assert.ok(graph.nodes.has("response_field:Content:editorial.images.16x9"));
    assert.ok(graph.nodes.has("response_field:Content:editorial.images.1x1"));
    assert.ok(graph.edges.has("Content::toArray->response_field:Content:editorial.images.16x9:SERIALIZES"));
}

function run(): void {
    console.log("returnStatement tests\n");

    testNestedResourceResponseFields();
    console.log("  ✓ nested resource response fields");

    testPassthroughToArrayUsesModelShape();
    console.log("  ✓ passthrough toArray uses model shape");

    console.log("\nAll returnStatement tests passed.");
}

run();
