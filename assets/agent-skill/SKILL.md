---
name: repo-ranger
description: >-
  Locate the smallest relevant change area in unfamiliar PHP/Laravel,
  JavaScript/TypeScript, Vue, and Nuxt repositories with the RepoRanger static
  code graph. Use when a task contains an existing HTTP route, controller,
  class, method, component, or field but its location or flow is unclear.
---

# RepoRanger

Use RepoRanger as a bounded navigation shortcut, not as source of truth.
Verify its suggestions in repository code before editing.

## Navigation budget

- Prefer one RepoRanger command per task before inspecting source.
- Use at most two RepoRanger commands total. Run the second only for a concrete
  relationship question that source inspection did not answer.
- Do not chain `find`, `locate`, `trace`, `ai-context`, and impact commands.
- Stop graph navigation as soon as the likely implementation or root-cause area
  is visible. Continue with source inspection, implementation, and tests.
- Do not use RepoRanger when an exact file is already known.

## Primary workflow

1. Extract one concrete, existing anchor from the task: an HTTP route, class,
   method, component, or field. Do not invent plausible symbols from prose.
2. Reuse an existing non-empty graph from project instructions or a common path
   such as `sqlite/Graph.sqlite` or `graph.sqlite`. Do not rebuild it merely for
   navigation.
3. Run one lookup:

```bash
npx repo-ranger locate <graph-db> "<anchor>"
```

Use `--kind=route` for HTTP paths and `--kind=field` for existing fields:

```bash
npx repo-ranger locate <graph-db> "GET /api/v3/contents/{id}/multiview" --kind=route
npx repo-ranger locate <graph-db> "App\\Services\\PaymentService::process"
npx repo-ranger locate <graph-db> userCountry --kind=field
```

4. Open only the relevant entries from `Inspect first`, starting with the top
   result. Inspect no more than five suggested files before deciding whether
   the graph helped.
5. Read `Coverage` and warnings literally. Missing or partial coverage is not
   evidence that code does not exist.
6. Stop using RepoRanger and continue from verified source.

## When no anchor exists

For a vague ticket, new feature, or unique source literal, use one targeted
repository search first. If it reveals a concrete symbol or route whose flow is
still unclear, run one `locate` query. Do not send the full vague ticket to a
sequence of graph commands.

## Optional second command

Use a second command only after inspecting source and only when one of these
questions remains:

| Unanswered question | Command |
| --- | --- |
| Need alternative matches because `locate` chose the wrong anchor | `find` |
| Need a longer route or call flow | `trace` |
| Need callers, implementations, or inheritance | `ai-context --compact` |
| Need an unclear blast radius before a risky change | `change-impact` |

Never run a second command merely to confirm information already visible in
source. Prefer targeted repository search when the missing evidence concerns
configuration, migrations, SQL, tests, fixtures, generated code, dynamic
dispatch, reflection, runtime state, or external integrations.

## Failure and freshness rules

- If the graph is absent, empty, or likely stale, use normal repository search.
- Treat a missing result as unknown, not as proof of absence.
- If RepoRanger fails with `EPERM` or an IPC-pipe error, retry once with the
  required permission, then fall back to repository search.
- Preserve the command's real exit code; do not pipe through output truncation
  commands that can hide failures.
