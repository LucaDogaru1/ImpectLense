import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { extractFieldAnchorTerms, findFieldAnchoredNodes } from "./ticketFieldAnchoring";
import { loadTicketGraphContext } from "./ticketGraphContext";
import {
    extractTicketRoutes,
    isAccessSubpathEndpoint,
    matchRouteAnchoredEndpoints,
    normalizeRoutePlaceholderPath,
} from "./ticketRouteAnchoring";
import { inferIntentAnswers } from "./ticketIntent";
import { startTicketSession, continueTicketSession } from "./ticketSession";

const projectRoot = path.resolve(__dirname, "../../..");
const sqlitePath = path.join(projectRoot, "sqlite/Graph.sqlite");
const editorialTicket = fs.readFileSync(
    path.join(projectRoot, "tickets/editorial-image-ticket.txt"),
    "utf8"
);

function testAngleBracketRouteExtraction(): void {
    const routes = extractTicketRoutes(editorialTicket);

    assert.ok(routes.some(route => route.method === "POST" && route.path.includes("contents")));
    assert.equal(normalizeRoutePlaceholderPath("contents/<content>"), "contents/{param}");
}

function testAccessRouteIsRejectedForContentTicket(): void {
    assert.equal(isAccessSubpathEndpoint("contents/{param}/access/{param}"), true);
    assert.equal(isAccessSubpathEndpoint("content/{param}"), false);
}

function testFieldAnchorTerms(): void {
    const terms = extractFieldAnchorTerms(editorialTicket);

    assert.ok(terms.includes("editorial.images"));
    assert.ok(terms.includes("editorial.images.16x9"));
    assert.ok(terms.some(term => term.includes("1x1")));
}

function testRouteAnchoringAvoidsAccessEndpoint(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping route anchoring integration — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const graph = loadTicketGraphContext(db);
        const routes = extractTicketRoutes(editorialTicket);
        const matches = matchRouteAnchoredEndpoints(routes, graph);

        assert.ok(!matches.some(item => /\/access\//i.test(item.id)), "access route should not anchor");
        assert.ok(
            matches.some(item => /content\/{param}|POST:\/content|PATCH:\/content|PUT:\/content/i.test(item.id)),
            "expected content write endpoint anchor"
        );
    } finally {
        db.close();
    }
}

function testFieldAnchoringFindsEditorialImages(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping field anchoring integration — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        const graph = loadTicketGraphContext(db);
        const terms = extractFieldAnchorTerms(editorialTicket);
        const matches = findFieldAnchoredNodes(graph, terms, 5);

        assert.ok(matches.some(item => /editorial\.images\.16x9/i.test(item.name)));
    } finally {
        db.close();
    }
}

function testEditorialBriefingRegression(): void {
    if (!fs.existsSync(sqlitePath)) {
        console.log("  ↷ Skipping editorial briefing regression — sqlite/Graph.sqlite not found");
        return;
    }

    const db = new Database(sqlitePath, { readonly: true });

    try {
        let result = startTicketSession(db, {
            ticketText: editorialTicket,
            limit: 8,
            scopes: ["php", "js"],
            answers: inferIntentAnswers(editorialTicket),
        });

        if (result.status === "needs_input") {
            result = continueTicketSession(db, result.session, { truncated_ack: "yes" }, { limit: 8 });
        }

        assert.equal(result.status, "ready");
        const readFirst = result.briefing!.readFirst;

        assert.ok(readFirst.length > 0);
        assert.ok(
            !readFirst.slice(0, 2).some(item => /\/access\//i.test(item.id)),
            "access route should not dominate read first"
        );
        assert.ok(
            readFirst.some(item =>
                /editorial\.images|StoreContentRequestParser|ContentController::(store|update)/i.test(item.id)
            ),
            "expected editorial field or content parser/controller in read first"
        );
    } finally {
        db.close();
    }
}

function run(): void {
    console.log("ticketEditorialAnchoring tests\n");

    testAngleBracketRouteExtraction();
    console.log("  ✓ angle-bracket route extraction");

    testAccessRouteIsRejectedForContentTicket();
    console.log("  ✓ access subpath detection");

    testFieldAnchorTerms();
    console.log("  ✓ field anchor term extraction");

    testFieldAnchoringFindsEditorialImages();
    console.log("  ✓ field anchoring finds editorial.images");

    testRouteAnchoringAvoidsAccessEndpoint();
    console.log("  ✓ route anchoring avoids access endpoint");

    testEditorialBriefingRegression();
    console.log("  ✓ editorial-image briefing regression");

    console.log("\nAll editorial anchoring tests passed.");
}

run();
