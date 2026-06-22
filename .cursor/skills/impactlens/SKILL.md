---
name: impactlens
description: >-
  Run ImpactLens ticket analysis with inferred --answers (never unsure on readable
  tickets), then ai-context or change-impact from the briefing. Use for tickets,
  blast radius, UI→API flows, or ImpactLens / Graph.sqlite / analyze:ticket.
---

# ImpactLens — agent playbook

> **Do not use `unsure` when the ticket text is readable — infer the closest intent yourself.**
>
> Always pass explicit `--answers=ticket_topic:…,change_includes:…`. Leaving intent open (`unsure` or skipping `--answers`) lets the graph rank the wrong workflow — e.g. queue listeners instead of a CMS/UI ticket that mentions VOD or “event” in display rules.

ImpactLens returns a **compact markdown briefing** from a pre-built code graph. Your job: read the ticket, infer intent, run analysis, open only the listed files.

Assume `sqlite/Graph.sqlite` exists unless the user says otherwise. Do **not** re-scan the repo unless the graph is missing or the user asks.

## Step 1 — Read the ticket first

Before running anything, read the full ticket text from `--ticket=path/to/file.txt`. The ticket **is** the summary — titles, overview tables, entity names, layout names, acceptance criteria, etc.

From that text, **infer the closest `ticket_topic` and `change_includes`** and pass them in `--answers`. Do **not** run interactive `analyze:ticket`, do **not** pass `unsure`, and do **not** wait for a human to answer prompts.

## Step 2 — Run ticket analysis with inferred answers

Always pass intent via `--answers` (derived from the ticket you just read):

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/example.txt \
  --scopes=php,js \
  --answers=ticket_topic:<id>,change_includes:<id>
```

Use `--scopes=php` only for pure backend/queue tickets with no UI. Use `php,js` when the ticket mentions CMS, components, layouts, hero/preset/slide, Vue, or frontend display logic.

### Infer `ticket_topic` from ticket text

| Answer id | Pick when ticket is mainly about… |
|-----------|-----------------------------------|
| `ui` | CMS/admin UI, layouts, components, display rules, screens, hero/preset/slide |
| `queue` | SQS, queue listeners, async jobs, consumers, message handling |
| `api` | API contract, request/response fields, serialization, endpoints |
| `import` | XML/CSV/feed import, external provider ingestion |
| `cron` | Scheduled/nightly/daily jobs |
| `migration` | Schema migration, new columns/tables |
| `background` | Background workers (non-SQS) |
| `mixed` | Clearly spans two+ workflows equally (e.g. queue + API field change) |

Never answer `unsure` here if the ticket text is readable.

### Infer `change_includes` from ticket text

| Answer id | Pick when change touches… |
|-----------|---------------------------|
| `cms_ui` | CMS editor, admin UI, component/layout display (most UI layout specs) |
| `queue_job` | Queue listener, SQS consumer, job class |
| `api_field` | API payload/response field add or change |
| `persistence` | DB/model status or column persistence |
| `backend_logic` | Service logic only, no UI or API surface |
| `import_pipeline` | Import/parser/transformer pipeline |
| `infra_new` | Net-new queue/infra from scratch |
| `mixed` | Multiple surfaces apply equally |

Example — hero/layout CMS spec → `--answers=ticket_topic:ui,change_includes:cms_ui`  
Example — SQS archive flow → `--answers=ticket_topic:queue,change_includes:queue_job`  
Example — slide preset dropdown + API filter → `--answers=ticket_topic:ui,change_includes:mixed`

Do **not** use `--non-interactive` as a substitute for reading the ticket — it may still infer wrong on ambiguous text. Prefer explicit `--answers` you chose from the ticket.

## Step 3 — Use the briefing

Default output **is** the briefing. Do not request `--full` unless debugging ranking.

Trust order:

1. **Read first** — open these files, in order (max 3–5 before asking for more)
2. **Likely flow paths** — `[complete]` = UI→HTTP→controller chain; `[partial]` = graph gap — do not invent missing code
3. **Files to open** — deduplicated paths from read-first
4. **Warnings / verify manually** — low confidence, missing JS graph, truncated ticket

Ignore flow paths that do not match ticket entities (unrelated controllers/endpoints). Prefer names from the ticket (hero, preset, slide, etc.).

If **implementation confidence < 0.35**, treat matches as navigation hints only.

## Step 4 — Follow-up commands (use before manual repo search)

Once the briefing gives you a **concrete symbol** (class, method, Vue component id from read-first), use ImpactLens again instead of grepping the monorepo or guessing blast radius.

Symbol ids come from the briefing backticks, e.g.:

- PHP: `SpOTTBackend\\Jobs\\Content\\ProcessExpiredVodObjectJob::handle`
- Vue/JS: `js:apps/.../heroTeaser/index.vue::HeroTeaser`
- API: `api:GET:/slide-presets`

### `analyze:ai-context` — understand one symbol (default follow-up)

**When:** You know *where* to look but need callers, callees, dependencies, inheritance, risk — in one compact report.

**Use instead of:** Opening dozens of files, manual call-chain tracing, guessing what breaks.

```bash
npm run analyze:ai-context -- sqlite/Graph.sqlite "<ClassOrMethodOrNodeId>" --compact
```

Add `--depth=3` if the chain is deep. Prefer `--compact` for chat context.

### `analyze:change-impact` — blast radius before editing

**When:** You plan to change a specific method or class and need *who calls it* / upstream impact.

**Use instead of:** Manual “find references” across the repo.

```bash
npm run analyze:change-impact -- sqlite/Graph.sqlite "<ClassOrMethodId>" --depth=2 --limit=10
```

Read **Affected callers** first; then **What this method uses** for downstream deps.

### `analyze:impact` — deeper impact + inheritance

**When:** `change-impact` is not enough — you need inheritance-aware resolution, richer caller/callee lists, or a full written report.

**Use instead of:** Chasing parent classes and overrides by hand.

```bash
npm run analyze:impact -- sqlite/Graph.sqlite "<Class::method>" --limit=20
```

Heavier output; use when refactoring a core method.

### Other commands (situational)

| Command | Use when | Skip when |
|---------|----------|-----------|
| `analyze:architecture -- --architecture-config=…` | Checking layer violations (controller→service→repo) | Normal ticket implementation |
| `analyze:risk` | Repo-wide “what is risky to touch” prioritization | You already have a ticket-specific target |
| `analyze:hotspots` | Finding highly connected nodes with no ticket | Ticket briefing already named the entrypoint |
| `analyze:cycles` / `analyze:dead-code` | Cleanup/refactor tasks | Feature tickets |

### Suggested agent sequence

```text
1. Read ticket → infer --answers
2. analyze:ticket → briefing → open read-first files (max 3–5)
3. Pick one symbol from briefing
4. analyze:ai-context --compact   (understand local graph)
5. analyze:change-impact          (only if you will edit that symbol)
6. Implement — do not re-derive steps 4–5 by blind grep if graph has the node
```

## Do not

- Use `unsure` (or omit `--answers`) when the ticket text is readable — **infer the closest intent yourself**
- Paste `Graph.json` or `--full` ticket output into chat (token waste)
- Re-scan the monorepo on every ticket
- Treat unrelated `[complete]` flow paths as in-scope for the ticket
- Grep/trace callers manually when `analyze:ai-context` or `analyze:change-impact` can answer from the graph

## Known graph gaps (say honestly if relevant)

- Partial flow paths when Vue has no `HTTP_REQUEST` edge (missing path aliases or scan gap)
- Pug templates not parsed
- Graph excludes `vendor`, `node_modules`, `tests` by default

Human setup (scan, config): `docs/quickstart.md`
