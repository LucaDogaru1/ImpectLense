# AI Context

`analyze:ai-context` is the core AI feature in ImpactLens.

It builds focused context for one class or method so you can paste concise, high-signal information into ChatGPT, Claude, Copilot, Cursor, or similar tools.

## What it includes

- target metadata and location
- callers and callees
- dependencies and inheritance
- architecture issues
- cycles
- change impact summary
- risk rank and percentile context
- suggested review scope

## Command

```bash
npm run analyze:ai-context -- sqlite/Graph.sqlite "App\\Services\\UserService::create" --compact
```

## Positioning

- `analyze:ticket` is the AI navigation entrypoint.
- `analyze:ai-context` is the deep context generator for selected components.

Typical flow:

```text
Ticket -> analyze:ticket -> pick top component -> analyze:ai-context -> paste into AI
```

