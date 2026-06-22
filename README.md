# ImpactLens

ImpactLens scans PHP and JavaScript/Vue codebases into a **queryable code graph**, then maps **ticket text to that graph** — producing a compact briefing of where to start in code.

**Ticket → graph → briefing** is the core workflow. Everything else (blast radius, architecture, cycles) queries the same graph.

It is **static analysis** (tree-sitter, no runtime). Scan once into `Graph.sqlite`; run analyzers as often as you need.

## What it does

1. **Build a graph** — classes, methods, Laravel routes, Vue components, imports, calls, and (when resolvable) **HTTP links from frontend to backend**.
2. **Turn tickets into navigation** — `analyze:ticket` reads a Jira export, issue, or spec file and returns read-first files, symbols, and likely UI → API → backend flows.
3. **Answer “what breaks if I change this?”** — callers, callees, blast radius, cycles, layer violations, hotspots.

The main design goal is **compact, navigable context for humans and AI agents** — briefings and `--compact` reports instead of dumping whole repos into chat.

### Typical outcome of `analyze:ticket`

Most dependency-graph tools stop at “who calls whom.” ImpactLens starts from **what you’re trying to do**:

**Input**
- Jira ticket, GitHub issue, or markdown spec (`--ticket=tickets/my-ticket.txt`)

**Output** (markdown briefing)
- **Read first** — files and symbols to open, in order
- **Likely flow paths** — UI → HTTP → controller when the graph has the edges; `[partial]` when it does not
- **Warnings and graph gaps** — low confidence, missing JS scan, ambiguous intent

```text
ticket text  →  graph probe  →  ranked matches  →  briefing
```

## Typical workflow

```bash
npm install

# 1. Scan the codebase you care about (re-run when it changes a lot)
npm run scan -- /path/to/repo --lang=both --no-merge --output=both

# 2. Analyze a ticket → markdown briefing (default output)
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/my-ticket.txt \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui

# 3. Optional: deep dive one symbol from the briefing
npm run analyze:ai-context -- sqlite/Graph.sqlite "App\\Services\\Foo::bar" --compact
```

If the scanned repo uses **`@/` import aliases**, add `impactlens.config.json` at the **scan root** (the repo you pass to `scan`, not inside ImpactLens). Without it, Vue→API→controller chains often stay broken. See [docs/scan-config.md](docs/scan-config.md).

**→ Full setup:** [docs/quickstart.md](docs/quickstart.md)

## Commands

| Command | Purpose |
|---------|---------|
| `npm run scan` | Build graph from PHP and/or JS/Vue (`--lang=php\|js\|both`) |
| `npm run analyze:ticket` | Ticket text → AI briefing (read-first, flow paths) |
| `npm run analyze:ai-context` | Compact report for one class/method/component |
| `npm run analyze:change-impact` | Who is affected if you change a symbol |
| `npm run analyze:impact` | Richer impact report (callers, inheritance, callees) |
| `npm run analyze:architecture` | Layer / dependency rule violations |
| `npm run analyze:cycles` | Circular dependency detection |
| `npm run analyze:dead-code` | Likely unreachable nodes |
| `npm run analyze:hotspots` | Heavily connected nodes |
| `npm run analyze:risk` | Combined risk ranking |

Ticket input is **`--ticket=path/to/file.txt`** only (e.g. `tickets/my-ticket.txt`).

## Ticket analysis

`analyze:ticket` runs a short **session**: confirm intent (topic + scope), probe the graph, rank matches, emit the briefing above.

- **Interactive by default** in the terminal — or pass `--answers=…` / `--non-interactive` for scripts and agents.
- Default output is **briefing only** (good for pasting into an LLM). Use `--full` when debugging ranking.
- Ranks by ticket tokens, workflow (queue / API / UI / import), and graph structure — not magic; ambiguous tickets need sensible `--answers`.

Example briefing excerpt (when the graph has the edges):

```text
## Read first (in order)
1. `.../SlidePresetDropdown.vue::fetchSlidePresets` — Matched token(s): slide, preset, dropdown

## Likely flow paths
- [complete] fetchSlidePresets → GET /slide-presets → SlidePresetsController::index
- [partial] heroTeaser/index.vue::HeroTeaser — No HTTP_REQUEST edge from this component
```

Agents: see [.cursor/skills/impactlens/SKILL.md](.cursor/skills/impactlens/SKILL.md).

## What the scanner actually captures

**PHP (tree-sitter):** classes, methods, routes, jobs/listeners/commands as entrypoints, call and dependency edges.

**JS/Vue:** modules, Vue SFCs (including partial `<script setup>` support), composables, imports, calls, global `fetch()`, and **registry-based API clients** (e.g. `API.slidePresets.fetch()` → route node when `@/` resolves).

**Cross-language:** when JS `HTTP_REQUEST` paths match PHP routes, you get UI → endpoint → controller chains in the graph and in ticket briefings.

## Honest limits

ImpactLens is strong on **navigation and blast radius**, not on proving correctness.

| Area | Reality |
|------|---------|
| **Import aliases** | Must map `@/` (etc.) in `impactlens.config.json` at scan root. One `@/` target per scan — monorepos with backend + frontend both using `@/` may need separate scans + merge. |
| **Vue** | SFC script blocks yes; Pug templates not parsed; not all Nuxt/`useFetch` patterns linked yet. |
| **Ticket ranking** | Heuristic — wrong workflow if intent is left open (`unsure`). Agents should pass explicit `--answers` from ticket text. |
| **Flow paths** | `[partial]` means a real graph gap — do not invent missing code. Unrelated `[complete]` paths can appear; match ticket entities. |
| **Ticket tuning JSON** | `config/ticket.json` is reference schema; not wired to CLI yet (ranking is in code). |
| **Architecture rules** | Separate config via `--architecture-config=` (e.g. `config/architecture_scan/laravel.example.json`). |

None of that makes the tool useless — it means **scan quality and intent matter**, and briefings are starting points, not specs.

## Configuration

| Config | Where | Used by |
|--------|-------|---------|
| `impactlens.config.json` | Scan root (your repo) | `npm run scan` — path aliases, HTTP resource pattern |
| `config/architecture_scan/*.json` | This repo | `analyze:architecture --architecture-config=…` |

Details: [docs/config.md](docs/config.md)

Local-only (gitignored): demo folders `project/`, `jsproject/`, ticket files under `tickets/`, SpOTT preset `config/architecture_scan/spott.json`.

## Documentation

| Doc | Contents |
|-----|----------|
| **[Quickstart](docs/quickstart.md)** | Install, scan, ticket analysis |
| **[Config](docs/config.md)** | All config types |
| [Commands](docs/commands.md) | Full CLI reference |
| [Scan config](docs/scan-config.md) | Path aliases, HTTP linking |
| [Graph model](docs/graph-model.md) | Node and edge types |
| [Ticket analysis](docs/ticket-analysis.md) | Session, briefing, workflows |
| [AI context](docs/ai-context.md) | Symbol deep dive |
| [Architecture](docs/architecture.md) | Layer rules |
| [CI](docs/ci.md) | Fail flags for pipelines |

## License

ISC
