---
name: impactlens
description: >-
  Complement ticket reasoning with the code graph: ai-context, change-impact,
  and impact for callers, callees, dependencies, and blast radius. Run
  analyze:ticket only when the ticket has enough technical anchors for graph
  navigation. Graph.sqlite, UI→API flows.
---

# ImpactLens

ImpactLens is a **code graph navigation tool**. It complements your own ticket reading and repository search — it does not replace them.

* **You** understand the ticket and often find the first code anchor.
* **ImpactLens** supplies repository knowledge you cannot infer from the ticket alone: callers, callees, dependencies, workflow connections, blast radius, architectural context.
* **Repository code** is always the source of truth.

Never treat any ImpactLens output as authoritative. Verify everything in code before implementing.

---

# When to use what

| Situation | Use |
|-----------|-----|
| You already know a class, method, endpoint, route, or file | `ai-context`, `change-impact`, `impact` — skip `analyze:ticket` |
| Ticket has technical anchors (endpoints, field paths, symbols, routes, namespaces) and you want graph-ranked entrypoints | `analyze:ticket` (optional), then graph commands from the briefing |
| Ticket is vague natural language only | Do **not** run `analyze:ticket`; search the repo yourself, then use graph commands once you have a symbol |
| You need blast radius or dependency context around a known symbol | `change-impact`, `impact`, `ai-context` |

**Primary value:** the graph (`ai-context`, `change-impact`, `impact`), not mandatory ticket analysis.

---

# Workflow

## 1. Read and understand the ticket

Read the ticket (user message, issue, or file). Decide:

* What workflow is involved (UI, API, queue, import, etc.)
* Whether the ticket contains **enough technical context** for graph-based navigation to be meaningful

**Sufficient context examples:** API endpoints · request/response fields · dotted field paths · PascalCase/camelCase symbols · routes · namespaces · file paths · concrete feature names tied to code · technical acceptance criteria

**Insufficient context examples:** vague complaints (“page is slow”, “hero looks wrong”) with no symbols, routes, or field names — graph ticket analysis will return low-information results; use normal repo search instead.

If you already identified a likely class, method, endpoint, or file through reasoning or search, **skip `analyze:ticket`** and go straight to step 3.

---

## 2. Analyze the ticket (optional)

Run `analyze:ticket` **only when** the ticket has technical anchors that make graph ranking worthwhile.

Pass ticket text inline (not only a file path):

```bash
impactlens ticket sqlite/Graph.sqlite \
  --ticket="GET /api/v1/slide-presets — add slidePreset filter to HeroTeaser CMS cell" \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui \
  --non-interactive
```

**`ticket_topic`:** `ui` · `queue` · `api` · `import` · `cron` · `migration` · `background` · `mixed`

**`change_includes`:** `cms_ui` · `queue_job` · `api_field` · `persistence` · `backend_logic` · `import_pipeline` · `infra_new` · `mixed`

**`scopes`:** `php` (backend only) · `php,js` (Vue/Nuxt/CMS UI or UI→API flows)

File paths work when a ticket file exists: `--ticket=tickets/example.txt`

Use `--boost` or `--suppress` if important symbols are buried by unrelated matches.

If the briefing reports no reliable technical anchors or zero confidence, **do not trust its file list** — continue with repository search, then use graph commands on symbols you verify.

Read the briefing (when used) in this order: Read first → Flow paths → Warnings. Treat all suggestions as hypotheses.

---

## 3. Investigate with the graph

Once you have a symbol (from your own search or from an optional briefing):

```bash
impactlens ai-context sqlite/Graph.sqlite "<symbol>" --compact
impactlens change-impact sqlite/Graph.sqlite "<symbol>"
impactlens impact sqlite/Graph.sqlite "<symbol>"
```

**Symbol id examples:** `SpOTTBackend\Services\Foo::bar` (PHP) · `js:apps/.../heroTeaser/index.vue::HeroTeaser` (Vue) · `api:GET:/slide-presets` (route)

Use these to understand callers, callees, dependencies, and blast radius before changing code.

---

## 4. Implement

Implement only after verifying the relevant code in the repository.

If the graph is incomplete or misleading, continue with normal investigation — ImpactLens is a navigation aid, not a decision engine.

---

## 5. Feedback (optional)

When you ran `analyze:ticket` and can judge usefulness, append one JSON line to `.ai/impactlens/impactlens-feedback.jsonl`. Once per ticket.

```json
{
  "timestamp": "2026-06-22T12:00:00Z",
  "ticket": "inline",
  "summary": "Hero teaser layout configuration",
  "ticket_topic": "ui",
  "change_includes": "cms_ui",
  "scopes": "php,js",
  "helpful": true,
  "reason": "helpful",
  "readFirst": ["js:apps/.../heroTeaser/index.vue::HeroTeaser"],
  "actual": ["js:apps/.../heroTeaser/index.vue::HeroTeaser"]
}
```

Failure reasons: `wrong-workflow` · `wrong-files` · `missing-files` · `wrong-flow-path` · `no-useful-results` · `skipped-ticket-analysis`

---

## Rules

* **Do not** run `analyze:ticket` for every task — use it only when technical anchors make graph navigation meaningful.
* Prefer `ai-context` / `change-impact` / `impact` when you already have a symbol.
* If you run `analyze:ticket`, pass explicit `--answers` with `--non-interactive`.
* Prefer inline `--ticket="…"` with the ticket text the user gave you.
* Never treat briefing output or graph output as source of truth — verify in code.
* Record feedback when ticket analysis was used and can be meaningfully evaluated.
