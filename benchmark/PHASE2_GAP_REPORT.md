# Phase 2 Gap Report — Cat3 & Multiview

**Graph:** `spott/Graph.sqlite` (benchmark monorepo scan)  
**Date:** 2026-07-31  
**Status:** Phase 2 fixes implemented and re-verified after re-scan  
**Goal:** Determine whether missing Controller → Service → Query navigation is a **scanner gap** (edges absent) or a **CLI gap** (edges present but not shown).

---

## Expected chains

| Ticket | Route | Controller | Service | Query (root cause) |
|--------|-------|------------|---------|-------------------|
| **Cat3** | `GET contents/{content}/related-contents` | `RelatedContentController::index` | `RelatedContent::getWithPaging` | `BaseConfigEventContentRelatedQuery::buildRelatedTo` / `applyRelatedContentCriteria` |
| **Multiview** | `GET contents/{content}/multiview` | `MultiviewController::__invoke` | `MultiviewService::generateFor` → `MultiviewContentGenerator::generate` | `LegacyMultiviewContentQuery::contentsFromDb` / `MetadataMultiviewContentQuery::contentsFromDb` |

---

## Implementation summary

| Step | Area | Change | Result |
|------|------|--------|--------|
| 1 | Route action mapping (scanner) | `routeFileExtractor.ts` + `scopedCallExpression.ts`: invokable → `__invoke`; apiResource GET → `index`; `->only('index')` parsing | ✅ ROUTES_TO hits real controller methods |
| 2 | CLI call depth | `callChainQueries.ts` + `trace` / `ai-context`: bounded BFS (`--depth`, `--limit`, cycle + dedupe guards) | ✅ Multi-hop CALLS visible without unlimited dump |
| 3 | Cat3 fluent query chain (scanner) | `resolveExpressionType.ts`: concrete type from `Subclass::for()` preserved through fluent chain; `Query::for` CALLS unchanged | ✅ `buildRelatedTo` / `applyRelatedContentCriteria` in graph + CLI |
| 4 | Multiview DI factory | Intentionally **not** extended — existing CALLS + CLI depth sufficient | ✅ `contentsFromDb` reachable via `--depth=5` |

---

## Cat3 — Related contents

### CLI after fixes

| Step | Command / target | Result |
|------|------------------|--------|
| Route find | `find … related-contents --kind=route` | ✅ `api:GET:contents/{param}/related-contents` |
| ai-context (route) | `api:GET:contents/{param}/related-contents --compact --depth=3` | ✅ resolves to `RelatedContentController::index`; route entry; `getWithPaging` → `buildRelatedTo`, `Query::for` |
| ai-context (service) | `RelatedContent::getWithPaging --compact --depth=3` | ✅ `buildRelatedTo`, `applyRelatedContentCriteria`, `applyStatusLiveFilter`, `Query::for` |
| Trace (route) | `trace … related-contents --depth=3` | ✅ route entry + multi-hop calls |

### Graph vs CLI (current)

| Relationship | In graph? | Shown by trace / ai-context? | Status |
|--------------|-----------|------------------------------|--------|
| Route → `RelatedContentController::index` | ✅ ROUTES_TO | ✅ route entry in navigation | **Fixed** (was phantom `::related-contents`) |
| `Controller::index` → `RelatedContent::getWithPaging` | ✅ CALLS | ✅ depth 1 | OK |
| `RelatedContentController` → `RelatedContent` | ✅ DEPENDS_ON | ❌ unless `--include-depends-on` | Open (display only) |
| `getWithPaging` → `Query::for` | ✅ CALLS (inherited static) | ✅ | OK — real call target, not replaced |
| `getWithPaging` → `buildRelatedTo` / `applyRelatedContentCriteria` | ✅ CALLS | ✅ from `--depth=2` | **Fixed** (fluent chain) |
| Query class reachable from route | ✅ | ✅ with `--depth≥2` | **Fixed** |

**Source pattern (unchanged):**

```php
BaseConfigEventContentRelatedQuery::for($request)
    ->applyStatusLiveFilter()
    ->buildRelatedTo($content, …)
    ->paginate(…);
```

**Design note:** `CALLS` still points to parent `Query::for` (semantically correct). Fluent resolution uses the **concrete query type** from `BaseConfigEventContentRelatedQuery::for()` to reach subclass methods — no fake `Subclass::for` edge.

### Cat3 — remaining open items

- Route find ranking: `RelatedContentController` vs generic `Controller` (not blocking)
- DEPENDS_ON collaborators hidden by default in ai-context (`--include-depends-on` still required)

---

## Multiview — country-restricted content

### CLI after fixes

| Step | Command / target | Result |
|------|------------------|--------|
| Route find | `find … multiview --kind=route` | ✅ `api:GET:contents/{param}/multiview` |
| ai-context (route) | `api:GET:contents/{param}/multiview --compact --depth=4` | ✅ resolves to `MultiviewController::__invoke`; route entry; chain through `MultiviewService::generateFor` → `MultiviewContentGenerator::generate` → `MultiviewQuery::handle` → `contentsFromCache` |
| ai-context (route, depth 5) | same with `--depth=5` | ✅ `LegacyMultiviewContentQuery::contentsFromDb` |
| Trace (route) | `trace … multiview --depth=4` | ✅ multi-hop outgoing calls with indentation |

### Graph vs CLI (current)

| Relationship | In graph? | Shown by trace / ai-context? | Status |
|--------------|-----------|------------------------------|--------|
| Route → `MultiviewController::__invoke` | ✅ ROUTES_TO | ✅ route entry | **Fixed** (was phantom `::multiview`) |
| `__invoke` → `MultiviewService::generateFor` | ✅ CALLS | ✅ depth 1 | OK |
| `MultiviewService::generateFor` → `MultiviewContentGenerator::generate` | ✅ CALLS | ✅ depth 2 | OK |
| `Generator::generate` → `MultiviewQuery::handle` | ✅ CALLS | ✅ depth 3 | OK |
| `MultiviewQuery::handle` → `contentsFromCache` → `contentsFromDb` | ✅ CALLS | ✅ depth 4–5 | **Fixed** (was CLI 1-hop only) |
| `MultiviewQueryFactory::create` → concrete query instances | ❌ no CALLS/INSTANTIATES | ❌ | Open (optional DI return) |
| Factory DEPENDS_ON to query classes | ✅ DEPENDS_ON | ❌ unless `--include-depends-on` on factory | Open (display only) |

**Source pattern (unchanged):**

```php
$this->query->create()->handle($dto)…
```

Factory `create()` returns pre-injected query — no `new`, no CALLS edge to implementations. Not extended in this batch; depth traversal reaches `contentsFromDb` via existing `handle` → `contentsFromCache` → `contentsFromDb` chain.

### Multiview — remaining open items

- DI factory return resolution (`MultiviewQueryFactory::create` → concrete query) — deferred
- DEPENDS_ON collaborators in default ai-context — deferred

---

## Cross-cutting findings (updated)

| Issue | Type | Status |
|-------|------|--------|
| ROUTES_TO phantom method names (`::multiview`, `::related-contents`) | Scanner | ✅ **Fixed** |
| Trace / ai-context only 1-hop outgoing CALLS | CLI | ✅ **Fixed** (`--depth`, default 2) |
| Fluent `->buildRelatedTo()` not in graph | Scanner | ✅ **Fixed** |
| Static `Subclass::for()` → parent `Query::for` only | Scanner | ✅ **By design** — CALLS stays on `Query::for`; concrete type used for fluent resolution |
| DEPENDS_ON hidden in default ai-context | CLI | ⏸ Open |
| DI factory `create()` return not linked to impl | Scanner (optional) | ⏸ Deferred |
| Route find ranking | CLI | ⏸ Open |

---

## Verification commands

Re-scan after scanner changes:

```bash
node bin/impactlens.js scan /path/to/spott-monorepo \
  --lang=both --output=sqlite --sqlite-path=spott/Graph.sqlite --no-merge
```

Cat3 spot-check:

```bash
node bin/impactlens.js ai-context spott/Graph.sqlite \
  "api:GET:contents/{param}/related-contents" --compact --depth=3

node bin/impactlens.js trace spott/Graph.sqlite \
  "api:GET:contents/{param}/related-contents" --depth=3
```

Multiview spot-check:

```bash
node bin/impactlens.js ai-context spott/Graph.sqlite \
  "api:GET:contents/{param}/multiview" --compact --depth=5

node bin/impactlens.js trace spott/Graph.sqlite \
  "api:GET:contents/{param}/multiview" --depth=5
```

Unit tests:

```bash
npm run test:route-file-extractor
npm run test:call-chain
npx tsx test/scanner/php/semantic/resolveExpressionType.test.ts
```

---

## What we explicitly do not fix in this batch

- Route find ranking (`RelatedContentController` vs generic `Controller`)
- Full Laravel container / `app()` resolution
- DI factory return resolution (`MultiviewQueryFactory::create`)
- Transitive DEPENDS_ON in linear trace (unused injected deps)
- DEPENDS_ON as default collaborators in ai-context
- grep elimination as a metric

`new SomeQuery()` / **INSTANTIATES**: not used in either ticket path — Cat3 uses static `::for`, Multiview uses constructor-injected queries.
