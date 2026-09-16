---
name: repo-ranger
description: >-
  Navigate unfamiliar PHP/Laravel, JavaScript/TypeScript, Vue, and Nuxt
  codebases with the RepoRanger static code graph. Use when a ticket contains
  an HTTP route, controller, class, method, component, or field whose location
  or code flow is unclear, or when dependencies and change impact are unknown.
---

# RepoRanger

Treat graph output as a navigation map, not source of truth. Verify relevant
results in repository code before editing.

## Primary workflow

1. Decide whether the task has a concrete existing anchor. Do not invent class
   names from ticket prose.
2. Reuse an existing non-empty graph path from project instructions, config, or
   common locations such as `sqlite/Graph.sqlite` or `graph.sqlite`. Do not
   rebuild the graph just to navigate.
3. For a concrete route, symbol, component, or field, run one compact lookup:

```bash
npx repo-ranger locate <graph-db> "<route|class|method|component|field>"
```

Use `--kind=route` for ambiguous route fragments and `--kind=field` for fields.
For example:

```bash
npx repo-ranger locate <graph-db> "GET /api/v3/contents/{id}/multiview" --kind=route
npx repo-ranger locate <graph-db> "App\\Services\\PaymentService::process"
npx repo-ranger locate <graph-db> userCountry --kind=field
```

4. Open only the relevant entries from `Inspect first` and verify the reported
   flow in code. The command returns at most five prioritized files.
5. Read `Coverage` literally. Missing or partial sections mean the graph did
   not prove that part of the flow.
6. Stop graph navigation when the implementation or root-cause area is clear;
   continue with targeted repository inspection, implementation, and tests.

For Vue/Nuxt methods with a recorded HTTP call, `locate` crosses the
`HTTP_REQUEST` edge into the Laravel route and backend call chain.

For a feature request or vague ticket without an existing anchor, run one
bounded task-context query instead:

```bash
npx repo-ranger context <graph-db> "<ticket summary>" --max-tokens=2500
```

Add `--runtime=nuxt`, `--runtime=legacy-vue`, or `--workspace=<name>` when the
ticket establishes that boundary. Start with `Inspect first`; use `feature` or
`similar` only if the context output remains ambiguous.

## Choose another command only when needed

| Remaining question | Command |
| --- | --- |
| Need alternative matches after a wrong/ambiguous match | `find` |
| Need a feature-level file cluster | `feature` |
| Need implementations with a similar graph shape | `similar` |
| Need a longer, detailed flow | `trace` |
| Need callers, callees, implementations, or inheritance | `ai-context --compact` |
| Need blast radius | `change-impact` or `impact` |

Do not automatically chain `find`, `trace`, `ai-context`, and impact commands.
If an exact file is already known, open it directly. If only a vague phrase or
unique source literal is known, use targeted repository search to discover a
real anchor first.

## Limits and fallback

Expect repository search for missing/new fields, configuration, migrations,
SQL, framework registration, templates, fixtures, generated code, dynamic
dispatch, reflection, runtime state, and external integrations. A missing graph
result is not proof that code does not exist. Consider graph age if recent code
is absent.

If RepoRanger fails with `EPERM` or an IPC-pipe error, retry once with required
permissions or outside the sandbox, then fall back to repository search.
Preserve the real command exit code; avoid pipelines that hide failures.
