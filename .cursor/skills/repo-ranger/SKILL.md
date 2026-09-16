---
name: repo-ranger
description: >-
  Navigate to the entry point of a change in unfamiliar PHP/Laravel,
  JavaScript/TypeScript, Vue, and Nuxt repositories with the RepoRanger static
  code graph. Use when a task names an existing HTTP route, controller, class,
  method, or component and you do not know which file to open first.
---

# RepoRanger

RepoRanger answers one question: **which file and method do I open first?**

It is a navigator, not a search engine and not a source of truth. It does not
prove completeness, does not find every occurrence, and does not replace
repository search. Verify every suggestion in source before editing.

## Hard rules

1. Never run `locate` without a strong anchor. Get one first if the task does
   not contain one.
2. With a strong anchor, `locate` comes before opening files.
3. `Confidence: low` means stop. Run the printed `rg` command instead. Never
   run another graph command to repair a low-confidence result, and never
   re-run `locate` with the same anchor.
4. At most two RepoRanger commands per task. The second is `find`, and only for
   the two reasons listed below.
5. Never chain `locate` → `find` → `ai-context` → `trace` → impact commands.
6. Once the likely file is visible, stop navigating and read source.
7. Do not use RepoRanger when the exact file is already known.

## Step 1 — get a strong anchor

`locate` only works with a **strong anchor**: a symbol that exists in the graph
as a declaration.

| Strong anchor | Weak anchor |
| --- | --- |
| `GET /api/v3/contents/{id}/multiview` | a database column or payload field name |
| `App\Services\PaymentService::process` | a string literal or config key |
| `PaymentController` | an external API property name |
| `CheckoutForm.vue` | a concept from prose ("caching", "purge", "status") |

Never invent a plausible symbol name from ticket prose. Either the task names a
strong anchor, or you go and find one.

### Path A — the task already names a strong anchor

Go straight to step 2.

### Path B — the task is vague (the common case)

Most tickets describe a symptom, a field, or a wish, not a symbol. That is
normal and RepoRanger still applies — you just earn the anchor first:

1. Run one or two targeted repository searches on the most distinctive token in
   the ticket: the field name, the literal, the error message, the endpoint
   fragment, the label in the UI.
2. Open the best hit and read the **enclosing declaration**: which class,
   method, controller, or component is this?
3. That declaration is your strong anchor. Run one `locate` on it to get the
   flow, the layer below it, and the tests around it.

```bash
rg -n "video_duration" --type php
# hit: app/Services/EventContentService.php:88, inside formatPayload()
npx repo-ranger locate <graph-db> "App\\Services\\EventContentService::formatPayload"
```

Search finds the occurrence. `locate` tells you what that occurrence is
connected to, which is the part search cannot answer. Do not skip the search to
`locate` the raw ticket text, and do not skip `locate` once you have a real
symbol and still do not know the flow.

This path is allowed exactly once per task. If the search finds nothing usable,
there is no anchor — keep searching in source and leave the graph alone.

## Step 2 — one locate

Reuse an existing non-empty graph from project instructions or a common path
such as `sqlite/Graph.sqlite` or `graph.sqlite`. Do not rebuild it for
navigation.

```bash
npx repo-ranger locate <graph-db> "<anchor>" --source-root=<repo-root>
```

```bash
npx repo-ranger locate <graph-db> "GET /api/v3/contents/{id}/multiview" --kind=route
npx repo-ranger locate <graph-db> "App\\Services\\PaymentService::process"
npx repo-ranger locate <graph-db> userCountry --kind=field
```

Use `--kind=route` for HTTP paths and `--kind=field` for fields that already
exist in the graph. Pass `--source-root` to get source snippets.

## Step 3 — read the output in this order

1. **`Confidence`** — decides whether the rest is usable.
   - `low`: stop. Run the printed `rg` command. Do not open the suggested files
     as if they were the answer.
   - `medium`: usable as a starting point. Verify in source.
   - `high`: open the top result first.
2. **`Graph`** — scan age and commit. A commit that differs from `HEAD` or an
   age in weeks means the graph may point at moved or renamed code.
3. **`Inspect first`** — open the top entry, then at most four more. Line ranges
   are 1-based and include a snippet of the declaration.
4. **`Tests`** — the existing tests for this area. Read them before changing
   behaviour; extend them rather than writing new ones from scratch.
5. **`Flow`** — the call path. Use it to understand layering, not as proof that
   nothing else calls this code.
6. **`Coverage`** and warnings — read literally. `missing: validation` means the
   graph has no validation edges here, not that validation does not exist.

## Step 4 — optional second command

Run `find` only for one of these two reasons, and only with an exact symbol
name you already saw in source or in the ticket:

| Situation | Command |
| --- | --- |
| `locate` matched the wrong anchor and you need alternative candidates | `find <graph-db> "<symbol>"` |
| `locate` showed the read path but the work lives in another app, module, or layer | `find <graph-db> "<symbol>" --runtime=backend` |

```bash
npx repo-ranger find <graph-db> "FrontendCacheService" --runtime=backend
```

`find` returns a ranked symbol list with no flow, no tests, and no confidence.
It is a lookup, not a step in a chain — read source from its results.

Do not run a second command to confirm something already visible in source.

## Questions the graph cannot answer

For these, repository search is the correct tool, not a fallback. Use it and do
not come back to the graph unless the search hands you a new strong anchor
whose flow you still do not know (path B):

- a field name, column, payload key, or string literal
- configuration, environment values, or route middleware wiring
- migrations, SQL, seeders, or fixtures
- a **missing** call, hook, listener, or invalidation after a write
- every occurrence of something, for a rename or a sweep
- dynamic dispatch, reflection, magic methods, or runtime-resolved bindings
- generated code or vendor integrations

A graph shows what exists. It cannot show what is absent, and it does not
enumerate literals.

## Failure and freshness rules

- If the graph is absent, empty, or stale, use repository search.
- Treat a missing result as unknown, never as proof of absence.
- If RepoRanger fails with `EPERM` or an IPC-pipe error, retry once with the
  required permission, then fall back to repository search.
- Preserve the command's real exit code; do not pipe through truncation
  commands that can hide failures.
