---
name: impactlens
description: >-
  Run ImpactLens ticket analysis with inferred --answers (never unsure on readable
  tickets), then ai-context or change-impact from the briefing. Use for tickets,
  blast radius, UI→API flows, or ImpactLens / Graph.sqlite / impactlens ticket.
---

# ImpactLens — agent playbook

> **Do not use `unsure` when the ticket text is readable — infer the closest intent yourself.**
>
> Always pass explicit `--answers=ticket_topic:…,change_includes:…`. Leaving intent open (`unsure` or skipping `--answers`) lets the graph rank the wrong workflow — e.g. queue listeners instead of a CMS/UI ticket that mentions VOD or “event” in display rules.

ImpactLens returns a **compact markdown briefing** from a pre-built code graph.
Your job:
1. Read the ticket.
2. Infer intent.
3. Run ticket analysis.
4. Open only the highest-ranked files first.

Assume `sqlite/Graph.sqlite` exists unless the user says otherwise. Do **not** re-scan the repo unless the graph is missing or the user asks.

CLI: `impactlens <command> …` (from `npm install impactlens` or `npx impactlens …`).

The preferred CLI is `impactlens ...`.
Avoid legacy examples using `npm run analyze:*` unless working inside the ImpactLens source repository itself.

### Ticket-first mindset

The ticket is the specification.

ImpactLens is a navigation tool that helps locate the implementation.
Do not infer requirements from graph results that are not present in the ticket.

If graph matches and ticket requirements disagree:
1. Trust the ticket.
2. Use the graph to find the implementation.
3. Verify manually before changing code.

## Step 1 — Read the ticket first

Before running anything, read the full ticket text from `--ticket=path/to/file.txt`. The ticket **is** the summary — titles, overview tables, entity names, layout names, acceptance criteria, etc.

From that text, **infer the closest `ticket_topic` and `change_includes`** and pass them in `--answers`. Do **not** run interactive ticket analysis, do **not** pass `unsure`, and do **not** wait for a human to answer prompts.

## Step 2 — Run ticket analysis with inferred answers

Always pass intent via `--answers` (derived from the ticket you just read):

```bash
impactlens ticket sqlite/Graph.sqlite \
  --ticket=tickets/example.txt \
  --scopes=php,js \
  --answers=ticket_topic:<id>,change_includes:<id> \
  --boost=SlidePresetDropdown,slidePreset \
  --suppress=vertical-promotion
```

`--boost` / `--suppress` are optional agent hints. Use them when the ticket names concrete symbols but the graph ranks noisy neighbors higher (e.g. hero tickets where `vertical-promotion` drowns `heroTeaser`). The analyzer still ranks against the real graph — hints only nudge scores.

### Scope selection (`--scopes`)

Choose scopes based on **how the feature is implemented**, not simply whether a UI exists.

| Scopes   | Use when…                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `php`    | Backend-only work: queue jobs, imports, migrations, services, repositories, Artisan commands, API serialization, or Laravel Blade / Livewire screens with little or no JS involvement. |
| `php,js` | Vue/JavaScript frontends, CMS components, layouts, frontend display logic, or tickets that may cross frontend → API → backend boundaries.                                              |

**Examples**

* SQS listener + queue job + model status update → `php`
* XML/CSV import pipeline → `php`
* API response field added in a Laravel Resource → `php`
* Blade-only admin screen → `php`
* Livewire page with no meaningful JS graph involvement → `php`
* Hero layout change in Vue → `php,js`
* Slide preset dropdown → `php,js`
* CMS module option component → `php,js`
* Frontend display rule calling an API → `php,js`
* Nuxt monorepo ticket (composables, `$fetch`, packages) → `php,js` — see package [support.md](../../docs/support.md#nuxt-beta)

**Rule of thumb**

Use `php,js` when the ticket references:

* `.vue` files
* Vue components
* composables
* frontend display behavior
* client-side filtering
* frontend API calls

Use `php` when the ticket references only:

* PHP classes
* controllers
* routes
* jobs/listeners
* migrations
* Blade views
* Livewire components
* API resources/serializers
* Laravel Resources
* Eloquent models

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
5. **Ticket entities and acceptance criteria** — the ticket remains the source of truth

If the graph and the ticket disagree, trust the ticket first.
The graph is a navigation aid, not the specification.

Ignore flow paths that do not match ticket entities (unrelated controllers/endpoints). Prefer names from the ticket (hero, preset, slide, etc.).

If **implementation confidence < 0.35**, treat matches as navigation hints only.

## Step 4 — Follow-up commands (use before manual repo search)

Once the briefing gives you a **concrete symbol** (class, method, Vue component id from read-first), use ImpactLens again instead of grepping the monorepo or guessing blast radius.

Symbol ids come from the briefing backticks, e.g.:

- PHP: `SpOTTBackend\\Jobs\\Content\\ProcessExpiredVodObjectJob::handle`
- Vue/JS: `js:apps/.../heroTeaser/index.vue::HeroTeaser`
- API: `api:GET:/slide-presets`

### `ai-context` — understand one symbol (default follow-up)

**When:** You know *where* to look but need callers, callees, dependencies, inheritance, risk — in one compact report.

**Use instead of:** Opening dozens of files, manual call-chain tracing, guessing what breaks.

```bash
impactlens ai-context sqlite/Graph.sqlite "<ClassOrMethodOrNodeId>" --compact
```

Add `--depth=3` if the chain is deep. Prefer `--compact` for chat context.

### `change-impact` — blast radius before editing

**When:** You plan to change a specific method or class and need *who calls it* / upstream impact.

**Use instead of:** Manual “find references” across the repo.

```bash
impactlens change-impact sqlite/Graph.sqlite "<ClassOrMethodId>" --depth=2 --limit=10
```

Read **Affected callers** first; then **What this method uses** for downstream deps.

### `impact` — deeper impact + inheritance

**When:** `change-impact` is not enough — you need inheritance-aware resolution, richer caller/callee lists, or a full written report.

**Use instead of:** Chasing parent classes and overrides by hand.

```bash
impactlens impact sqlite/Graph.sqlite "<Class::method>" --limit=20
```

Heavier output; use when refactoring a core method.

### Other commands (situational)

| Command | Use when | Skip when |
|---------|----------|-----------|
| `impactlens architecture --architecture-config=…` | Checking layer violations (controller→service→repo) | Normal ticket implementation |
| `impactlens risk` | Repo-wide “what is risky to touch” prioritization | You already have a ticket-specific target |
| `impactlens hotspots` | Finding highly connected nodes with no ticket | Ticket briefing already named the entrypoint |
| `impactlens cycles` / `impactlens dead-code` | Cleanup/refactor tasks | Feature tickets |

### Suggested agent sequence

```text
1. Read ticket → infer --answers
2. impactlens ticket → briefing → open read-first files (max 3–5)
3. Pick one symbol from briefing
4. impactlens ai-context --compact   (understand local graph)
5. impactlens change-impact          (only if you will edit that symbol)
6. Implement — do not re-derive steps 4–5 by blind grep if graph has the node
```

## Do not

- Use `unsure` (or omit `--answers`) when the ticket text is readable — **infer the closest intent yourself**
- Paste `Graph.json` or `--full` ticket output into chat (token waste)
- Re-scan the monorepo on every ticket
- Treat unrelated `[complete]` flow paths as in-scope for the ticket
- Grep/trace callers manually when `ai-context` or `change-impact` can answer from the graph

## Known graph gaps (say honestly if relevant)

- Partial flow paths when Vue/Nuxt has no `HTTP_REQUEST` edge (missing path aliases, dynamic URL, or scan gap)
- Nuxt: Nitro `server/api/` routes not scanned; `$fetch`/`useFetch` need `api/v…` in source for static URL extraction
- Pug templates not parsed
- Graph excludes `vendor`, `node_modules`, `tests` by default
- Ticket ranking is heuristic; explicit `--answers` are preferred when ticket intent is clear

Human setup (scan, config): `impactlens scan …` · see package docs / quickstart
