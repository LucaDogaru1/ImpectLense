# Configuration

ImpactLens uses **three kinds of config**, in **two locations**. No hunting — this page explains each file, why it exists, and how to run it.

## At a glance

| Config | Location | Loaded by | Purpose |
|--------|----------|-----------|---------|
| **Scan config** | `<scan-root>/impactlens.config.json` | `npm run scan` | JS path aliases, HTTP resource class pattern |
| **Architecture rules** | `config/architecture_scan/*.json` | `analyze:architecture --architecture-config=...` | Ignore/allow layer violations |
| **Ticket tuning** | `config/ticket.json` | *(reference only today)* | Stop words, domain keyword weights for ranking |

```
Your monorepo/                          ImpactLens repo/
├── impactlens.config.json   ← scan    ├── config/
└── (code)                               ├── architecture_scan/
                                         │   ├── spott.json
                                         │   └── laravel.example.json
                                         └── ticket.json
```

---

## 1. Scan config — `impactlens.config.json`

**Why:** The scanner reads import strings literally. Bundler aliases like `@/` do not exist on disk unless you map them.

**Where:** At the **scan root** (the repo you pass to `npm run scan`), not inside the ImpactLens tool folder.

**Also accepts:** `.impactlens.json` in the same place.

### Example (Vue/Laravel monorepo with `@/`)

```json
{
  "pathAliases": {
    "@/": "apps/spott-backend/resources/assets/js/"
  },
  "httpResourceClassPattern": "Resource"
}
```

| Key | Why |
|-----|-----|
| `pathAliases` | `@/api/index` → real file path → `API.slidePresets.fetch()` links to backend routes |
| `httpResourceClassPattern` | Matches `SpOTTResource`, `PageResource`, etc. when extracting API barrel files |

### Run

```bash
npm run scan -- /path/to/your-repo --lang=both --no-merge --output=both
```

Scan auto-loads `impactlens.config.json` from `/path/to/your-repo`.

**More detail:** [scan-config.md](scan-config.md)

---

## 2. Architecture rules — `config/architecture_scan/`

**Why:** Layer checks (Controller → Service → Repository) produce noise in Laravel apps: repositories call `Model::query()`, services use `Http::`, controllers type-hint `Request`. Config tells ImpactLens which edges are **acceptable** vs real violations.

**Where:** Shipped examples live in this repo under `config/architecture_scan/`. Point `--architecture-config` at your copy or these files.

### Files

| File | Purpose |
|------|---------|
| `laravel.example.json` | Minimal starter for any Laravel project |
| `spott.json` | SpOTT-specific ignores + ticket tuning block (see below) |

### Structure

```json
{
  "architecture": {
    "ignorePatterns": [
      "*Repository::* -> *::query",
      "*Service::* -> Illuminate\\Support\\Facades\\Http::*"
    ],
    "allow": [
      "Repository -> Domain",
      "Infrastructure -> Domain"
    ],
    "notes": ["Optional human-readable notes — not used by analyzer"]
  }
}
```

| Key | Why |
|-----|-----|
| `ignorePatterns` | Edge patterns to treat as allowed (not violations). Format: `*Source* -> *Target*` |
| `allow` | Layer pairs that are always OK (e.g. Repository accessing Domain models) |

### Example patterns

```json
"*Repository::* -> *::query"
```
Repository calling Eloquent `query()` — normal persistence, not “repository calls controller”.

```json
"*Service::* -> Illuminate\\Http\\Request::*"
```
Service method receives HTTP request — framework plumbing, not a layer breach.

```json
"*Connector::* -> Illuminate\\Support\\Facades\\Http::*"
```
Outbound HTTP client in a connector class — expected.

### Run

```bash
npm run analyze:architecture -- sqlite/Graph.sqlite \
  --architecture-config=config/architecture_scan/spott.json \
  --include-depends-on \
  --ignore-likely-false-positives
```

Use `laravel.example.json` as a template for new projects; copy and trim to your namespaces.

---

## 3. Ticket tuning — `config/ticket.json`

**Why:** Ticket text uses domain words (`sqs`, `filepath`, `vod`, `recording`). Generic tokens (`feature`, `acceptance`) add noise. Weights boost real business terms so ranking prefers the right jobs/controllers/endpoints.

**Where:** `config/ticket.json` in this repo — **reference schema** for how ticket tuning is structured.

**Status:** Not auto-loaded by `analyze:ticket` yet. Values document intended tuning; copy relevant sections into a project config when `--config` support lands, or use the `ticket` block inside `spott.json` as the SpOTT preset.

### Structure

```json
{
  "ticket": {
    "stopWords": ["laravel", "feature", "acceptance"],
    "domainKeywordWeights": {
      "sqs": 13,
      "filepath": 12,
      "recording": 14,
      "30_days": 16
    },
    "methodNameWeights": {
      "handle": 6,
      "deliver": 7,
      "get": -1,
      "find": -1
    },
    "businessTermSeeds": ["recording", "sqs", "vod"],
    "shortTokenWhitelist": ["sqs", "vod", "cms", "api"],
    "entrypointHints": ["job", "listener", "controller", "handle"],
    "confidenceThresholds": { "medium": 90, "high": 160 }
  }
}
```

| Key | Why |
|-----|-----|
| `stopWords` | Ignored when tokenizing ticket text |
| `domainKeywordWeights` | Higher = stronger match for queue/content domain tickets |
| `methodNameWeights` | Boost `deliver`/`update`; penalize generic `get`/`find` |
| `businessTermSeeds` | Seed terms learned from graph + ticket |
| `shortTokenWhitelist` | Allow short tokens (3 chars) that are meaningful (`sqs`, `vod`) |
| `entrypointHints` | Names that suggest entrypoints (job, listener, handle) |
| `confidenceThresholds` | Score cutoffs for medium/high confidence labels |

### Example effect

Ticket: *“SQS message updates recording status by filepath”*

Without weights: generic matches on `status`, `update`.  
With weights: `sqs`, `filepath`, `recording` score higher → queue listener / content service rank above random controllers.

### Intended usage (future)

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/my-ticket.txt \
  --config=config/ticket.json
```

Until wired, ranking uses built-in heuristics in code (`ticketWorkflow.ts`, `ticketAnalyzerV3.ts`).

---

## 4. Combined preset — `config/architecture_scan/spott.json`

**Why:** One file for SpOTT: architecture ignores **and** ticket tuning in one place.

Contains:

- Full `architecture.ignorePatterns` for SpOTT namespaces (`SpOTTBackend`, `Modules`, HTTP facades, repository interfaces)
- `ticket` block with SpOTT domain weights (`recording`, `delivered`, `30_days`, etc.)

Use architecture part today:

```bash
npm run analyze:architecture -- sqlite/Graph.sqlite \
  --architecture-config=config/architecture_scan/spott.json \
  --ignore-likely-false-positives
```

The `ticket` section in the same file is the SpOTT-specific ranking preset (reference until `--config` is connected).

---

## Which config do I need?

| Goal | Config | Action |
|------|--------|--------|
| First-time setup on a monorepo | Scan config | Add `impactlens.config.json` at scan root if using `@/` |
| CI architecture gate | Architecture JSON | `--architecture-config=config/architecture_scan/your.json` |
| Ticket ranking for your domain | Ticket JSON | Copy/adapt `config/ticket.json`; wait for `--config` or tune in code |
| SpOTT codebase | `spott.json` | Architecture rules ready to use |

**Quick path:** [quickstart.md](quickstart.md)
