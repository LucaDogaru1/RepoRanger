# AI Context

`ai-context` is the **full graph navigation report** for one symbol (class, method, route, field).

Use it after `find` (and optionally `trace`) for callers, routes, field flow, impact, architecture, and coverage warnings.

## What it includes

- target metadata and location (`resolves to` when starting from a route)
- upstream consumers (routes, blade, call-chain) and callees
- **graph navigation**: routes, request/field intake, field flow, validation, persistence, config refs
- **coverage warnings** when the graph is incomplete for this symbol
- dependencies and inheritance
- architecture issues and cycles (scoped to the target)
- change impact summary and suggested review scope

## Commands

```bash
# 1. Find a graph id
repo-ranger find sqlite/Graph.sqlite PaymentController
repo-ranger find sqlite/Graph.sqlite "POST /payments" --kind=route

# 2. Optional: end-to-end flow (compact story)
repo-ranger trace sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay"

# 3. Full context for AI paste
repo-ranger ai-context sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay" --compact
```

## Positioning

- **`find`** — resolve symbols, routes, and fields to graph ids
- **`trace`** — end-to-end flow + coverage (shorter than ai-context)
- **`ai-context`** — full navigation + blast-radius summary for AI paste
- **`change-impact` / `impact`** — deeper dependency / impact detail

Typical flow:

```text
Read task → repo search OR find → trace → ai-context → change-impact / impact if needed
```

See also: [trace.md](trace.md)
