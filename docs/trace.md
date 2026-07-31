# Trace

`trace` is a **compact end-to-end flow report** for one symbol (class, method, route, or fuzzy name).

Use it after `find` when you want a single readable story: route → controller → request fields → validation → service calls — plus honest **coverage** (what the graph has vs. what is missing).

## What it includes

- symbol resolution (exact graph id or `searchNodes` match)
- **Flow (best path)** — one chain, e.g. `POST api/payments → PaymentController::pay → fields → validates → calls`
- **Coverage** — complete / partial / missing (entry, intake, validation, calls, field flow, …)
- **Entry points** — `ROUTES_TO`, `BLADE_USES_ACTION`
- **Context** — upstream consumers, risk, impact score
- **Reads**, **Validation**, **Calls**, **Assignments**, **Other** (persist, config, warnings)
- routes resolve to controller methods (`resolves to: …`)

## Commands

```bash
repo-ranger trace sqlite/Graph.sqlite PaymentController::pay
repo-ranger trace sqlite/Graph.sqlite "POST /payments"
repo-ranger trace sqlite/Graph.sqlite "api:POST:api/payments"
repo-ranger trace sqlite/Graph.sqlite PaymentController::pay --json
```

npm scripts:

```bash
npm run analyze:trace -- sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay"
```

## Options

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max rows per section |
| `--include-interface-resolved` | off | Include `INTERFACE_RESOLVED` call edges |
| `--json` | off | Structured `TraceResult` payload |
| `--output=path` | — | Write plain-text (or JSON) to file |

## Positioning

| Command | When |
|---|---|
| **`find`** | Resolve fuzzy text → graph id |
| **`trace`** | Quick flow story + coverage gaps |
| **`ai-context`** | Full navigation + architecture + cycles + risk ranking |
| **`change-impact` / `impact`** | Blast radius detail |

Typical flow:

```text
Read ticket → find → trace → ai-context --compact → change-impact / impact if needed
```

## vs `ai-context`

- **`trace`** — shorter, path-oriented, good first paste for API/controller tickets
- **`ai-context`** — everything around the symbol (inheritance, architecture, cycles, purpose guess)

The trace output ends with a hint to run `ai-context` on the analysis node for deeper context.
