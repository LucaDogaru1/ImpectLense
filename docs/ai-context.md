# AI Context

`analyze:ai-context` is the primary **graph navigation** report for one symbol (class, method, route, field).

It complements repository search: use `find` to resolve a fuzzy symbol, then `ai-context` for callers, routes, field flow, impact, and coverage warnings.

## What it includes

- target metadata and location
- callers and callees (concrete implementations preferred over interfaces)
- **graph navigation**: routes, request/field intake, field flow, validation, persistence, config refs
- **coverage warnings** when the graph is incomplete for this symbol
- dependencies and inheritance
- architecture issues and cycles (scoped to the target)
- change impact summary and suggested review scope

## Commands

```bash
# 1. Find a graph id
npm run analyze:find -- laola.sqlite PaymentController
npm run analyze:find -- laola.sqlite "POST /payments" --kind=route

# 2. Navigate from the symbol
npm run analyze:ai-context -- laola.sqlite "App\\Http\\Controllers\\PaymentController::pay" --compact
```

## Positioning

- **`find`** — resolve symbols, routes, and fields to graph ids
- **`ai-context`** — primary navigation + context report for AI paste
- **`analyze:ticket`** — optional, only when the ticket has enough technical anchors for graph ranking

Typical flow:

```text
Read ticket → repo search OR find → ai-context → change-impact / impact if needed
```
