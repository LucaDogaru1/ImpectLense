import assert from "node:assert/strict";
import { createPhpParser } from "./parse/parser";
import { resetGraph, graph } from "../../graph/graph";
import walk from "./walk/phpWalker";
import { createWalkContext } from "./astHandlers/testWalkContext";
import { pruneExternalExtendsEdges } from "./resolvers/pruneExternalExtends";
import { propagateClassPropertyTypes } from "./walk/classPropertyTypesRegistry";
import { resolveArgumentEdges } from "./resolvers/resolveArgumentEdges";

function testPhpDocStringDoesNotCreateModelField(): void {
    resetGraph();

    const source = `<?php
namespace App\\Models;

class Editorial {
    public function toArray(): array {
        /** @var string */
        $images = $this->images;
        return ['images' => $images];
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Models/Editorial.php", createWalkContext());

    assert.equal(
        graph.nodes.has("model_field:App\\Models\\string:images"),
        false,
        "expected @var string not to create model_field under App\\Models\\string"
    );
}

function testConfigFunctionCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Services;

class PaymentService {
    public function process(): void {
        config('services.cleeng.api_key');
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Services/PaymentService.php", createWalkContext());

    assert.ok(
        graph.nodes.has("config_key:services.cleeng.api_key"),
        "expected config() call to create config_key node"
    );
    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "REFERENCES" &&
                edge.to === "config_key:services.cleeng.api_key"
        ),
        "expected REFERENCES edge from PaymentService::process"
    );
}

function testConfigFacadeGetCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Jobs;

class ProcessPaymentJob {
    public function handle(): void {
        \\Illuminate\\Support\\Facades\\Config::get('queue.connections.sqs');
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Jobs/ProcessPaymentJob.php", createWalkContext());

    assert.ok(
        graph.nodes.has("config_key:queue.connections.sqs"),
        "expected Config::get() to create config_key node"
    );
}

function testGhostExtendsSkipped(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Requests;

class StorePaymentRequest extends \\Illuminate\\Foundation\\Http\\FormRequest {
    public function rules(): array {
        return [];
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Http/Requests/StorePaymentRequest.php", createWalkContext());
    pruneExternalExtendsEdges();

    assert.equal(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "EXTENDS" &&
                edge.to === "Illuminate\\Foundation\\Http\\FormRequest"
        ),
        false,
        "expected no EXTENDS edge to external parent not in graph"
    );
}

function testScalarRequestInputDataFlow(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;

class ChainController {
    public function resolve(Request $request): void {
        $name = $request->input('name');
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Http/Controllers/ChainController.php", createWalkContext());

    assert.ok(
        graph.edges.has("request_field:name->App\\Http\\Controllers\\ChainController::resolve::$name"),
        "expected scalar request input to assign directly to $name variable"
    );
    assert.ok(
        graph.nodes.has("App\\Http\\Controllers\\ChainController::resolve::$name"),
        "expected variable_field node for scalar $name assignment"
    );
    assert.equal(
        graph.nodes.has("App\\Http\\Controllers\\ChainController::resolve::$name.name"),
        false,
        "expected no bogus $name.name variable_field node"
    );
}

function testDtoFieldFlowIntoService(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\PaymentService;
use Illuminate\\Http\\Request;

class PaymentController {
    public function __construct(private PaymentService $paymentService) {
    }

    public function pay(Request $request): void {
        $data = ['amount' => $request->input('amount')];
        $dto = $data;
        $this->paymentService->process($dto);
    }
}

namespace App\\Services;

class PaymentService {
    public function process(array $dto): void {
    }
}
`;

    const tree = createPhpParser().parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    propagateClassPropertyTypes();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    resolveArgumentEdges();

    assert.ok(
        graph.nodes.has("App\\Http\\Controllers\\PaymentController::pay::$data.amount"),
        "expected variable_field node for $data.amount"
    );
    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "FLOWS_TO" &&
                edge.to === "App\\Services\\PaymentService::process"
        ),
        "expected request field flow into PaymentService::process"
    );
}

function testDtoFieldFlowThroughConstructor(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Dto\\PaymentDto;
use App\\Services\\PaymentService;
use Illuminate\\Http\\Request;

class PaymentController {
    public function __construct(private PaymentService $paymentService) {
    }

    public function pay(Request $request): void {
        $data = ['amount' => $request->input('amount')];
        $dto = new PaymentDto($data);
        $this->paymentService->process($dto);
    }
}

namespace App\\Dto;

class PaymentDto {
    public function __construct(array $data) {
    }
}

namespace App\\Services;

class PaymentService {
    public function process(array $dto): void {
    }
}
`;

    const tree = createPhpParser().parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    propagateClassPropertyTypes();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    resolveArgumentEdges();

    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "FLOWS_TO" &&
                edge.from === "App\\Http\\Controllers\\PaymentController::pay::$dto.amount" &&
                edge.to === "App\\Services\\PaymentService::process"
        ),
        "expected $dto.amount to flow into PaymentService::process via constructor wrap"
    );
}

function testPersistsFromModelCreate(): void {
    resetGraph();

    const source = `<?php
namespace App\\Services;

class ContentService {
    public function store(array $dto): void {
        \\App\\Models\\Content::create(['status' => $dto['status']]);
    }
}

namespace App\\Models;

class Content {
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Services/ContentService.php", createWalkContext());
    walk(tree.rootNode, "app/Services/ContentService.php", createWalkContext());

    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "PERSISTS" &&
                edge.from === "App\\Services\\ContentService::store" &&
                edge.to === "model_field:App\\Models\\Content:status"
        ),
        "expected ContentService::store to PERSISTS status via Content::create"
    );
}

function testNoisyPersistsReduced(): void {
    resetGraph();

    const source = `<?php
namespace App\\Services;

class BaseService {
    public function defaultOptions(): array {
        return ['timeout' => 30];
    }
}

namespace App\\Models;

class Content {
    public function __construct() {
        $defaults = ['status' => 'draft'];
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Services/BaseService.php", createWalkContext());

    assert.equal(
        [...graph.edges.values()].filter(edge => edge.type === "PERSISTS").length,
        0,
        "expected default option arrays not to create PERSISTS edges"
    );
}

function testFormRequestRulesExtracted(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Requests;

class StorePaymentRequest {
    public function rules(): array {
        return [
            'amount' => 'required|numeric',
            'currency' => 'required|string',
        ];
    }
}
`;

    const tree = createPhpParser().parse(source);
    walk(tree.rootNode, "app/Http/Requests/StorePaymentRequest.php", createWalkContext());

    assert.ok(
        graph.edges.has(
            "App\\Http\\Requests\\StorePaymentRequest::rules->validation:App\\Http\\Requests\\StorePaymentRequest::rules:amount"
        ),
        "expected FormRequest rules() to create VALIDATES edge"
    );
    assert.ok(
        graph.edges.has(
            "validation:App\\Http\\Requests\\StorePaymentRequest::rules:amount->request_field:amount"
        ),
        "expected rules() to link validation rule to request_field"
    );
}

function testNoDuplicateArgumentToEdges(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\PaymentService;
use Illuminate\\Http\\Request;

class PaymentController {
    public function __construct(private PaymentService $paymentService) {
    }

    public function pay(Request $request): void {
        $data = ['amount' => $request->input('amount')];
        $dto = $data;
        $this->paymentService->process($dto);
    }
}

namespace App\\Services;

class PaymentService {
    public function process(array $dto): void {
    }
}
`;

    const tree = createPhpParser().parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    propagateClassPropertyTypes();
    walk(tree.rootNode, "app/Http/Controllers/PaymentController.php", context);
    resolveArgumentEdges();

    const argumentEdges = [...graph.edges.entries()].filter(([, edge]) => edge.type === "ARGUMENT_TO");
    const semanticKeys = new Set<string>();

    for (const [mapKey, edge] of argumentEdges) {
        const semanticKey = `${edge.from}|${edge.to}|${edge.argumentIndex ?? ""}|${edge.via ?? ""}`;
        assert.ok(
            !semanticKeys.has(semanticKey),
            `duplicate ARGUMENT_TO for ${semanticKey} (keys: ${mapKey})`,
        );
        semanticKeys.add(semanticKey);
        assert.match(
            mapKey,
            /:ARGUMENT_TO:\d+:/,
            "ARGUMENT_TO map key should use canonical :ARGUMENT_TO:<index>:<via> format",
        );
    }

    assert.ok(argumentEdges.length >= 1, "expected at least one ARGUMENT_TO edge");
}

testPhpDocStringDoesNotCreateModelField();
testConfigFunctionCall();
testConfigFacadeGetCall();
testGhostExtendsSkipped();
testScalarRequestInputDataFlow();
testDtoFieldFlowIntoService();
testDtoFieldFlowThroughConstructor();
testPersistsFromModelCreate();
testNoisyPersistsReduced();
testFormRequestRulesExtracted();
testNoDuplicateArgumentToEdges();
console.log("scanner regression tests passed");
