# ImpactLens

Static code graph and navigation CLI for **PHP/Laravel**, **JavaScript/TypeScript**, **Vue**, and **Nuxt**.

ImpactLens answers navigation questions before you grep blindly:

- Where does this API route land in PHP?
- What does this controller call — including services and query layers?
- What breaks if I change this method?
- How does this frontend action reach the backend?

It does **not** replace reading code. It helps you find the right files faster — especially with AI agents.

> Read [`docs/support.md`](docs/support.md) first for scanner coverage, known limits, and maturity per language.

---

## Install

```bash
npm install impactlens
```

This installs the `impactlens` CLI and writes the agent skill to `.cursor/skills/impactlens/SKILL.md` (skip with `IMPACTLENS_SKIP_SKILL=1`).

```bash
npx impactlens --help
npx impactlens --commands
npx impactlens install-skill   # reinstall skill later
```

**Requirements:** Node.js 18+

---

## Quick start

### 1. Scan the repository

```bash
impactlens scan /path/to/repo --lang=both --output=sqlite --sqlite-path=sqlite/Graph.sqlite --no-merge
```

**Separate frontend and backend folders?** Pass multiple scan roots in one command — they merge into a single `Graph.sqlite`:

```bash
impactlens scan /path/to/backend /path/to/frontend --lang=both --output=sqlite --sqlite-path=sqlite/Graph.sqlite --no-merge
```

File paths in the graph are prefixed with each root folder name (e.g. `backend/app/...`, `frontend/src/...`).

Use `impactlens.config.json` at each scan root when the project uses path aliases (`@/`, etc.). See [`docs/config-setup.md`](docs/config-setup.md).

### 2. Find a route or symbol

```bash
# Ticket-style route (preferred for HTTP work)
impactlens find sqlite/Graph.sqlite "GET /api/v3/contents/{id}/multiview" --kind=route

# Path suffix also works
impactlens find sqlite/Graph.sqlite multiview --kind=route

# PHP class / method
impactlens find sqlite/Graph.sqlite RelatedContentController::index
```

Route tips:

- Graph paths usually **omit** the `/api/v3` prefix — `find` normalizes ticket URLs.
- Prefer `--kind=route` for HTTP paths; use `Class::method` when you already know the controller action.

### 3. Trace the flow

```bash
# From route endpoint
impactlens trace sqlite/Graph.sqlite "api:GET:contents/{param}/multiview" --depth=3

# From controller method
impactlens ai-context sqlite/Graph.sqlite "App\\Http\\Controllers\\FooController::index" --compact --depth=3 --limit=25
```

`trace` and `ai-context` walk **outgoing `CALLS` chains** with bounded depth:

| Option | Default | Purpose |
|--------|---------|---------|
| `--depth=N` | `2` | How many call hops to follow |
| `--limit=N` | `20` | Max callees in the chain |

Output is indented by depth. When results are cut off, you'll see:

```text
… truncated (--limit=20, increase --depth or --limit for more)
```

For deep Laravel stacks (controller → service → query), try `--depth=3` or `--depth=5`.

---

## Typical workflow (Laravel API ticket)

```bash
# 1. Route
impactlens find sqlite/Graph.sqlite "GET /api/v3/contents/{id}/related-contents" --kind=route

# 2. Context from the route id
impactlens ai-context sqlite/Graph.sqlite "api:GET:contents/{param}/related-contents" --compact --depth=3

# 3. Or trace for coverage-style output
impactlens trace sqlite/Graph.sqlite "api:GET:contents/{param}/related-contents" --depth=3
```

Expected chain: **route → controller → service → query methods** (when the scanner resolved them).

---

## Commands

| Command | Purpose |
|---------|---------|
| `scan` | Build `Graph.sqlite` / `Graph.json` |
| `find` | Search symbols, routes, fields (`--kind=route\|symbol\|field\|auto`) |
| `trace` | End-to-end flow + coverage for one symbol |
| `ai-context` | Compact report: callers, callees, navigation, risk |
| `change-impact` | Blast radius scoring |
| `impact` | Extended impact / dependency report |
| `architecture` | Layer rule violations |
| `cycles` | Circular dependencies |
| `hotspots` | Highly connected nodes |
| `risk` | Combined risk ranking |
| `dead-code` | Likely unreachable symbols |

Aliases like `analyze:find`, `analyze:trace`, … work the same way.

Full option reference: [`docs/commands.md`](docs/commands.md)

---

## What the graph contains

- PHP classes, methods, traits, interfaces
- Laravel routes (`ROUTES_TO` → controller methods)
- `CALLS`, `DEPENDS_ON`, field flow (`FLOWS_TO`, `ARGUMENT_TO`), Blade/Vue links
- JavaScript / TypeScript modules and Vue components
- Frontend → backend `HTTP_REQUEST` edges (when detectable)

Not covered: full DI container resolution, runtime `app()` bindings, every fluent chain edge. See [`docs/support.md`](docs/support.md).

---

## For AI agents (Cursor)

After `npm install impactlens`, use the generated skill in `.cursor/skills/impactlens/SKILL.md`.

Guidance for agents:

1. Start with `find --kind=route` when the ticket mentions an HTTP path.
2. Use `ai-context` or `trace` on the **route id** or resolved controller method.
3. Increase `--depth` when the chain stops at a service but the ticket mentions queries.
4. Verify graph results in source — the graph is a map, not proof of runtime behavior.

Bundled skill template: [`assets/agent-skill/SKILL.md`](assets/agent-skill/SKILL.md)

---

## Development

Clone and run from source:

```bash
git clone https://github.com/LucaDogaru1/ImpectLens.git
cd ImpectLens
npm install
node bin/impactlens.js --help
```

Useful tests:

```bash
npm run test:route-search
npm run test:symbol-search
npm run test:call-chain
npm run test:route-file-extractor
npm run test:navigation
npx tsx test/scanner/php/semantic/resolveExpressionType.test.ts
```

Benchmark validation notes (internal): `benchmark/ROUTE_SEARCH_VALIDATION.md`

---

## Documentation

| Doc | Content |
|-----|---------|
| [`docs/support.md`](docs/support.md) | Scanner limits — **read first** |
| [`docs/quickstart.md`](docs/quickstart.md) | Step-by-step setup |
| [`docs/commands.md`](docs/commands.md) | All CLI flags |
| [`docs/graph-model.md`](docs/graph-model.md) | Nodes and edge types |
| [`docs/config-setup.md`](docs/config-setup.md) | Path aliases & scan config |

---

## License

ISC · Luca Dogaru
