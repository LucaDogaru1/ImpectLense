import assert from "node:assert/strict";
import { buildTicketAnchorContext } from "./ticketAnchoring";
import { extractTicketRoutes, matchRouteAnchoredEndpoints, normalizeTicketRoutePath } from "./ticketRouteAnchoring";
import { extractSymbolAnchors, nodeMatchesSymbolAnchor, scoreSymbolAnchorMatch } from "./ticketSymbolAnchors";
import { TicketGraphContext } from "./ticketGraphContext";

function mockGraph(): TicketGraphContext {
    const nodes = [
        {
            id: "api:GET:config/ui-translations",
            type: "api_endpoint",
            name: "GET config/ui-translations",
            file: "apps/spott-frontend/routes/api.v3.php",
            parent: null,
            description: null,
            keywords: null,
        },
        {
            id: "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Config\\UiTranslationsController::__invoke",
            type: "method",
            name: "__invoke",
            file: "apps/spott-frontend/app/Http/Controllers/Api/V3/Config/UiTranslationsController.php",
            parent: "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Config\\UiTranslationsController",
            description: null,
            keywords: null,
        },
        {
            id: "Modules\\ClientManagement\\UiTranslations\\Domain\\UiTranslationsService::get",
            type: "method",
            name: "get",
            file: "modules/ClientManagement/UiTranslations/Domain/UiTranslationsService.php",
            parent: "Modules\\ClientManagement\\UiTranslations\\Domain\\UiTranslationsService",
            description: null,
            keywords: null,
        },
        {
            id: "SpOTTBackend\\Http\\Controllers\\ClientManager\\v2\\BaseConfig\\BaseConfigPlayerSettingController::update",
            type: "method",
            name: "update",
            file: "apps/spott-backend/app/Http/Controllers/ClientManager/v2/BaseConfig/BaseConfigPlayerSettingController.php",
            parent: "SpOTTBackend\\Http\\Controllers\\ClientManager\\v2\\BaseConfig\\BaseConfigPlayerSettingController",
            description: null,
            keywords: null,
        },
    ];

    const edges = [
        {
            from_id: "api:GET:config/ui-translations",
            to_id: "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Config\\UiTranslationsController::__invoke",
            type: "ROUTES_TO",
        },
    ];

    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const nodesByType = new Map<string, typeof nodes>();

    for (const node of nodes) {
        const bucket = nodesByType.get(node.type) ?? [];
        bucket.push(node);
        nodesByType.set(node.type, bucket);
    }

    return {
        nodes,
        edges,
        nodeById,
        nodesByType,
        haystackById: new Map(nodes.map(node => [node.id, `${node.id} ${node.file ?? ""}`.toLowerCase()])),
        persistEdges: [],
        serializesEdges: [],
    };
}

function testRouteExtraction(): void {
    const ticket =
        "When GET api/v3/config/ui-translations is called with valid filter[locale] and filter[deviceCategory]";

    const routes = extractTicketRoutes(ticket);
    assert.equal(routes.length, 1);
    assert.equal(routes[0]?.method, "GET");
    assert.equal(normalizeTicketRoutePath(routes[0]?.path ?? ""), "config/ui-translations");
}

function testSymbolAnchors(): void {
    const ticket =
        "Shared resolver in Modules\\ClientManagement\\Tenancy\\UiTranslations and GET api/v3/config/ui-translations";

    const anchors = extractSymbolAnchors(ticket);
    assert.ok(anchors.some(anchor => nodeMatchesSymbolAnchor(
        "SpOTTFrontend\\Http\\Controllers\\Api\\V3\\Config\\UiTranslationsController::__invoke",
        "apps/spott-frontend/app/Http/Controllers/Api/V3/Config/UiTranslationsController.php",
        anchor
    )));
}

function testRouteAndSymbolAnchoring(): void {
    const ticket = `When GET api/v3/config/ui-translations is called
Modules\\ClientManagement\\UiTranslations\\Domain\\UiTranslationsService`;

    const graph = mockGraph();
    const routeMatches = matchRouteAnchoredEndpoints(extractTicketRoutes(ticket), graph);
    const context = buildTicketAnchorContext(ticket, graph, 5);

    assert.ok(routeMatches.some(item => item.id === "api:GET:config/ui-translations"));
    assert.ok(context.anchoredTargets.some(item => item.id.includes("UiTranslationsController")));
    assert.ok(
        !context.anchoredTargets.some(item => item.id.includes("BaseConfigPlayerSettingController"))
    );
}

function testLooseSymbolMatchScoresLowerThanExact(): void {
    const anchors = extractSymbolAnchors("Hero Teaser uses heroTeaser:hero layout");

    const exact = scoreSymbolAnchorMatch(
        "js:apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue::HeroTeaser",
        "apps/spott-frontend/resources/assets/js/v3/cells/heroTeaser/index.vue",
        anchors
    );
    const loose = scoreSymbolAnchorMatch(
        "SpOTTBackend\\Page\\Module::isHeroTeaserModule",
        "apps/spott-backend/app/Page/Module.php",
        anchors
    );

    assert.ok(exact > 0);
    assert.ok(loose > 0);
    assert.ok(exact > loose, "exact ticket entity should outrank loose substring match");
}

function run(): void {
    console.log("ticket anchoring tests\n");

    testRouteExtraction();
    console.log("  ✓ route extraction");

    testSymbolAnchors();
    console.log("  ✓ symbol anchors");

    testRouteAndSymbolAnchoring();
    console.log("  ✓ route and symbol anchoring");

    testLooseSymbolMatchScoresLowerThanExact();
    console.log("  ✓ loose symbol matches score lower than exact entity");

    console.log("\nAll ticket anchoring tests passed.");
}

run();
