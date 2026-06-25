# ImpactLens

⚠️ Before using ImpactLens, read:

`docs/support.md`

It explains what PHP, JavaScript, Vue and Nuxt support actually covers, known limitations, and the maturity of each scanner.

---

## What is ImpactLens?

ImpactLens builds a queryable code graph that helps developers and AI agents navigate large codebases.

Instead of searching blindly, you can ask questions like:

* Where is this method used?
* What calls this endpoint?
* What breaks if I change this class?
* Which files depend on this component?
* How does this UI action reach the backend?

**ImpactLens doesn't replace reading code—it makes finding the right code much faster.**

---

## Install

```bash
npm install impactlens
```

On install, the agent skill is written to `.ai/impactlens/skill.md`.

Skip with:

```bash
IMPACTLENS_SKIP_SKILL=1
```

Reinstall later:

```bash
npx impactlens install-skill
```

Available commands:

```bash
npx impactlens --commands
npx impactlens --help
```

---

# Quick Start

Build the graph:

```bash
impactlens scan /path/to/repository --lang=both
```

Investigate a symbol:

```bash
impactlens ai-context sqlite/Graph.sqlite "<symbol>"
impactlens change-impact sqlite/Graph.sqlite "<symbol>"
impactlens impact sqlite/Graph.sqlite "<symbol>"
```

Optionally generate a ticket briefing:

```bash
impactlens ticket sqlite/Graph.sqlite \
  --ticket=tickets/issue.txt \
  --scopes=php,js
```

Use ticket analysis only when the ticket already contains enough technical information (API names, endpoints, field names, symbols, routes, etc.). Otherwise, locate the first code symbol yourself and continue with the graph commands.

---

# Main Commands

| Command         | Purpose                                       |
| --------------- | --------------------------------------------- |
| `scan`          | Build the code graph                          |
| `ai-context`    | Show callers, callees and surrounding context |
| `change-impact` | Analyze blast radius                          |
| `impact`        | Extended dependency analysis                  |
| `ticket`        | Optional ticket → graph briefing              |
| `architecture`  | Layer validation                              |
| `cycles`        | Detect dependency cycles                      |

---

# What the graph contains

* PHP classes and methods
* JavaScript / TypeScript modules
* Vue components
* Routes and endpoints
* Imports and function calls
* Frontend → backend HTTP relationships (when detectable)

---

# Documentation

* `docs/support.md` ← Read first
* `docs/quickstart.md`
* `docs/config-setup.md`
* `docs/commands.md`
* `docs/graph-model.md`
* `assets/agent-skill/SKILL.md`

---

# License

ISC
