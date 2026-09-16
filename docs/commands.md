# Commands

This page contains detailed command usage for RepoRanger.

## Scan

Purpose: parse PHP and/or JavaScript/Vue files and build the graph database.

```bash
npm run scan -- <project-root> [more-roots...] [options]
```

Examples:

```bash
npm run scan -- phptest/mini --lang=php --output=sqlite --sqlite-path=Graph.mini.sqlite
npm run scan -- /path/to/monorepo --lang=both --no-merge --output=both
npm run scan -- /path/to/backend /path/to/frontend --lang=both --no-merge --output=both --sqlite-path=sqlite/Graph.sqlite
npm run scan -- jsproject --lang=js --no-merge --output=json
```

Multiple scan roots: pass several project paths (sibling repos). File paths in the graph are prefixed with each root folder name (e.g. `backend/app/...`, `frontend/src/...`). Place `repo-ranger.config.json` in **each** root that uses path aliases.

Options:

| Option | Default | Description |
|---|---|---|
| `--lang=php\|js\|both` | `both` | Languages to scan |
| `--output=json\|sqlite\|both` | `json` | Output format |
| `--sqlite-path=<file>` | `sqlite/Graph.sqlite` | SQLite output path |
| `--graph-json=<file>` | `Graph.json` | JSON output path |
| `--no-merge` | off | Do not merge into existing `Graph.json` |

**Scan config:** place `repo-ranger.config.json` at the scan root for path aliases and HTTP resource patterns. See [Scan config](scan-config.md).

Output: graph in JSON, SQLite, or both — consumed by all analysis commands.

---

## Impact Report

Purpose: inspect one class or method and see callers, callees, dependencies, cycles, architecture warnings, and change-impact hints.

```bash
npm run analyze:impact -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create"
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService" --include-depends-on
npm run analyze:impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create" --json --output=impact.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max entries per section |
| `--include-depends-on` | off | Include constructor dependency edges |
| `--include-interface-resolved` | off | Include interface-resolved call edges |
| `--impact-depth=N` | `2` | Depth for embedded change-impact scoring |
| `--impact-limit=N` | `5` | Max rows in embedded change-impact lists |
| `--no-impact-score` | off | Disable embedded blast-radius section |
| `--verbose` | off | Show extra details (e.g., affected file list) |
| `--json` | off | Output as JSON |
| `--output=<file>` | `impact.txt` | Write report to file |

Output explanation:
- Shows a compact summary, relationships, dependencies, usage, and optional embedded change-impact.
- Reports unresolved calls and inherited call resolutions when applicable.

JSON output example:

```json
{
  "target": { "id": "UserService::create", "type": "method" },
  "stats": {
    "incomingCalls": 1,
    "outgoingCalls": 3,
    "dependsOnOutgoing": 0,
    "dependsOnIncoming": 0,
    "cycles": 0,
    "archViolations": 0
  },
  "usages": [],
  "dependencies": [],
  "topNeighbors": [],
  "changeImpact": {
    "risk": "MEDIUM",
    "score": 14
  }
}
```

---

## Cycle Detection

Purpose: detect circular call/dependency paths.

```bash
npm run analyze:cycles -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:cycles -- Graph.mini.sqlite
npm run analyze:cycles -- Graph.mini.sqlite --include-depends-on
npm run analyze:cycles -- Graph.mini.sqlite --json --output=cycles.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max cycles shown |
| `--include-depends-on` | off | Include `DEPENDS_ON` edges |
| `--include-interface-resolved` | off | Include `INTERFACE_RESOLVED` calls |
| `--fail-on-cycles` | off | Exit code `1` if any cycles are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Lists cycle paths, edge types, and files involved.

JSON output example:

```json
{
  "totalEdges": 9,
  "cycleCount": 1,
  "includeDependsOn": false,
  "includeInterfaceResolved": false,
  "cycles": [
    {
      "nodes": ["A::x", "B::y", "A::x"],
      "length": 2,
      "files": ["A.php", "B.php"],
      "edgeTypes": ["CALLS", "CALLS"]
    }
  ]
}
```

---

## Dead Code Detection

Purpose: find public methods with no detectable incoming usage.

```bash
npm run analyze:dead-code -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:dead-code -- Graph.mini.sqlite
npm run analyze:dead-code -- Graph.mini.sqlite --debug="MiniProject\Application\Services\UserService::sendWelcome"
npm run analyze:dead-code -- Graph.mini.sqlite --json --output=dead-code.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max methods shown |
| `--debug="Class::method"` | — | Show detailed scoring breakdown for a method |
| `--include-interface-resolved` | off | Count interface-resolved calls as usage |
| `--include-depends-on` | off | Accepted, no scoring effect |
| `--no-ignore-constructors` | off | Include constructors |
| `--no-ignore-controller-actions` | off | Include controller action methods |
| `--no-ignore-magic-methods` | off | Include magic methods |
| `--no-ignore-tests` | off | Include methods in test files |
| `--no-ignore-interface-methods` | off | Include interface method declarations |
| `--fail-on-dead-code` | off | Exit code `1` if dead methods are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Shows dead methods and optional debug reasons for why a method is considered unused.

JSON output example:

```json
{
  "scannedMethods": 16,
  "deadMethods": 4,
  "items": [
    {
      "id": "UserService::unusedMethod",
      "name": "unusedMethod",
      "incomingCalls": 0
    }
  ]
}
```

---

## Architecture Analysis

Purpose: detect dependency direction violations across layers.

```bash
npm run analyze:architecture -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:architecture -- Graph.mini.sqlite
npm run analyze:architecture -- Graph.mini.sqlite --include-depends-on
npm run analyze:architecture -- Graph.sqlite --include-depends-on --ignore-likely-false-positives
npm run analyze:architecture -- Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives
npm run analyze:architecture -- Graph.mini.sqlite --json --output=arch.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max violations shown |
| `--include-depends-on` | off | Check `DEPENDS_ON` edges too |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--ignore-likely-false-positives` | off | Exclude framework HTTP false positives from active results and fail checks |
| `--architecture-config=<file>` | — | JSON rules: `architecture.ignorePatterns` / `architecture.allow` (e.g. `config/architecture_scan/spott.json`) |
| `--fail-on-violations` | off | Exit code `1` if violations are found |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Reports source and target layer, severity, reason, expected flow, and detected flow.
- Marks likely Laravel/framework HTTP namespace false positives (`Illuminate\\Http`, `Psr\\Http`, `Symfony\\Component\\HttpFoundation`, etc.).
- Treats `*Repository::* -> *::query` as a likely ORM/persistence access pattern when configured or detected heuristically.
- Summary separates `violations (total)` from `actionable violations`.
- With `--ignore-likely-false-positives`, fail checks and shown rows are based on active violations only.
- With `--architecture-config`, you can add project-specific allow/ignore patterns without touching code.
- The SpOTT project config keeps real service-level issues such as `TargetService -> PropertyLicenseService`, `ModuleService -> ModuleRequest`, and `ImporterService -> StoreContentRequestParser` visible.

JSON output example:

```json
{
  "inspectedEdges": 12,
  "violationCount": 1,
  "likelyFalsePositiveCount": 0,
  "actionableViolationCount": 1,
  "architectureConfigPath": "repo-ranger.config.example.json",
  "violations": [
    {
      "fromId": "UserRepository::badMethod",
      "toId": "UserController::show",
      "severity": "HIGH",
      "reason": "Repositories should not call Controllers.",
      "expected": "Controller -> Service -> Repository",
      "detected": "Repository -> Controller"
    }
  ]
}
```

---

## Hotspot Analysis

Purpose: rank heavily connected nodes that are likely to be change-risk hotspots.

```bash
npm run analyze:hotspots -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:hotspots -- Graph.mini.sqlite
npm run analyze:hotspots -- Graph.mini.sqlite --include-depends-on
npm run analyze:hotspots -- Graph.mini.sqlite --json --output=hotspots.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max entries per section |
| `--include-depends-on` | off | Include dependency edges in scoring |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Shows method hotspots, class hotspots, dependency hotspots, and fan-out hotspots.

JSON output example:

```json
{
  "inspectedNodes": 23,
  "limit": 10,
  "methodHotspots": [],
  "classHotspots": [],
  "dependencyHotspots": [],
  "fanOutHotspots": []
}
```

---

## Change Impact Analysis

Purpose: estimate blast radius for a changed method or class.

```bash
npm run analyze:change-impact -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create"
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService" --include-depends-on
npm run analyze:change-impact -- Graph.mini.sqlite "MiniProject\Application\Services\UserService::create" --depth=3 --decay=0.5 --json --output=change-impact.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Traversal depth for transitive impact |
| `--limit=N` | `10` | Max impacted nodes shown |
| `--decay=N` | `0.6` | Weight decay per hop (`0.1` to `1.0`) |
| `--verbose` | off | Show affected file list and technical details |
| `--include-depends-on` | off | Include `DEPENDS_ON` links |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output as JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Highlights risk first, then score.
- Separates upstream impact (`Affected callers`) from downstream usage (`What this method/class uses`).

JSON output example:

```json
{
  "target": { "id": "UserService::create", "type": "method" },
  "changeImpact": {
    "risk": "MEDIUM",
    "score": 14,
    "affectedCallers": 2,
    "methodsUsedByTarget": 3,
    "affectedFiles": 4,
    "components": {
      "directCallers": 1,
      "indirectCallers": 1,
      "directCallees": 3,
      "dependencyLinks": 0,
      "inheritanceLinks": 0
    },
    "affectedCallersList": [],
    "usedByTargetList": []
  }
}
```

---

## Find

Purpose: search the graph for symbols, routes, and request fields by fuzzy text.

```bash
npm run analyze:find -- <db.sqlite> "<query>" [options]
repo-ranger find <db.sqlite> "<query>" [options]
```

Examples:

```bash
repo-ranger find sqlite/Graph.sqlite PaymentController
repo-ranger find sqlite/Graph.sqlite "POST /payments" --kind=route
repo-ranger find sqlite/Graph.sqlite providerCategory --kind=field
repo-ranger find sqlite/Graph.sqlite useModule --runtime=nuxt
repo-ranger find sqlite/Graph.sqlite Callout --workspace=spott-backend
```

Options:

| Option | Default | Description |
|---|---|---|
| `--kind=auto\|symbol\|route\|field\|config\|all` | `auto` | Restrict result types |
| `--runtime=nuxt\|legacy-vue\|vue\|shared\|backend\|unknown` | all | Restrict results to an inferred runtime |
| `--workspace=<name>` | all | Restrict results to a workspace path or its final name |
| `--no-dedupe` | off | Show every matching graph node instead of one logical result per file |
| `--limit=N` | `20` | Max results |

Non-route searches are deduplicated by file by default. Each result reports its
workspace, inferred runtime, confidence, grouped node count, and grouped node
types. Route searches remain endpoint-based and are not deduplicated by file.

Use the returned graph id with `trace`, `ai-context`, or `change-impact`.

---

## Feature

Purpose: group the most relevant files around a feature or domain phrase. The
result combines lexical matches, direct graph neighbors, workspace/runtime
classification, and deterministic structural similarity.

```bash
repo-ranger feature sqlite/Graph.sqlite "Page Manager" --runtime=legacy-vue
repo-ranger feature sqlite/Graph.sqlite "Callout Section" --runtime=nuxt --files=15
```

Options: `--runtime`, `--workspace`, `--files=N`, `--json`, and `--output=<file>`.

---

## Context

Purpose: turn a ticket-like phrase into a bounded navigation packet containing
prioritized files, likely workspaces, entry points, registries, tests, structural
neighbors, cross-stack links, and explicit coverage gaps.

```bash
repo-ranger context sqlite/Graph.sqlite "add Callout Section module" \
  --runtime=nuxt --max-tokens=2500
```

Options:

| Option | Default | Description |
|---|---|---|
| `--max-tokens=N` | `2500` | Approximate hard output budget (minimum 200) |
| `--runtime=...` | all | Restrict the inferred runtime |
| `--workspace=<name>` | all | Restrict the workspace |
| `--files=N` | `20` | Maximum prioritized files, capped at 20 |
| `--json` | off | Emit compact structured output |
| `--output=<file>` | — | Write the result to a file |

The token estimate uses a conservative four-characters-per-token approximation.
It is deterministic and requires no model or external API.

---

## Similar

Purpose: find structurally related implementations using graph shape, symbols,
path terms, roles, runtime, workspace, and direct graph connections.

```bash
repo-ranger similar sqlite/Graph.sqlite CalloutSection --runtime=nuxt --limit=10
```

This is local graph similarity, not embedding search. It is explainable and has
no network or token cost.

---

## Locate

Purpose: resolve one route, class, method, component, or field and return a
compact best-path flow, route middleware, and at most five prioritized source files. A recorded
Vue/Nuxt `HTTP_REQUEST` is followed into its Laravel route and backend calls.

```bash
npm run analyze:locate -- <db.sqlite> "<query>" [options]
repo-ranger locate <db.sqlite> "<query>" [options]
```

Examples:

```bash
repo-ranger locate sqlite/Graph.sqlite "GET /api/v3/contents/{id}/multiview" --kind=route
repo-ranger locate sqlite/Graph.sqlite "App\\Services\\PaymentService::process"
repo-ranger locate sqlite/Graph.sqlite userCountry --kind=field --json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--kind=auto\|symbol\|route\|field\|config\|all` | `auto` | Restrict match types |
| `--depth=N` | `3` | Outgoing call depth |
| `--limit=N` | `12` | Maximum traced calls |
| `--files=N` | `5` | Prioritized files, hard-capped at 5 |
| `--json` | off | Structured payload |
| `--output=<file>` | — | Write text or JSON to file |

Use this as the default navigation command when one concrete anchor is known.
Use `find` only for alternatives and `trace` only when the compact flow is not
enough.

---

## Trace

Purpose: compact end-to-end flow report for one symbol — route → controller → fields → validation → calls, plus coverage gaps.

```bash
npm run analyze:trace -- <db.sqlite> "<symbol>" [options]
repo-ranger trace <db.sqlite> "<symbol>" [options]
```

Examples:

```bash
repo-ranger trace sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay"
repo-ranger trace sqlite/Graph.sqlite "api:POST:api/payments"
repo-ranger trace sqlite/Graph.sqlite PaymentController::pay --json --output=trace.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--limit=N` | `20` | Max rows per section |
| `--include-interface-resolved` | off | Include interface-resolved call edges |
| `--json` | off | Structured `TraceResult` payload |
| `--output=<file>` | — | Write plain-text or JSON to file |

Details: [trace.md](trace.md)

---

## AI Context Report

Purpose: generate a compact AI-friendly context report by aggregating existing analyses.

```bash
npm run analyze:ai-context -- <db.sqlite> "<ClassOrMethodId>" [options]
```

Examples:

```bash
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create"
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --include-depends-on --depth=3
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --compact
npm run analyze:ai-context -- Graph.sqlite "App\Services\UserService::create" --json --output=ai-context.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Depth used by change-impact aggregation |
| `--limit=N` | `20` | Max rows per section |
| `--include-depends-on` | off | Include constructor dependencies |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--compact` | off | Render a denser Markdown report for AI prompt paste |
| `--json` | off | Output machine-readable JSON instead of Markdown |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Markdown by default for copy/paste into AI tools.
- `--compact` keeps the same information model with shorter Markdown sections.
- Summary includes risk ranking context (`risk rank`, `percentile`, candidate-pool scope, and graph population).
- Architecture notes mark likely framework HTTP false positives when applicable.
- Includes target metadata, summary, purpose guess, callers, calls, dependencies, inheritance, architecture notes, cycles, and suggested review scope.
- Built as an aggregation layer on top of existing analyses.
- Pair with `trace` for a quick flow overview, then `ai-context` for the full paste.

JSON output example:

```json
{
  "target": { "id": "App\\Services\\UserService::create", "type": "method", "location": "App/Services/UserService.php:10-30" },
  "summary": {
    "changeRisk": "MEDIUM",
    "impactScore": 14,
    "riskRank": 1,
    "riskPopulation": 17219,
    "riskPercentileTop": 0.01,
    "riskCandidatePool": 100,
    "affectedCallers": 2,
    "methodsUsedByTarget": 3,
    "affectedFiles": 4
  },
  "callers": [],
  "callees": [],
  "dependencies": [],
  "inheritance": [],
  "architecture": [],
  "cycles": [],
  "affectedFiles": []
}
```

---

## Risk Ranking

Purpose: combine hotspot traffic and change-impact blast radius into a single refactoring-priority list.

```bash
npm run analyze:risk -- <db.sqlite> [options]
```

Examples:

```bash
npm run analyze:risk -- Graph.sqlite
npm run analyze:risk -- Graph.sqlite --include-depends-on --depth=3 --limit=15
npm run analyze:risk -- Graph.sqlite --candidate-pool=200 --limit=15
npm run analyze:risk -- Graph.sqlite --json --output=risk.json
```

Options:

| Option | Default | Description |
|---|---|---|
| `--depth=N` | `2` | Depth for change-impact scoring per hotspot candidate |
| `--limit=N` | `10` | Max ranked components shown |
| `--candidate-pool=N` | `max(limit*20,100)` | Number of hotspot candidates to evaluate before ranking |
| `--include-depends-on` | off | Include constructor dependencies |
| `--include-interface-resolved` | off | Include interface-resolved calls |
| `--json` | off | Output machine-readable JSON |
| `--output=<file>` | — | Write report to file |

Output explanation:
- Produces `HIGH RISK COMPONENTS` ranked by risk tier and combined score.
- Text output shows ranking scope explicitly: `candidate pool: top N hotspot candidates` and `population: X nodes`.
- Includes `combined score`, `risk rank`, and `percentile` to avoid CRITICAL inflation.
- Helps prioritize where refactoring is most likely to reduce operational risk.

JSON output example:

```json
{
  "includeDependsOn": false,
  "includeInterfaceResolved": false,
  "depth": 2,
  "limit": 10,
  "candidatePool": 100,
  "population": 17219,
  "items": [
    {
      "id": "ContentRelationsService::updateOrCreate",
      "hotspotScore": 31,
      "impactScore": 87,
      "combinedScore": 292,
      "risk": "CRITICAL",
      "riskRank": 1,
      "percentileTop": 0.01
    }
  ]
}
```

---

## JSON tips with jq

```bash
# Print all cycle paths
npm run analyze:cycles -- Graph.sqlite --json | jq '.cycles[].nodes'

# Count dead methods
npm run analyze:dead-code -- Graph.sqlite --json | jq '.deadMethods'

# Show only HIGH severity violations
npm run analyze:architecture -- Graph.sqlite --json | jq '.violations[] | select(.severity == "HIGH")'

# Top 3 method hotspots
npm run analyze:hotspots -- Graph.sqlite --json | jq '.methodHotspots[:3]'

# Blast-radius risk and score
npm run analyze:change-impact -- Graph.sqlite "App\\Services\\UserService::create" --json | jq '.changeImpact | {risk, score, affectedCallers, methodsUsedByTarget}'
```

---

## Real codebase smoke tests

Use these as copy/paste examples against your existing graph file:

```bash
npm run smoke:real-db
npm run smoke:real-db:fast
npm run smoke:real-db:full
npm run analyze:architecture -- sqlite/Graph.sqlite --include-depends-on --ignore-likely-false-positives --fail-on-violations
npm run analyze:architecture -- sqlite/Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives --fail-on-violations
npm run analyze:risk -- sqlite/Graph.sqlite --candidate-pool=200 --limit=20 --output=risk.real.txt
npm run analyze:ai-context -- sqlite/Graph.sqlite "SpOTTBackend\\Services\\Content\\Search\\SearchService::buildParamsFromRequest" --compact --output=ai-context.real.md
```

`smoke:real-db` points to `smoke:real-db:fast` (quick release sanity check). Use `smoke:real-db:full` for slower, deeper checks including dead-code and change-impact commands.

---

## Known limitations

- Dynamic method calls through unresolved variables may be missed.
- Reflection-based dispatch (`ReflectionClass`, `call_user_func`) is not fully tracked.
- Runtime-generated/proxy classes are not analyzed.
- Framework entry points (routes/listeners/jobs/commands) may be partially detected.
- Trait resolution can be partial depending on inclusion context.
- Methods called only outside the scanned scope can appear as dead code.

---

## Roadmap

- SCC detection for tightly coupled clusters.
- Framework entry-point detection to reduce dead-code false positives.
- Laravel route analysis mapped to controller actions.
- Symfony container wiring analysis.
- Interactive graph visualization.
