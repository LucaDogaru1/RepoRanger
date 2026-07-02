---
name: impactlens
description: >-
  Navigate large codebases using a static code graph. Find symbols, trace end-to-end flows (route → controller → fields → services), inspect callers/callees, and change impact. Use ticket analysis only when tickets contain technical anchors.
---

# ImpactLens

ImpactLens is a **code graph navigation tool**. It complements your own ticket reading and repository search — it does not replace them.

* **You** understand the ticket and often find the first code anchor.
* **ImpactLens** supplies repository knowledge you cannot infer from the ticket alone: callers, callees, dependencies, workflow connections, blast radius, architectural context.
* **Repository code** is always the source of truth.

Never treat any ImpactLens output as authoritative. Verify everything in code before implementing.

---

# When to use what

| Situation | Use |
|-----------|-----|
| Symbol / route / field name unclear | `find` |
| API or controller ticket — need the flow fast | `find` → **`trace`** |
| Full context for AI (nav, arch, cycles, risk) | `ai-context --compact` |
| Blast radius around a known symbol | `change-impact`, `impact` |
| Ticket has technical anchors and you want ranked entrypoints | `analyze:ticket` (optional), then graph commands |
| Vague ticket only | Do **not** run `analyze:ticket`; repo search → `find` → `trace` |

**Primary value:** `find` → `trace` → `ai-context`, not mandatory ticket analysis.

---

# Workflow

## 1. Read and understand the ticket

Read the ticket (user message, issue, or file). Decide:

* What workflow is involved (UI, API, queue, import, etc.)
* Whether the ticket contains **enough technical context** for graph-based navigation to be meaningful

**Sufficient context examples:** API endpoints · request/response fields · dotted field paths · PascalCase/camelCase symbols · routes · namespaces · file paths · concrete feature names tied to code · technical acceptance criteria

**Insufficient context examples:** vague complaints (“page is slow”, “hero looks wrong”) with no symbols, routes, or field names — graph ticket analysis will return low-information results; use normal repo search instead.

If you already identified a likely class, method, endpoint, or file through reasoning or search, **skip `analyze:ticket`** and go straight to step 3.

---

## 2. Analyze the ticket (optional)

Run `analyze:ticket` **only when** the ticket has technical anchors that make graph ranking worthwhile.

Pass ticket text inline (not only a file path):

```bash
impactlens ticket sqlite/Graph.sqlite \
  --ticket="GET /api/v1/slide-presets — add slidePreset filter to HeroTeaser CMS cell" \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui \
  --non-interactive
```

**`ticket_topic`:** `ui` · `queue` · `api` · `import` · `cron` · `migration` · `background` · `mixed`

**`change_includes`:** `cms_ui` · `queue_job` · `api_field` · `persistence` · `backend_logic` · `import_pipeline` · `infra_new` · `mixed`

**`scopes`:** `php` (backend only) · `php,js` (Vue/Nuxt/CMS UI or UI→API flows)

File paths work when a ticket file exists: `--ticket=tickets/example.txt`

Use `--boost` or `--suppress` if important symbols are buried by unrelated matches.

If the briefing reports no reliable technical anchors or zero confidence, **do not trust its file list** — continue with repository search, then use graph commands on symbols you verify.

Read the briefing (when used) in this order: Read first → Flow paths → Warnings. Treat all suggestions as hypotheses.

---

## 3. Investigate with the graph

Once you have a symbol (from your own search, `find`, or from an optional briefing):

```bash
impactlens find sqlite/Graph.sqlite PaymentController
impactlens find sqlite/Graph.sqlite "POST /payments" --kind=route

impactlens trace sqlite/Graph.sqlite "<symbol-or-fuzzy-name>"

impactlens ai-context sqlite/Graph.sqlite "<graph-id>" --compact

impactlens change-impact sqlite/Graph.sqlite "<graph-id>"
impactlens impact sqlite/Graph.sqlite "<graph-id>"
```

**Symbol id examples:** `App\Http\Controllers\PaymentController::pay` (PHP) · `js:apps/.../heroTeaser/index.vue::HeroTeaser` (Vue) · `api:POST:api/payments` (route)

**Typical order:** `find` → **`trace`** (flow + coverage) → **`ai-context`** (full paste) → `change-impact` / `impact` if blast radius matters.

---

## 4. Implement

Implement only after verifying the relevant code in the repository.

If the graph is incomplete or misleading, continue with normal investigation — ImpactLens is a navigation aid, not a decision engine.

---
## 5. Feedback (mandatory)

When you used an ImpactLens command and have enough information to judge its usefulness, append **one JSON line** to `.ai/impactlens/impactlens-feedback.jsonl` if a feedback file already existing write another one in the same folder.

Record feedback **once per task**. Skip feedback if you could not meaningfully evaluate the command.

```json
{
  "timestamp": "2026-06-22T12:00:00Z",
  "command": "analyze:ticket",
  "ticket": "inline",
  "summary": "Hero teaser layout configuration",
  "ticket_topic": "ui",
  "change_includes": "cms_ui",
  "scopes": "php,js",
  "helpful": true,
  "reason": "helpful",
  "readFirst": [
    "js:apps/.../heroTeaser/index.vue::HeroTeaser"
  ],
  "actual": [
    "js:apps/.../heroTeaser/index.vue::HeroTeaser"
  ]
}
```

### `command`

One of:

* `analyze:ticket`
* `find`
* `trace`
* `ai-context`
* `change-impact`
* `impact`
* `architecture`
* `risk`
* `hotspots`
* `cycles`
* `dead-code`

### `reason`

When `helpful: true`:

* `helpful`

When `helpful: false`:

* `wrong-workflow`
* `wrong-files`
* `missing-files`
* `wrong-flow-path`
* `no-useful-results`
* `graph-incomplete`

Record what you actually investigated in `actual`. If the command suggested entrypoints or symbols, record them in `readFirst`.


---

## Rules

* **Do not** run `analyze:ticket` for every task — use it only when technical anchors make graph navigation meaningful.
* Prefer **`find` → `trace` → `ai-context`** for controller/API work.
* If you run `analyze:ticket`, pass explicit `--answers` with `--non-interactive`.
* Prefer inline `--ticket="…"` with the ticket text the user gave you.
* Never treat briefing output or graph output as source of truth — verify in code.
* Record feedback when ticket analysis was used and can be meaningfully evaluated.
