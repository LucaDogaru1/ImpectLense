import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { searchNodes } from "../../graph/queries/searchNodes";
import { gatherNavigationContext } from "./gatherNavigationContext";
import { findNode } from "../../graph/queries/GraphQueries";
import {
    filterFieldFlowEdges,
    findRouteScopedGraphEntries,
} from "../../graph/queries/navigationQueries";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT, start_row INTEGER, end_row INTEGER);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('App\\Http\\Controllers\\PaymentController::pay', 'App\\Http\\Controllers\\PaymentController', 'method', 'pay', 'PaymentController.php', 1, 10),
  ('api:POST:api/payments', NULL, 'api_endpoint', 'api/payments', NULL, NULL, NULL),
  ('api:GET:/checkout/pay', NULL, 'api_endpoint', '/checkout/pay', NULL, NULL, NULL),
  ('resources/views/payments/form.blade.php', NULL, 'blade_view', 'form', 'form.blade.php', NULL, NULL),
  ('request_field:amount', NULL, 'request_field', 'amount', NULL, NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::pay::$data.amount', NULL, 'variable_field', '$data.amount', NULL, NULL, NULL);

INSERT INTO edges VALUES
  ('api:POST:api/payments', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('api:GET:/checkout/pay', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('resources/views/payments/form.blade.php', 'App\\Http\\Controllers\\PaymentController::pay', 'BLADE_USES_ACTION', NULL, NULL),
  ('request_field:amount', 'App\\Http\\Controllers\\PaymentController::pay::$data.amount', 'ASSIGNS', NULL, NULL),
  ('App\\Http\\Controllers\\PaymentController::pay', 'validation:App\\Http\\Controllers\\PaymentController::pay:amount', 'VALIDATES', NULL, NULL);
`);

const symbolMatches = searchNodes(db, "PaymentController");
assert.ok(symbolMatches.some(match => match.id.includes("PaymentController::pay")), "find symbol by class name");

const routeMatches = searchNodes(db, "POST api/payments", { kind: "route" });
assert.ok(routeMatches.some(match => match.id === "api:POST:api/payments"), "find route endpoint");

const fieldMatches = searchNodes(db, "amount", { kind: "field" });
assert.ok(fieldMatches.some(match => match.id === "request_field:amount"), "find request field");

const deduped = filterFieldFlowEdges([
    { type: "FLOWS_TO", from: "request_field:amount", to: "App\\Services\\PaymentService::process", via: "$data" },
    { type: "ARGUMENT_TO", from: "request_field:amount", to: "App\\Services\\PaymentService::process::$dto", via: "$data" },
]);
assert.equal(deduped.length, 1, "ARGUMENT_TO suppresses matching FLOWS_TO");
assert.equal(deduped[0]?.type, "ARGUMENT_TO");

const payTarget = findNode(db, "App\\Http\\Controllers\\PaymentController::pay")!;
const payNavigation = gatherNavigationContext(db, payTarget, { callees: [] });
assert.equal(payNavigation.routeEntries.length, 2, "navigation includes all route entries for pay");
assert.equal(payNavigation.bladeEntries.length, 1, "navigation includes blade entry");
assert.equal(payNavigation.graphEntries.length, 3, "graph entries include routes and blade");
assert.ok(payNavigation.fieldAssignments.length >= 1, "navigation includes field assignments");
assert.ok(payNavigation.validates.length >= 1, "navigation includes validation edges");

const routeTarget = findNode(db, "api:POST:api/payments")!;
const routeNavigation = gatherNavigationContext(db, routeTarget, { callees: [] });
assert.equal(routeNavigation.routeEntries.length, 1, "route target includes self route entry");
assert.equal(routeNavigation.routeEntries[0]?.endpointId, "api:POST:api/payments");
assert.equal(routeNavigation.bladeEntries.length, 0, "route target does not pull blade from sibling entries");
assert.ok(
    !routeNavigation.graphEntries.some(entry => entry.kind === "route" && entry.from === "api:GET:/checkout/pay"),
    "route-scoped graph entries exclude other routes to the same controller",
);

const scopedEntries = findRouteScopedGraphEntries(
    db,
    "api:POST:api/payments",
    "App\\Http\\Controllers\\PaymentController::pay",
);
assert.ok(
    !scopedEntries.some(entry => entry.from === "api:GET:/checkout/pay"),
    "findRouteScopedGraphEntries excludes sibling routes",
);

db.close();
console.log("navigation tests passed");
