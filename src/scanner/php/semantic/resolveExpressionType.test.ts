import assert from "node:assert/strict";
import { createPhpParser } from "../parse/parser";
import { resetGraph, graph } from "../../../graph/graph";
import walk from "../walk/phpWalker";
import { createWalkContext } from "../astHandlers/testWalkContext";
import { resolveBladeMethodCalls } from "../resolvers/resolveBladeMethodCalls";
import { resolveOverrideCalls } from "../resolvers/resolveOverrideCalls";
import { scanBladeFile } from "../blade/bladeScanner";
import { propagateClassPropertyTypes } from "../walk/classPropertyTypesRegistry";

function testReturnTypeCallChain(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Services;

use App\\Models\\Website\\Page;
use App\\Cms\\Layout;
use App\\Cms\\Area;

class PageElementService {
    public function newEmptyElement(Page $page, string $areaClass, string $elementClass): void {
        $area = $page->getLayout()->getEmptyArea($areaClass);
        $area->getElementByClassname($elementClass, new \\stdClass());
    }
}

namespace App\\Models\\Website;

class Page {
    public function getLayout(): \\App\\Cms\\Layout {
        return new \\App\\Cms\\Layout();
    }
}

namespace App\\Cms;

class Layout {
    public function getEmptyArea(string $requestedAreaClass): Area {
        return new Area();
    }
}

class Area {
    public function getElementByClassname(string $requestedElementClass, object $pageElement): void {
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();

    walk(tree.rootNode, "app/Http/Services/PageElementService.php", context);
    walk(tree.rootNode, "app/Http/Services/PageElementService.php", context);

    assert.equal(graph.nodes.get("App\\Cms\\Layout::getEmptyArea")?.returnType, "App\\Cms\\Area");
    assert.ok(
        graph.edges.has("App\\Http\\Services\\PageElementService::newEmptyElement->App\\Cms\\Area::getElementByClassname"),
        "expected call edge to Area::getElementByClassname"
    );
}

function testBladeMethodCalls(): void {
    resetGraph();

    graph.nodes.set("App\\Cms\\Area::getElementLimit", {
        id: "App\\Cms\\Area::getElementLimit",
        parent: "App\\Cms\\Area",
        type: "method",
        name: "getElementLimit",
        visibility: "public",
    });

    scanBladeFile("resources/views/pageArea.blade.php", "@php $isFull = $area->getElementLimit() <= 1; @endphp");
    resolveBladeMethodCalls();

    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "BLADE_CALLS" &&
                edge.to === "App\\Cms\\Area::getElementLimit"
        ),
        "expected BLADE_CALLS edge to Area::getElementLimit"
    );
}

function testChainedGetElementLifecycleCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Models\\Website;

use App\\Cms\\Element;

trait HasElement {
    public function getElement(): Element {
        return new Element();
    }
}

class PageElement {
    use HasElement;

    public function publish(array $config): void {
        $this->getElement()->onPublish($config);
    }
}

namespace App\\Cms;

class Element {
    public function onPublish(array $config): void {
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();

    walk(tree.rootNode, "app/Models/Website/PageElement.php", context);
    walk(tree.rootNode, "app/Models/Website/PageElement.php", context);

    assert.ok(
        graph.edges.has("App\\Models\\Website\\PageElement::publish->App\\Cms\\Element::onPublish"),
        "expected chained getElement()->onPublish call edge"
    );
}

function testSelfStaticCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Example;

class Registry {
    public static function all(): array {
        return self::entries();
    }

    public static function entries(): array {
        return [];
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Example/Registry.php", context);
    walk(tree.rootNode, "app/Example/Registry.php", context);

    assert.ok(
        graph.edges.has("App\\Example\\Registry::all->App\\Example\\Registry::entries"),
        "expected self:: static call edge"
    );
}

function testForeachPropertyCollectionCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Cms;

class Area {
    public function orderElements(): void {
    }
}

class Layout {
    /** @var Area[] */
    private array $hydratedAreas;

    private function orderAll(): void {
        foreach ($this->hydratedAreas as $area) {
            $area->orderElements();
        }
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Cms/Layout.php", context);
    walk(tree.rootNode, "app/Cms/Layout.php", context);

    assert.ok(
        graph.edges.has("App\\Cms\\Layout::orderAll->App\\Cms\\Area::orderElements"),
        "expected foreach over typed property to resolve polymorphic call"
    );
}

function testForeachPhpDocReturnCollectionCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Cms;

class Area {
    public function isAllowedByClassName(string $className): bool {
        return true;
    }
}

class Layout {
    /** @return Area[] */
    public function getPossibleAreasAsObject(): array {
        return [];
    }
}

class Page {
    public function getLayout(): Layout {
        return new Layout();
    }
}

class Finder {
    public function find(Page $page, string $elementClass): void {
        foreach ($page->getLayout()->getPossibleAreasAsObject() as $area) {
            $area->isAllowedByClassName($elementClass);
        }
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Cms/Finder.php", context);
    walk(tree.rootNode, "app/Cms/Finder.php", context);

    assert.ok(
        graph.edges.has("App\\Cms\\Finder::find->App\\Cms\\Area::isAllowedByClassName"),
        "expected foreach over phpdoc-typed method return to resolve polymorphic call"
    );
}

function testTraitMethodViaQualifiedExtends(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Cms\\Layout\\Laola1\\LandingPageLayout;

class PageController {
    public function render(): mixed {
        return new LandingPageLayout()->createFrontendResponse('html');
    }
}

namespace App\\Cms\\Layout\\Laola1;

class LandingPageLayout extends \\App\\Cms\\Layout {
}

namespace App\\Cms;

trait CreatesFrontendResponses {
    public function createFrontendResponse(string $html): mixed {
    }
}

abstract class Layout {
    use CreatesFrontendResponses;
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Controllers/PageController.php", context);
    walk(tree.rootNode, "app/Http/Controllers/PageController.php", context);

    assert.ok(
        graph.edges.has("App\\Http\\Controllers\\PageController::render->App\\Cms\\CreatesFrontendResponses::createFrontendResponse"),
        "expected trait method call via qualified extends parent"
    );
}

function testPolymorphicOverrideResolved(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Services;

use App\\Cms\\Element;

class PageElementService {
    public function saveConfig(Element $element, array $config): void {
        $element->onSave($config);
    }
}

namespace App\\Cms\\Element\\DVV;

class DvvInstagramElement extends \\App\\Cms\\Element {
    public function onSave(array &$config): void {
        parent::onSave($config);
    }
}

namespace App\\Cms;

class Element {
    public function onSave(array &$config): void {
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Services/PageElementService.php", context);
    walk(tree.rootNode, "app/Http/Services/PageElementService.php", context);
    resolveOverrideCalls();

    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "CALLS" &&
                edge.callType === "OVERRIDE_RESOLVED" &&
                edge.from === "App\\Http\\Services\\PageElementService::saveConfig" &&
                edge.to === "App\\Cms\\Element\\DVV\\DvvInstagramElement::onSave"
        ),
        "expected polymorphic base call to resolve subclass override"
    );
}

function testPropertyChainCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Http\\Services;

use App\\Models\\Website\\Tag;

class SynchronizeTagsBetweenWebsites {
    public function synchronizeTagsBetweenWebsites(Tag $tag): void {
        $tag->getWebsite()->customer->getWebsites();
    }
}

namespace App\\Models\\Website;

use App\\Cms\\Website as CmsWebsite;

class Tag {
    public function getWebsite(): ?CmsWebsite {
        return null;
    }
}

namespace App\\Cms;

class Customer {
    public function getWebsites(): array {
        return [];
    }
}

abstract class Website {
    public readonly Customer $customer;
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    const context = createWalkContext();
    walk(tree.rootNode, "app/Http/Services/SynchronizeTagsBetweenWebsites.php", context);
    propagateClassPropertyTypes();
    walk(tree.rootNode, "app/Http/Services/SynchronizeTagsBetweenWebsites.php", context);

    assert.ok(
        graph.edges.has(
            "App\\Http\\Services\\SynchronizeTagsBetweenWebsites::synchronizeTagsBetweenWebsites->App\\Cms\\Customer::getWebsites"
        ),
        "expected typed property chain to resolve Customer::getWebsites call"
    );
}

function testBladeCaseInsensitiveMethodCall(): void {
    resetGraph();

    graph.nodes.set("App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents", {
        id: "App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents",
        parent: "App\\Cms\\Element\\DVV\\DvvCalendarElement",
        type: "method",
        name: "getAllEvents",
        visibility: "public",
    });

    scanBladeFile(
        "resources/views/calendar.blade.php",
        "@foreach ($element->getallEvents() as $event) @endforeach"
    );
    resolveBladeMethodCalls();

    assert.ok(
        [...graph.edges.values()].some(
            edge =>
                edge.type === "BLADE_CALLS" &&
                edge.to === "App\\Cms\\Element\\DVV\\DvvCalendarElement::getAllEvents"
        ),
        "expected case-insensitive blade method resolution"
    );
}

function testInheritedStaticCall(): void {
    resetGraph();

    const source = `<?php
namespace App\\Cms;

class Element {
    public static function make(): void {
    }
}

class NewsElement extends Element {
}

class Factory {
    public function build(): void {
        NewsElement::make();
    }
}
`;

    const parser = createPhpParser();
    const tree = parser.parse(source);
    walk(tree.rootNode, "app/Cms/Factory.php", createWalkContext());

    assert.ok(
        graph.edges.has("App\\Cms\\Factory::build->App\\Cms\\Element::make"),
        "expected inherited static call to resolve on parent class"
    );
}

testReturnTypeCallChain();
testChainedGetElementLifecycleCall();
testSelfStaticCall();
testForeachPropertyCollectionCall();
testForeachPhpDocReturnCollectionCall();
testTraitMethodViaQualifiedExtends();
testPolymorphicOverrideResolved();
testPropertyChainCall();
testBladeCaseInsensitiveMethodCall();
testInheritedStaticCall();
testBladeMethodCalls();
console.log("resolveExpressionType tests passed");
