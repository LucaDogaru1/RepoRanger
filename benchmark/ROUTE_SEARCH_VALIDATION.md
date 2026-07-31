# Route Search Validation — Cat3 & Multiview

**Graph:** `spott/Graph.sqlite`  
**Date:** 2026-07-31  
**Scope:** `impactlens find … --kind=route` (and auto-detect) against benchmark tickets and typical agent queries.

---

## Summary

| Category | Status |
|----------|--------|
| Path / ticket URL queries | ✅ Reliable |
| Path suffix only (`multiview`, `related-contents`) | ✅ Top hit correct |
| Canonical graph IDs (`api:GET:…`) | ✅ Exact match |
| HTTP verb mismatch handling | ✅ Verb match ranked higher |
| k6 / test route noise | ✅ Demoted below production routes |
| Controller class name (`MultiviewController`) | ✅ Was already OK |
| Controller class name (`RelatedContentController`) | ✅ Fixed (suffix fetch + token demotion) |

---

## Benchmark ticket results

### Cat3 — related contents

| Query | Top result | Score | Verdict |
|-------|------------|-------|---------|
| `related-contents` | `api:GET:contents/{param}/related-contents` | 1350 | ✅ |
| `GET /api/v3/contents/{content}/related-contents` | `api:GET:contents/{param}/related-contents` | 1850 | ✅ exact + verb |
| `api:GET:contents/{param}/related-contents` | same | 1850 | ✅ |
| `GET contents/related-contents` | `api:GET:contents/{param}/related-contents` | 1010 | ✅ |
| `POST /api/v3/contents/{id}/related-contents` | `api:POST:contents/{param}/related-contents` | 1850 | ✅ |

Note: Full apiResource registers POST/DELETE routes too; `related-contents` alone returns GET first (intended for Cat3 ticket).

### Multiview

| Query | Top result | Score | Verdict |
|-------|------------|-------|---------|
| `multiview` | `api:GET:contents/{param}/multiview` | 1350 | ✅ |
| `GET /api/v3/contents/{contentId}/multiview` | `api:GET:contents/{param}/multiview` | 1850 | ✅ |
| `api:GET:contents/{param}/multiview` | same | 1850 | ✅ |
| `GET contents/multiview` | `api:GET:contents/{param}/multiview` | 1010+ | ✅ |

`/multiview/metadata` ranks second — correct sibling demotion.

---

## Symbol search (controller names)

| Query | Before fix | After fix |
|-------|------------|-----------|
| `MultiviewController` | ✅ V3 MultiviewController | ✅ unchanged |
| `RelatedContentController` | ❌ generic `App\Http\Controllers\Controller` | ✅ `RelatedContentController` classes (V2 before V3 alphabetically) |
| `RelatedContentController::index` | — | ✅ V3 `::index` method |

**Root cause:** `RelatedContentController` tokenized to `Related`, `Content`, `Controller`. The `Controller` token matched hundreds of base `Controller` classes within the SQL `LIMIT 300` window before `RelatedContentController` rows were fetched.

**Fix:** PascalCase suffix fetch (`%\RelatedContentController`) + demote short token matches when the raw query is a longer PascalCase symbol.

**Tip for agents:** Prefer `find … "GET …/related-contents" --kind=route` for tickets; use `RelatedContentController::index` when the class name alone is ambiguous (V2 vs V3).

---

## Noise / edge cases observed

| Query | Issue | Severity |
|-------|-------|------------|
| `GET contents/related-contents` | Backend `baseConfigEventContents` routes appear in top 5 | Low — correct route still #1 |
| `GET /api/v3/contents/{id}/multiview` | Backend `contents` routes in tail | Low |
| `RelatedContentController` | Multiple classes (V2, V3, ContentManager) | Info — use `::index` or route find for V3 |

---

## Verification commands

```bash
npm run test:route-search
npm run test:route-search-variants
npm run test:symbol-search

# Manual spot-checks on spott graph
node bin/impactlens.js find spott/Graph.sqlite "GET /api/v3/contents/{content}/related-contents" --kind=route
node bin/impactlens.js find spott/Graph.sqlite "multiview" --kind=route
node bin/impactlens.js find spott/Graph.sqlite "RelatedContentController"
node bin/impactlens.js find spott/Graph.sqlite "RelatedContentController::index"
```

---

## Out of scope (unchanged)

- Route find ranking for partial path overlap across apps (backend vs frontend)
- `Route::resource` `create`/`edit` web routes not expanded in scanner
- Transitive route → controller proof without `trace`/`ai-context`
