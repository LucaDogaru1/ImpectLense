# Commands

This page contains detailed command usage for ImpactLens.

## Scan

Purpose: parse PHP and/or JavaScript/Vue files and build the graph database.

```bash
npm run scan -- <project-root> [options]
```

Examples:

```bash
npm run scan -- phptest/mini --lang=php --output=sqlite --sqlite-path=Graph.mini.sqlite
npm run scan -- /path/to/monorepo --lang=both --no-merge --output=both
npm run scan -- jsproject --lang=js --no-merge --output=json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--lang=php\|js\|both` | `both` | Languages to scan |
| `--output=json\|sqlite\|both` | `json` | Output format |
| `--sqlite-path=<file>` | `sqlite/Graph.sqlite` | SQLite output path |
| `--graph-json=<file>` | `Graph.json` | JSON output path |
| `--no-merge` | off | Do not merge into existing `Graph.json` |

**Scan config:** place `impactlens.config.json` at the scan root for path aliases and HTTP resource patterns. See [Scan config](scan-config.md).

Output: graph in JSON, SQLite, or both — consumed by all analysis commands.

---

## Impact Report

Purpose: inspect one class or method and see callers, callees, dependencies, cycles, architecture warnings, and change-impact hints.

```bash
npm run analyze:impact -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create"
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService" --include-depends-on
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create" --json --output=impact.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max entries per section |
| `--include-depends-on` | off | Include constructor dependency edges |
| `--include-interface-resolved` | off | Include interface-resolved call edges |
| `--impact-depth=N` | `2` | Depth for embedded change-impact scoring |
| `--impact-limit=N` | `5` | Max rows in embedded change-impact lists |
| `--no-impact-score` | off | Disable embedded blast-radius section |
| `--verbose` | off | Show extra details (e.g., affected file list) |
| `--json` | off | Output as JSON |
| `--output=<file>` | `impact.txt` | Write report to file |

Output explanation:
- Shows a compact summary, relationships, dependencies, usage, and optional embedded change-impact.
- Reports unresolved calls and inherited call resolutions when applicable.

JSON output example:

```json
{
  "target": { "id": "UserService::create", "type": "method" },
  "stats": {
    "incomingCalls": 1,
    "outgoingCalls": 3,
    "dependsOnOutgoing": 0,
    "dependsOnIncoming": 0,
    "cycles": 0,
    "archViolations": 0
  },
  "usages": [],
  "dependencies": [],
  "topNeighbors": [],
  "changeImpact": {
    "risk": "MEDIUM",
    "score": 14
  }
}
```

---

## Cycle Detection

Purpose: detect circular call/dependency paths.

```bash
npm run analyze:cycles -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:cycles -- Graph.mini.sqlite
npm run analyze:cycles -- Graph.mini.sqlite --include-depends-on
npm run analyze:cycles -- Graph.mini.sqlite --json --output=cycles.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max cycles shown |
| `--include-depends-on` | off | Include `DEPENDS_ON` edges |
| `--include-interface-resolved` | off | Include `INTERFACE_RESOLVED` calls |
| `--fail-on-cycles` | off | Exit code `1` if any cycles are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Lists cycle paths, edge types, and files involved.

JSON output example:

```json
{
  "totalEdges": 9,
  "cycleCount": 1,
  "includeDependsOn": false,
  "includeInterfaceResolved": false,
  "cycles": [
    {
      "nodes": ["A::x", "B::y", "A::x"],
      "length": 2,
      "files": ["A.php", "B.php"],
      "edgeTypes": ["CALLS", "CALLS"]
    }
  ]
}
```

---

## Dead Code Detection

Purpose: find public methods with no detectable incoming usage.

```bash
npm run analyze:dead-code -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:dead-code -- Graph.mini.sqlite
npm run analyze:dead-code -- Graph.mini.sqlite --debug="MiniProject\Application\Services\UserService::sendWelcome"
npm run analyze:dead-code -- Graph.mini.sqlite --json --output=dead-code.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max methods shown |
| `--debug="Class::method"` | — | Show detailed scoring breakdown for a method |
| `--include-interface-resolved` | off | Count interface-resolved calls as usage |
| `--include-depends-on` | off | Accepted, no scoring effect |
| `--no-ignore-constructors` | off | Include constructors |
| `--no-ignore-controller-actions` | off | Include controller action methods |
| `--no-ignore-magic-methods` | off | Include magic methods |
| `--no-ignore-tests` | off | Include methods in test files |
| `--no-ignore-interface-methods` | off | Include interface method declarations |
| `--fail-on-dead-code` | off | Exit code `1` if dead methods are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Shows dead methods and optional debug reasons for why a method is considered unused.

JSON output example:

```json
{
  "scannedMethods": 16,
  "deadMethods": 4,
  "items": [
    {
      "id": "UserService::unusedMethod",
      "name": "unusedMethod",
      "incomingCalls": 0
    }
  ]
}
```

---

## Architecture Analysis

Purpose: detect dependency direction violations across layers.

```bash
npm run analyze:architecture -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:architecture -- Graph.mini.sqlite
npm run analyze:architecture -- Graph.mini.sqlite --include-depends-on
npm run analyze:architecture -- Graph.sqlite --include-depends-on --ignore-likely-false-positives
npm run analyze:architecture -- Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives
npm run analyze:architecture -- Graph.mini.sqlite --json --output=arch.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max violations shown |
| `--include-depends-on` | off | Check `DEPENDS_ON` edges too |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--ignore-likely-false-positives` | off | Exclude framework HTTP false positives from active results and fail checks |
| `--architecture-config=<file>` | — | JSON rules: `architecture.ignorePatterns` / `architecture.allow` (e.g. `config/architecture_scan/spott.json`) |
| `--fail-on-violations` | off | Exit code `1` if violations are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Reports source and target layer, severity, reason, expected flow, and detected flow.
- Marks likely Laravel/framework HTTP namespace false positives (`Illuminate\\Http`, `Psr\\Http`, `Symfony\\Component\\HttpFoundation`, etc.).
- Treats `*Repository::* -> *::query` as a likely ORM/persistence access pattern when configured or detected heuristically.
- Summary separates `violations (total)` from `actionable violations`.
- With `--ignore-likely-false-positives`, fail checks and shown rows are based on active violations only.
- With `--architecture-config`, you can add project-specific allow/ignore patterns without touching code.
- The SpOTT project config keeps real service-level issues such as `TargetService -> PropertyLicenseService`, `ModuleService -> ModuleRequest`, and `ImporterService -> StoreContentRequestParser` visible.

JSON output example:

```json
{
  "inspectedEdges": 12,
  "violationCount": 1,
  "likelyFalsePositiveCount": 0,
  "actionableViolationCount": 1,
  "architectureConfigPath": "impactlens.config.example.json",
  "violations": [
    {
      "fromId": "UserRepository::badMethod",
      "toId": "UserController::show",
      "severity": "HIGH",
      "reason": "Repositories should not call Controllers.",
      "expected": "Controller -> Service -> Repository",
      "detected": "Repository -> Controller"
    }
  ]
}
```

---

## Hotspot Analysis

Purpose: rank heavily connected nodes that are likely to be change-risk hotspots.

```bash
npm run analyze:hotspots -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:hotspots -- Graph.mini.sqlite
npm run analyze:hotspots -- Graph.mini.sqlite --include-depends-on
npm run analyze:hotspots -- Graph.mini.sqlite --json --output=hotspots.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max entries per section |
| `--include-depends-on` | off | Include dependency edges in scoring |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Shows method hotspots, class hotspots, dependency hotspots, and fan-out hotspots.

JSON output example:

```json
{
  "inspectedNodes": 23,
  "limit": 10,
  "methodHotspots": [],
  "classHotspots": [],
  "dependencyHotspots": [],
  "fanOutHotspots": []
}
```

---

## Change Impact Analysis

Purpose: estimate blast radius for a changed method or class.

```bash
npm run analyze:change-impact -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create"
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService" --include-depends-on
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create" --depth=3 --decay=0.5 --json --output=change-impact.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Traversal depth for transitive impact |
| `--limit=N` | `10` | Max impacted nodes shown |
| `--decay=N` | `0.6` | Weight decay per hop (`0.1` to `1.0`) |
| `--verbose` | off | Show affected file list and technical details |
| `--include-depends-on` | off | Include `DEPENDS_ON` links |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Highlights risk first, then score.
- Separates upstream impact (`Affected callers`) from downstream usage (`What this method/class uses`).

JSON output example:

```json
{
  "target": { "id": "UserService::create", "type": "method" },
  "changeImpact": {
    "risk": "MEDIUM",
    "score": 14,
    "affectedCallers": 2,
    "methodsUsedByTarget": 3,
    "affectedFiles": 4,
    "components": {
      "directCallers": 1,
      "indirectCallers": 1,
      "directCallees": 3,
      "dependencyLinks": 0,
      "inheritanceLinks": 0
    },
    "affectedCallersList": [],
    "usedByTargetList": []
  }
}
```

---

## Ticket Analysis

Purpose: map ticket text to ranked components and produce an AI briefing.

```bash
npm run analyze:ticket -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite --ticket=tickets/example.txt --scopes=php,js
npm run analyze:ticket -- sqlite/Graph.sqlite --ticket=tickets/example.txt --scopes=php,js --full
npm run analyze:ticket -- sqlite/Graph.sqlite --ticket=tickets/example.txt --scopes=php,js --answers=ticket_topic:queue
npm run analyze:ticket -- sqlite/Graph.sqlite --ticket=tickets/example.txt --legacy --limit=10
```

Default output is the AI briefing (token-efficient). Session flags:

| Option | Description |
|---|---|
| `--ticket=path` | Path to ticket text file |
| `--scopes=php,js` | Graph surfaces to include (auto-detects js when graph has Vue/JS nodes) |
| `--answers=q:id,...` | Pre-fill session answers (works with either mode) |
| `--boost=term,...` | Agent hint: boost nodes matching symbol/path terms from the ticket |
| `--suppress=term,...` | Agent hint: demote or drop noisy matches |
| `--non-interactive` | Infer intent and skip prompts (alias: `--auto`) |
| `--full` | Briefing + detailed analysis (raw matches, evidence) |
| `--legacy` | Skip session; direct analyzer output |
| `--limit=N` | Max ranked matches (legacy / debug) |
| `--json` | Machine-readable output |

Details: [Ticket analysis](ticket-analysis.md) · [Scan config](scan-config.md) (for JS HTTP linking).

---

## AI Context Report

Purpose: generate a compact AI-friendly context report by aggregating existing analyses.

```bash
npm run analyze:ai-context -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create"
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --include-depends-on --depth=3
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --compact
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --json --output=ai-context.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Depth used by change-impact aggregation |
| `--limit=N` | `20` | Max rows per section |
| `--include-depends-on` | off | Include constructor dependencies |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--compact` | off | Render a denser Markdown report for AI prompt paste |
| `--json` | off | Output machine-readable JSON instead of Markdown |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Markdown by default for copy/paste into AI tools.
- `--compact` keeps the same information model with shorter Markdown sections.
- Summary includes risk ranking context (`risk rank`, `percentile`, candidate-pool scope, and graph population).
- Architecture notes mark likely framework HTTP false positives when applicable.
- Includes target metadata, summary, purpose guess, callers, calls, dependencies, inheritance, architecture notes, cycles, and suggested review scope.
- Built as an aggregation layer on top of existing analyses.
- Works as the core AI feature; pair it with `analyze:ticket` for ticket-driven navigation.

JSON output example:

```json
{
  "target": { "id": "App\\Services\\UserService::create", "type": "method", "location": "App/Services/UserService.php:10-30" },
  "summary": {
    "changeRisk": "MEDIUM",
    "impactScore": 14,
    "riskRank": 1,
    "riskPopulation": 17219,
    "riskPercentileTop": 0.01,
    "riskCandidatePool": 100,
    "affectedCallers": 2,
    "methodsUsedByTarget": 3,
    "affectedFiles": 4
  },
  "callers": [],
  "callees": [],
  "dependencies": [],
  "inheritance": [],
  "architecture": [],
  "cycles": [],
  "affectedFiles": []
}
```

---

## Risk Ranking

Purpose: combine hotspot traffic and change-impact blast radius into a single refactoring-priority list.

```bash
npm run analyze:risk -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:risk -- Graph.sqlite
npm run analyze:risk -- Graph.sqlite --include-depends-on --depth=3 --limit=15
npm run analyze:risk -- Graph.sqlite --candidate-pool=200 --limit=15
npm run analyze:risk -- Graph.sqlite --json --output=risk.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Depth for change-impact scoring per hotspot candidate |
| `--limit=N` | `10` | Max ranked components shown |
| `--candidate-pool=N` | `max(limit*20,100)` | Number of hotspot candidates to evaluate before ranking |
| `--include-depends-on` | off | Include constructor dependencies |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output machine-readable JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Produces `HIGH RISK COMPONENTS` ranked by risk tier and combined score.
- Text output shows ranking scope explicitly: `candidate pool: top N hotspot candidates` and `population: X nodes`.
- Includes `combined score`, `risk rank`, and `percentile` to avoid CRITICAL inflation.
- Helps prioritize where refactoring is most likely to reduce operational risk.

JSON output example:

```json
{
  "includeDependsOn": false,
  "includeInterfaceResolved": false,
  "depth": 2,
  "limit": 10,
  "candidatePool": 100,
  "population": 17219,
  "items": [
    {
      "id": "ContentRelationsService::updateOrCreate",
      "hotspotScore": 31,
      "impactScore": 87,
      "combinedScore": 292,
      "risk": "CRITICAL",
      "riskRank": 1,
      "percentileTop": 0.01
    }
  ]
}
```

---

## JSON tips with jq

```bash
# Print all cycle paths
npm run analyze:cycles -- Graph.sqlite --json | jq '.cycles[].nodes'

# Count dead methods
npm run analyze:dead-code -- Graph.sqlite --json | jq '.deadMethods'

# Show only HIGH severity violations
npm run analyze:architecture -- Graph.sqlite --json | jq '.violations[] | select(.severity == "HIGH")'

# Top 3 method hotspots
npm run analyze:hotspots -- Graph.sqlite --json | jq '.methodHotspots[:3]'

# Blast-radius risk and score
npm run analyze:change-impact -- Graph.sqlite "App\\Services\\UserService::create" --json | jq '.changeImpact | {risk, score, affectedCallers, methodsUsedByTarget}'
```

---

## Real codebase smoke tests

Use these as copy/paste examples against your existing graph file:

```bash
npm run smoke:real-db
npm run smoke:real-db:fast
npm run smoke:real-db:full
npm run analyze:architecture -- sqlite/Graph.sqlite --include-depends-on --ignore-likely-false-positives --fail-on-violations
npm run analyze:architecture -- sqlite/Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives --fail-on-violations
npm run analyze:risk -- sqlite/Graph.sqlite --candidate-pool=200 --limit=20 --output=risk.real.txt
npm run analyze:ai-context -- sqlite/Graph.sqlite "SpOTTBackend\\Services\\Content\\Search\\SearchService::buildParamsFromRequest" --compact --output=ai-context.real.md
```

`smoke:real-db` points to `smoke:real-db:fast` (quick release sanity check). Use `smoke:real-db:full` for slower, deeper checks including dead-code and change-impact commands.

---

## Known limitations

- Dynamic method calls through unresolved variables may be missed.
- Reflection-based dispatch (`ReflectionClass`, `call_user_func`) is not fully tracked.
- Runtime-generated/proxy classes are not analyzed.
- Framework entry points (routes/listeners/jobs/commands) may be partially detected.
- Trait resolution can be partial depending on inclusion context.
- Methods called only outside the scanned scope can appear as dead code.

---

## Roadmap

- SCC detection for tightly coupled clusters.
- Framework entry-point detection to reduce dead-code false positives.
- Laravel route analysis mapped to controller actions.
- Symfony container wiring analysis.
- Interactive graph visualization.

