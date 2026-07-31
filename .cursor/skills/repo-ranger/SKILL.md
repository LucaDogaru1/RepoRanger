---
name: repo-ranger
description: >-
  Navigate large codebases with the RepoRanger static code graph. Use when a
  ticket contains an HTTP route, controller, class, method, component, field,
  or when code flow, dependencies, callers, or change impact
  are unclear. Especially useful for large PHP/Laravel, JavaScript/TypeScript,
  Vue, and Nuxt repositories.
---

# RepoRanger

RepoRanger is a navigation map, not a source of truth. Verify relevant graph
results in repository code before editing.

Run commands through:

```bash
npx repo-ranger
```

# Workflow

1. Read the ticket and extract concrete technical anchors that already exist in
   the repository. Prefer verified code anchors over names or fields proposed
   by the ticket.
2. Resolve the graph database path once.
3. Choose the command from the decision guide below.
4. Inspect the top relevant result in repository code.
5. Do not chain graph commands by default. Run another RepoRanger command only
   when the previous result left a concrete unanswered navigation question.
6. Stop graph navigation when the likely implementation or root-cause area is
   known. Once a relevant file has been opened and the next investigation step
   is visible in code, stop issuing graph commands and continue with targeted
   repository inspection.
7. Continue with targeted search, implementation, and validation.

Example:

```text
find already identifies the relevant controller
→ open and inspect the controller
→ do not automatically run trace, ai-context, and change-impact
```

Do not force RepoRanger when an exact file is already known. Use RepoRanger
when a concrete route or symbol is known but its repository location or
relationships are unclear.

# Resolve the graph database

Prefer, in order:

1. an explicitly provided path
2. a path documented by `repo-ranger.config.json` or repository instructions
3. an existing non-empty SQLite graph such as:

```text
repo-ranger/graph.sqlite
sqlite/Graph.sqlite
graph.sqlite
```

Confirm the file exists and is not an empty placeholder. Reuse the verified
path. Do not rebuild or modify the graph merely to locate it.

If graph metadata contains a scan date or repository commit, compare it with
the current worktree. Treat missing recently added symbols or fields cautiously
when the graph may be stale.

If no usable graph exists, continue with normal repository search.

# Decision guide

| Known information or question | Action |
| --- | --- |
| Exact file | Open it directly |
| Unique literal likely present in source | Targeted repository search |
| HTTP method/path or route fragment | `find --kind=route` |
| Existing request/model/response field | `find --kind=field` |
| Class, method, component, function, or namespace | `find` |
| Route-to-controller, request, UI-to-API, or data flow | `trace` |
| Callers, callees, implementations, dependencies, inheritance | `ai-context --compact` |
| Blast radius | `change-impact` or `impact` |
| Vague ticket without a verified code anchor | Use targeted repository search to discover the first concrete anchor, then switch to RepoRanger if graph context is still useful |

# Find

## Routes

Always use `--kind=route` for HTTP paths and route fragments. Do not rely on
auto detection for fragments such as `config/settings` or `related-contents`.

```bash
npx repo-ranger find <graph-db> "GET /api/v3/config/settings" --kind=route
npx repo-ranger find <graph-db> "GET /api/v3/contents/{contentId}/multiview" --kind=route
npx repo-ranger find <graph-db> "related-contents" --kind=route
```

Full ticket URLs are supported:

* `/api`, `/api/v1`, `/api/v2`, `/api/v3`, and `/api/v4` prefixes are normalized.
* Named parameters such as `{contentId}` and `{userId}` are normalized to `{param}`.
* The HTTP method influences ranking.
* Production route files are preferred over k6, test, fixture, and benchmark routes.

Inspect the top result first. If the full path has no useful result:

1. retry once with the shortest distinctive route suffix and `--kind=route`
2. try a verified controller name from the ticket or repository
3. search route files directly

Retry with a route suffix that removes generic API prefixes while preserving
enough context to distinguish the endpoint. Examples include
`config/settings`, `contents/{param}/multiview`, and `related-contents`.

Do not repeatedly submit equivalent full-path variants.

## Symbols

```bash
npx repo-ranger find <graph-db> MultiviewController
npx repo-ranger find <graph-db> EditorialService
npx repo-ranger find <graph-db> "App\\Services\\PaymentService::process"
```

For a known class or method name, search the complete identifier first. Do not
split or shorten an exact identifier unless the exact query produced no useful
result.

Prefer exact or fully qualified symbols over generic terms. If results are
dominated by generic suffixes such as `Controller` or `Service`, use a more
specific class/namespace anchor or targeted repository search.

Do not invent plausible class names from ticket prose.

## Fields

```bash
npx repo-ranger find <graph-db> userCountry --kind=field
```

Field search only finds fields present in the scanned graph. A field proposed
by the ticket may not exist yet. For new fields:

1. find the owning route, controller, model, or component
2. inspect that code
3. use targeted repository search for related existing fields

No field result is not evidence that the feature area does not exist.

# Trace

```bash
npx repo-ranger trace <graph-db> "<symbol-or-route>"
```

Use `trace` only for a concrete flow question:

* Which route reaches this controller?
* Which service receives this request field?
* How does a UI action reach the backend?
* Where does this value flow next?

Class targets can reveal route entries even when a route action and indexed
method do not align. Missing calls or fields can still indicate incomplete
scanner coverage; inspect the route and controller directly.

Do not run `trace` merely because `find` succeeded.

# Relationships and impact

```bash
npx repo-ranger ai-context <graph-db> "<graph-id>" --compact
npx repo-ranger change-impact <graph-db> "<graph-id>"
```

Use `ai-context` when callers, callees, implementations, dependencies, or
inheritance remain unclear. Use `change-impact` or `impact` only when the
affected surface is not already evident from inspected code.

# Fallback and stop rules

Fallback repository search is expected for:

* missing or newly introduced fields
* routes absent from the graph
* configuration, migrations, SQL, and framework registration
* templates, fixtures, generated code, reflection, and dynamic dispatch
* runtime state and external integrations
* stale or incomplete graphs

Stop using graph commands once the likely implementation or root-cause area is
known. Do not issue additional graph commands only to confirm information that
has already been verified in repository code.

# Execution failures

If RepoRanger fails with `EPERM` or cannot create an IPC pipe, retry once with
the required permissions or outside the sandbox. If it still fails, continue
with repository search. Do not interpret the execution failure as an empty
graph result.

# Command integrity

Preserve the real RepoRanger exit code.

Avoid pipelines where commands such as `head` hide failures:

```bash
npx repo-ranger find <graph-db> PaymentController 2>&1 | head -40
```

When limiting output, enable pipe failure handling:

```bash
set -o pipefail
npx repo-ranger find <graph-db> PaymentController 2>&1 | head -40
```

Alternatively, capture the complete output and shorten only its summary.

Do not treat an error message as success because a pipeline returned exit code `0`.

# Repository verification

Verify graph findings directly in repository code.

The graph may not fully represent:

* configuration values
* SQL and migrations
* framework lifecycle behavior
* templates
* test fixtures
* dynamic dispatch
* reflection
* generated code
* runtime state
* external integrations

Never edit code solely because a graph result suggested it.

# Final principles

* RepoRanger is a navigation tool, not a source of truth.
* Use concrete existing anchors whenever possible.
* Use `find --kind=route` for HTTP routes and route fragments.
* Do not chain graph commands without a concrete unanswered question.
* Stop when the relevant implementation area is known.
* Verify every graph result in repository code.
* Fall back to repository search when the graph is missing or incomplete.
