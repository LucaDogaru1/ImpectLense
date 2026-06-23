# Language support

ImpactLens is built around **one graph model** and **one scanner per language**. Ticket analysis and the CLI analyzers work on whatever lands in `Graph.sqlite` — but scan quality depends heavily on how mature each language pipeline is.

## Supported today

| Language | CLI flag | File types | Status | Scanner |
|----------|----------|------------|--------|---------|
| **PHP** | `--lang=php` | `.php` | **Primary** — hand-maintained, battle-tested on real Laravel codebases | [`src/scanner/php/`](../src/scanner/php/) |
| **JavaScript** | `--lang=js` | `.js`, `.mjs`, `.cjs`, `.ts` | **Beta** — works for imports, calls, and many HTTP client patterns | [`src/scanner/js/`](../src/scanner/js/) |
| **Vue** | `--lang=js` | `.vue` | **Beta** — SFC script blocks, partial `<script setup>`, template refs where parsed | [`src/scanner/js/vue/`](../src/scanner/js/vue/) |
| **Nuxt** | `--lang=js` | `.ts`, `.vue`, composables | **Beta** — monorepo scans with package aliases; see [Nuxt](#nuxt-beta) below | [`src/scanner/js/nuxt/`](../src/scanner/js/nuxt/), [`src/scanner/js/ts/`](../src/scanner/js/ts/) |

Use `--lang=both` to scan PHP and JS/Vue/Nuxt in one run (typical for Laravel + Vue monorepos).

**Cross-language linking** (UI → HTTP → controller) is supported when:

- PHP route nodes exist in the graph, and
- JS resolves imports (often needs `impactlens.config.json` for `@/` aliases), and
- HTTP calls match known patterns (`fetch`, `$fetch`, `useFetch`, registry-based API clients, etc.)

See [config-setup.md](config-setup.md) for copy-paste examples, or [scan-config.md](scan-config.md) for the full reference.

## What each pipeline captures well

### PHP (primary)

- Classes, interfaces, methods, properties
- Laravel-style routes and controller entrypoints
- Call, extends, implements, and dependency edges
- Jobs, listeners, commands as workflow entrypoints
- Field / validation / config references (for ticket matching)

Tuned for **Laravel**-shaped backends. Other PHP frameworks may scan, but route and role detection are Laravel-oriented.

### JavaScript / Vue (beta)

- ES modules, imports, exports, function and class declarations
- Vue single-file components (Options API and partial Composition / `<script setup>`)
- `.ts` files and Vue `<script lang="ts">` via **tree-sitter-typescript** (strip + JS parser is fallback only)
- Global `fetch()`, Nuxt `$fetch` / `useFetch`, and registry-style HTTP helpers when patterns are recognized
- Cross-language `HTTP_REQUEST` edges to PHP routes when resolvable

### Nuxt (beta)

Nuxt monorepos are supported under `--lang=js` (same flag as JS/Vue). Tested on real Nuxt 3 layouts with `packages/` and `apps/` structure.

**Works well today**

- TypeScript composables and `.vue` SFCs (`<script setup lang="ts">`)
- Package-scoped import aliases (`@core/`, `@content/`, etc.) via `impactlens.config.json` — see [config-setup.md](config-setup.md)
- `$fetch` / `useFetch` when the URL contains an `api/v…` path (string literals, template literals, or `computed(() => \`…\`)` via `unref(url)` / `url.value`)
- Import and call graph across packages

**Known gaps**

- Pug templates
- Nitro `server/api/` routes (server-side handlers not scanned as routes)
- `lang="tsx"` in Vue SFCs (falls back to strip + JS parser)
- Fully dynamic URLs with no `api/v…` segment in source
- Cross-language linking still needs a PHP scan of the backend and matching route paths in the graph

## Not supported yet

There is no scanner for **Python, Go, Ruby, Java, C#**, or other languages today. The graph model is language-agnostic — adding a language means a new tree-sitter pipeline under `src/scanner/<lang>/`, not rewriting the analyzers.

If you want to contribute a new language, start with: file discovery → AST walk → nodes/edges that match [graph-model.md](graph-model.md).

## About `src/scanner/js`

The **PHP scanner was written and refined manually** over a long period — it reflects real debugging on production codebases and is the reference implementation for how deep a language pipeline should go.

The **JavaScript / Vue / Nuxt scanner under `src/scanner/js/` is mostly AI-generated**. It exists so full-stack tickets (UI → API → backend) are possible without waiting for a second multi-month manual pass. It is useful today, but expect rough edges, uneven coverage, and more false gaps in briefings than on the PHP side.

Adding languages one at a time, alone, does not scale. The JS folder is a deliberate trade-off: **ship cross-language value sooner**, then harden or replace pieces as real projects expose gaps.

Contributions that improve JS/Vue linking, add tests against your repo, or start a new language scanner are very welcome — see the gaps above as a roadmap, not a verdict on the idea.
