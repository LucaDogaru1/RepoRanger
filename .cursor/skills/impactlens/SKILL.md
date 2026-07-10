---
name: impactlens
description: >-
  Navigate large codebases using a static code graph. Find symbols, trace end-to-end flows
  (route → controller → fields → services), inspect callers/callees, and change impact.
  Use ticket analysis only when tickets contain concrete technical anchors.
---

# ImpactLens

ImpactLens is a **code graph navigation tool** — a map, not a decision engine.

* **You** read the ticket and find the first anchor (symbol, route, file, feature name).
* **ImpactLens** shows what the ticket alone cannot: callers, callees, routes, field flow, dependencies, blast radius.
* **Repository code** is always the source of truth — verify everything before editing.

Use ImpactLens **before** broad repo search for navigation tasks. Use grep/search **after** ImpactLens to verify details or when the graph has no match.

**Primary workflow:** `find` → `trace` → `ai-context --compact` → verify in code → implement.

Do **not** start with `analyze:ticket`. That command is optional and only for tickets with concrete technical anchors.

---

# When to use what

| Situation | Use |
|-----------|-----|
| Symbol, route, field, or feature name unclear | `find` |
| You have an anchor — need flow / connections | `trace` |
| Full navigation context for AI paste | `ai-context --compact` |
| Blast radius around a known symbol | `change-impact`, `impact` |
| Vague ticket (no symbols, routes, fields) | Repo search → verified anchor → `find` / `trace` |
| Ticket has strong anchors and you want ranked hints | `analyze:ticket` (optional), then graph commands |
| Mixed / multi-feature ticket | Split into anchors → navigate each separately |

**Default order:**

```txt
unknown anchor:  find → trace → ai-context
known symbol:    trace → ai-context
change/risk:     ai-context → change-impact / impact
```

---

# Workflow

## 1. Read the request

Identify workflow type (UI, API, queue, import, etc.) and any **concrete anchors**:

* endpoints, routes, request/response fields, dotted field paths
* PascalCase/camelCase symbols, filenames, namespaces, model/command names
* technical acceptance criteria tied to code

Vague tickets ("page is slow", "hero looks wrong") have no graph entrypoint — use repo search first, then ImpactLens on whatever you verify.

If you already have a symbol, file, or route, **skip `analyze:ticket`** and go straight to graph commands.

## 2. Navigate with graph commands

```bash
impactlens find sqlite/Graph.sqlite PaymentController
impactlens find sqlite/Graph.sqlite "POST /payments" --kind=route

impactlens trace sqlite/Graph.sqlite "<symbol-or-fuzzy-name>"

impactlens ai-context sqlite/Graph.sqlite "<graph-id>" --compact

impactlens change-impact sqlite/Graph.sqlite "<graph-id>"
```

**Symbol id examples:** `App\Http\Controllers\PaymentController::pay` · `js:apps/.../heroTeaser/index.vue::HeroTeaser` · `api:POST:api/payments`

| Command | Use for |
|---------|---------|
| `find` | Unknown symbols, feature names, routes, endpoints, fields |
| `trace` | Callers/callees, route→controller→service, UI→API, field flow |
| `ai-context --compact` | Full nav context, architecture, cycles, risk — paste for AI |
| `change-impact` / `impact` | Blast radius, what may break |

## 3. Mixed tickets

Split independent features into separate anchors. Navigate each — do not let one strong match hide others.

```txt
PostingsNotifications     → find "PostingsNotifications" → ai-context
sitemap submissions       → find "SubmitSitemap" → trace
backend dark mode         → find "backendDarkMode" → ai-context
```

## 4. `analyze:ticket` (optional only)

Run **only** when the ticket has concrete anchors (endpoints, class/method names, fields, routes) and ranked entrypoints would help. Never the default.

```bash
impactlens ticket sqlite/Graph.sqlite \
  --ticket="GET /api/v1/slide-presets — add slidePreset filter to HeroTeaser CMS cell" \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui \
  --non-interactive
```

**`ticket_topic`:** `ui` · `queue` · `api` · `import` · `cron` · `migration` · `background` · `mixed`

**`change_includes`:** `cms_ui` · `queue_job` · `api_field` · `persistence` · `backend_logic` · `import_pipeline` · `infra_new` · `mixed`

**`scopes`:** `php` (backend) · `php,js` (Vue/Nuxt/CMS UI, UI→API)

Read output: Read first → Flow paths → Warnings. Treat as hypotheses — continue with `find` / `trace` / `ai-context`. Do not stop at the briefing.

If low confidence or no anchors, ignore the briefing and use repo search + graph commands.

## 5. Verify and implement

Open and verify returned files in the repo before editing. If the graph is incomplete, continue with normal investigation.

---

# Feedback (mandatory)

After using ImpactLens, append **one JSON line** to `.ai/impactlens/impactlens-feedback.jsonl`. Once per task; skip if you could not evaluate.

```json
{
  "timestamp": "2026-06-22T12:00:00Z",
  "command": "trace",
  "ticket": "inline",
  "summary": "Article reading time estimate feature",
  "ticket_topic": "ui",
  "change_includes": "backend_logic",
  "scopes": "php",
  "helpful": true,
  "reason": "helpful",
  "readFirst": ["App\\Helpers\\Input\\TextExtractor::countAllWords"],
  "actual": [
    "App\\Helpers\\Input\\TextExtractor",
    "App\\Helpers\\Pages\\Seo\\SeoNewsHelper::getPageInfo",
    "cms/resources/views/cms/Element/Laola1/NewsElement/NewsElement.blade.php"
  ]
}
```

**`command`:** `find` · `trace` · `ai-context` · `change-impact` · `impact` · `analyze:ticket` · `architecture` · `risk` · `hotspots` · `cycles` · `dead-code` · `none`

**`reason` when helpful:** `helpful`

**`reason` when not:** `wrong-workflow` · `wrong-files` · `missing-files` · `wrong-flow-path` · `no-useful-results` · `graph-incomplete`

Record ImpactLens suggestions in `readFirst`, what you actually opened in `actual`.

---

# Rules

* ImpactLens is a **navigation tool** — not an analysis oracle.
* Default: **`find` → `trace` → `ai-context`**. Not `analyze:ticket`.
* Use `analyze:ticket` only when concrete anchors make ranked hints worthwhile.
* For mixed tickets, navigate each feature anchor separately.
* Never treat graph or briefing output as source of truth — verify in code.
* Record feedback once per task when usage can be meaningfully evaluated.
