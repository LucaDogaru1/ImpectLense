# Ticket analysis

`analyze:ticket` maps ticket text to ranked graph nodes and produces an **AI briefing** (read-first list, flow paths, warnings).

**Agents:** run `ticket:classify` first, review the JSON, decide `--answers` and `--scopes`, then run `analyze:ticket`. The briefing includes the classification section (suggestions vs applied answers).

Default mode runs a **session**: intent questions → graph probe → briefing. **Interactive by default** — use `--non-interactive` with explicit `--answers` from classification review. Use `--legacy` for the older direct analyzer output.

## Quick start

### 1. Classify

```bash
npm run classify:ticket -- --ticket=tickets/example.txt
```

### 2. Analyze (after choosing answers)

Default output is the **AI briefing only** — optimized for pasting into an LLM. Use `--full` for raw matches and evidence.

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/example.txt \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui \
  --non-interactive
```

Add `--full` when debugging ranking.

| Flag | Purpose |
|---|---|
| `--scopes=php,js` | Graph scopes (defaults from classification when `--answers` set and `--scopes` omitted) |
| `--non-interactive` | Skip prompts; **requires** `--answers` from classification review |
| `--answers=...` | Required in `--non-interactive` — do not omit |
| `--boost=term,...` | Agent hint: boost graph nodes matching these symbols or path segments |
| `--suppress=term,...` | Agent hint: demote or drop nodes matching these terms |
| `--full` | Briefing + detailed analysis sections |
| `--legacy` | Skip session; raw ranked matches |

Full option list: [Commands → Ticket analysis](commands.md#ticket-analysis).

## Session workflow

```text
Ticket text
    → Intent questions (topic, scope, truncation)
    → Graph probe (structural candidates, coverage)
    → analyzeTicket (ranking + flow paths)
    → Ticket briefing (markdown for AI paste)
```

## Briefing sections

| Section | Purpose |
|---|---|
| **Read first** | Ordered starting points (workflow-aware: UI tickets prefer Vue/setup paths) |
| **Likely flow paths** | UI → HTTP → backend chains; marks complete vs partial gaps |
| **Files to open** | Distinct file paths from read-first |
| **Skip / verify / warnings** | False starts, missing layers, low confidence |

### Flow paths

Built from `HTTP_REQUEST` and `ROUTES_TO` edges in the graph:

```text
- [complete] fetchSlidePresets → GET /slide-presets → SlidePresetsController::index
- [partial] HeroTeaser — No HTTP_REQUEST edge from this component
```

Partial paths indicate a gap (Pug template not parsed, missing alias config, no client call in graph). See [Scan config](scan-config.md) for alias setup.

## Workflow detection

The analyzer detects a dominant workflow (queue, API, UI, import, …) and adjusts ranking:

- **UI**: boosts Vue components, `::setup`, frontend paths; penalizes unrelated search/index code
- **Queue**: prefers jobs, listeners, `handle()` over controllers
- **API**: prefers controllers and REST endpoints

Details: [Workflow detection](workflow-detection.md).

## Ranking signals

Explainable score components:

- Token/keyword match in id, name, file
- Entity tokens (PascalCase, snake_case domain terms)
- Workflow alignment boost/penalty
- Graph proximity to seed matches (neighbors of top entity hits)
- Vue/frontend nodes when `--scopes` includes `js`

## End-to-end AI workflow

```bash
# 1. Scan with both languages (+ impactlens.config.json if using @/ imports)
npm run scan -- /path/to/repo --lang=both --output=both

# 2. Ticket → briefing
npm run analyze:ticket -- sqlite/Graph.sqlite --ticket=tickets/my-ticket.txt --scopes=php,js --full

# 3. Deep context on a top hit
npm run analyze:ai-context -- sqlite/Graph.sqlite "Some\\Controller::update" --compact
```

## Ticket files

Store tickets in `tickets/`. See [tickets/README.md](../tickets/README.md).

Optional ticket tuning: see `config/ticket.json` and [config.md](config.md) (reference schema; not auto-loaded yet).
