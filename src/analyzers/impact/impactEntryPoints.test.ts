import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { analyzeChangeImpact } from "./ImpactScoringAnalyzer";
import { analyzeHotspots } from "../hotspots/HotspotAnalyzer";

const db = new Database(":memory:");
db.exec(`
CREATE TABLE nodes (
  id TEXT PRIMARY KEY, parent TEXT, type TEXT, name TEXT, file TEXT,
  start_row INTEGER, end_row INTEGER, visibility TEXT, is_static INTEGER
);
CREATE TABLE edges (from_id TEXT, to_id TEXT, type TEXT, call_type TEXT, via TEXT);

INSERT INTO nodes VALUES
  ('App\\Http\\Controllers\\PaymentController::pay', 'App\\Http\\Controllers\\PaymentController', 'method', 'pay', 'PaymentController.php', 1, 10, 'public', 0),
  ('api:POST:api/payments', NULL, 'api_endpoint', 'api/payments', NULL, NULL, NULL, NULL, NULL),
  ('api:GET:/checkout/pay', NULL, 'api_endpoint', '/checkout/pay', NULL, NULL, NULL, NULL, NULL),
  ('resources/views/checkout/pay.blade.php', NULL, 'blade_view', 'pay', 'pay.blade.php', NULL, NULL, NULL, NULL);

INSERT INTO edges VALUES
  ('api:POST:api/payments', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('api:GET:/checkout/pay', 'App\\Http\\Controllers\\PaymentController::pay', 'ROUTES_TO', NULL, NULL),
  ('resources/views/checkout/pay.blade.php', 'App\\Http\\Controllers\\PaymentController::pay', 'BLADE_USES_ACTION', NULL, NULL);
`);

const payId = "App\\Http\\Controllers\\PaymentController::pay";
const impact = analyzeChangeImpact(db, payId, { depth: 1, limit: 10 });

assert.equal(impact.affectedCallers, 3, "routes and blade count as upstream consumers");
assert.equal(impact.components.directEntryPoints, 3, "three direct entry points");
assert.equal(impact.components.directCallChainCallers, 0, "no call-chain callers");
assert.ok(
    impact.affectedCallersList.some(item => item.relationType === "ROUTES_TO"),
    "caller list includes ROUTES_TO",
);
assert.ok(
    impact.affectedCallersList.some(item => item.relationType === "BLADE_USES_ACTION"),
    "caller list includes BLADE_USES_ACTION",
);

const hotspots = analyzeHotspots(db, { limit: 10 });
const payHotspot = hotspots.methodHotspots.find(item => item.id === payId);
assert.ok(payHotspot, "pay appears in method hotspots");
assert.equal(payHotspot.incoming, 3, "hotspot incoming includes entry points");

db.close();
console.log("impact entry points tests passed");
