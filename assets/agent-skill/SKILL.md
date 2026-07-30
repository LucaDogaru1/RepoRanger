---

name: impactlens
description: >-
Navigate large codebases using a static code graph. Find symbols, trace
runtime and data flows, inspect relationships, and assess change impact.
Use ticket analysis only when tickets contain concrete technical anchors.
-------------------------------------------------------------------------

# ImpactLens

ImpactLens is a code-navigation tool — a map, not a decision engine.

Run it through:

```bash
npx impactlens
```

Repository code is always the source of truth. Verify relevant graph results directly in code before editing.

---

# Core workflow

1. Read and understand the ticket.
2. Identify the strongest concrete technical anchor.
3. Choose the cheapest reliable navigation method.
4. Use ImpactLens only to answer a concrete unresolved navigation question.
5. Inspect graph results in repository code.
6. Stop graph navigation once the likely implementation or root-cause area is known.
7. Continue with targeted search, implementation, tests, and validation.
8. Evaluate ImpactLens usefulness from the actual chronological workflow.

There is no mandatory ImpactLens command sequence.

Do not force ImpactLens usage merely because it is available.

Do not avoid it when it can answer the current question more directly than broad repository search.

---

# Resolve the graph database first

Before the first ImpactLens query, identify the correct graph database path.

Possible locations include:

```text
impactlens/graph.sqlite
sqlite/Graph.sqlite
graph.sqlite
```

Prefer:

1. an explicitly provided path
2. `impactlens.config.json`
3. repository documentation or benchmark instructions
4. an existing non-empty graph database

Do not assume an example path is correct.

Confirm that the selected file exists and is not an empty placeholder or invalid SQLite database.

Reuse the verified path in later commands:

```bash
npx impactlens find <graph-db> PaymentController
```

If a graph path fails:

* record the failure accurately
* check configuration or documented infrastructure
* retry only with a verified path
* continue with normal repository search when no usable graph is available

Do not rebuild or modify the graph merely to locate it.

---

# Choosing anchors

Prefer anchors likely to exist directly in code:

1. exact classes, methods, components, functions, commands, or namespaces
2. routes and endpoints
3. request, response, model, or database fields
4. configuration keys or statuses
5. unique business terms
6. general feature names

Avoid inventing plausible-sounding class names.

Example:

```text
Ticket:
Archived content remains visible

Strong anchor:
is_archived

Weak inferred anchor:
EditorialService
```

When an exact file is provided, open it directly.

When a concrete symbol, route, endpoint, or field is known but its location is unclear, prefer `find` before broad repository-wide search.

For vague tickets, use targeted repository search first to discover a verified technical anchor.

For mixed tickets, investigate each independent feature separately.

---

# Choosing a navigation method

| Situation                                                              | Preferred action             |
| ---------------------------------------------------------------------- | ---------------------------- |
| Exact file is known                                                    | Open it directly             |
| Clear filename is known                                                | Targeted file lookup or glob |
| Unique literal is likely                                               | Exact grep                   |
| Symbol, route, endpoint, or field location is unclear                  | `find`                       |
| Runtime, request, UI-to-API, or data flow is unclear                   | `trace`                      |
| Callers, callees, dependencies, interfaces, or inheritance are unclear | `ai-context --compact`       |
| Blast radius is unclear                                                | `change-impact` or `impact`  |
| Ticket is vague with no verified anchor                                | Targeted repository search   |
| Several concrete anchors need ranking                                  | Optional `analyze:ticket`    |

Use the cheapest method that can reliably answer the current question.

---

# Commands

## Find an entrypoint

```bash
npx impactlens find <graph-db> PaymentController
npx impactlens find <graph-db> "POST /payments" --kind=route
npx impactlens find <graph-db> userCountry --kind=field
```

Use `find` when the repository location or exact graph identifier is unknown.

Inspect the most relevant result directly in repository code.

Do not run additional graph commands merely to confirm the same result.

## Trace a flow

```bash
npx impactlens trace <graph-db> "<symbol-or-fuzzy-name>"
```

Use `trace` when a specific flow question remains, such as:

* Which route reaches this controller?
* Which service receives this field?
* How does a UI action reach the backend?
* Where does this value flow next?

Do not use `trace` only because `find` returned a controller.

## Inspect relationships

```bash
npx impactlens ai-context <graph-db> "<graph-id>" --compact
```

Use it when callers, callees, implementations, dependencies, or inheritance remain unclear.

## Assess change impact

```bash
npx impactlens change-impact <graph-db> "<graph-id>"
```

Use `change-impact` or `impact` only when the affected surface is not already evident from inspected code.

## Analyze a ticket

`analyze:ticket` is optional.

Use it only when:

* the ticket contains concrete technical anchors
* several possible entrypoints exist
* ranked suggestions would materially help

Treat returned entrypoints as hypotheses and verify them in code.

---

# Stop rule

Stop using graph commands once the likely implementation or root-cause area is known.

Continue with:

* targeted search
* direct code reading
* framework-specific inspection
* configuration
* migrations
* tests and fixtures
* implementation
* validation

Fallback repository search is normal and does not automatically mean ImpactLens failed.

---

# Command integrity

Preserve the real ImpactLens exit code.

Avoid pipelines where commands such as `head` hide failures:

```bash
npx impactlens find <graph-db> PaymentController 2>&1 | head -40
```

When limiting output, enable pipe failure handling:

```bash
set -o pipefail
npx impactlens find <graph-db> PaymentController 2>&1 | head -40
```

Alternatively, capture the complete output and shorten only its summary.

Do not treat an error message as success because a pipeline returned exit code `0`.

Do not run unsupported metadata commands such as:

```bash
npx impactlens --version
```

unless support is documented or the task explicitly requires the attempt.

Metadata commands are not repository-navigation commands.

---

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

---

# Evaluating usefulness

Evaluate ImpactLens from the actual sequence of actions, not merely from command success.

ImpactLens materially helped when it:

* identified the first relevant symbol or file
* replaced a broad search with a focused entrypoint
* revealed a relevant route, service, caller, dependency, or field flow
* identified an affected area that influenced the solution
* materially reduced uncertainty about what to inspect next

ImpactLens did not materially help when:

* normal search already found and opened the same file
* inspected code already revealed the same flow
* the result repeated an already verified fact
* the result was not used
* the command ran only after implementation locations were already known

Example:

```text
grep finds and opens DownloadUrlController
ImpactLens later finds DownloadUrlController

Assessment:
redundant confirmation
```

Example:

```text
ImpactLens finds DownloadUrlController
the controller is opened
targeted search then finds the CMS form

Assessment:
ImpactLens supplied the first backend entrypoint;
fallback search completed the investigation
```

Example:

```text
grep finds the controller
ImpactLens trace reveals a non-obvious service later changed

Assessment:
ImpactLens did not find the first file,
but materially improved flow discovery
```

Do not describe a later confirmation as the original discovery.

---

# Feedback

Record feedback once per task when ImpactLens was used or meaningfully evaluated.

## Destination precedence

When task instructions provide a feedback schema or destination:

* use that schema and destination
* do not also write the default feedback file

Otherwise append one JSON line to:

```text
.ai/impactlens/impactlens-feedback.jsonl
```

Do not replace existing lines.

## Allowed values

`primaryCommand`:

```text
find
trace
ai-context
change-impact
impact
analyze:ticket
architecture
risk
hotspots
cycles
dead-code
none
```

`reason`:

```text
helpful
minor-confirmation
redundant-confirmation
wrong-workflow
wrong-files
missing-files
wrong-flow-path
no-useful-results
graph-incomplete
environment
not-used
```

`benchmarkImpact`:

```text
positive
neutral
negative
unknown
```

## Feedback rules

* `commandsUsed`: actual ImpactLens commands in chronological order
* `primaryCommand`: command that contributed most, otherwise `none`
* `query`: actual most important query
* `helpful`: `true` only when navigation materially improved
* `reason`: classify the actual contribution or failure
* `benchmarkImpact`: observed impact on the run
* `usageNote`: explain discovery versus confirmation using chronology
* `fallbackSearchUsed`: `true` when normal search was needed alongside or after ImpactLens
* `fallbackNote`: explain what normal search located
* `readFirst`: files or symbols first suggested by ImpactLens
* `actual`: files or symbols actually inspected and found relevant
* `affectedCode`: files ultimately changed or directly affected

Do not copy all changed files into `actual` unless they were genuinely inspected.

Do not mark ImpactLens helpful merely because it was executed successfully.

## Typical classifications

```text
ImpactLens provided a useful first entrypoint or non-obvious flow:
helpful=true
reason=helpful
benchmarkImpact=positive
```

```text
ImpactLens added limited context but did not change the path:
helpful=false
reason=minor-confirmation
benchmarkImpact=neutral
```

```text
ImpactLens repeated already known information:
helpful=false
reason=redundant-confirmation
benchmarkImpact=neutral or negative
```

```text
ImpactLens was reasonably unnecessary:
helpful=false
reason=not-used
benchmarkImpact=neutral
primaryCommand=none
```

## Environment failures

When no meaningful graph result is produced because of an execution problem:

```json
{
  "helpful": false,
  "reason": "environment",
  "benchmarkImpact": "unknown",
  "failure": {
    "category": "sandbox-permission",
    "details": "tsx could not create its IPC pipe.",
    "command": "find",
    "query": "MultiviewController"
  }
}
```

When an early invocation fails but later commands produce useful results:

* record the failed invocation
* mention it as a limitation
* evaluate overall usefulness from the successful contribution
* do not classify the whole task as an environment failure

---

# Final principles

* ImpactLens is a navigation tool, not an oracle.
* Resolve the graph path before querying it.
* Use the cheapest reliable navigation method.
* Prefer `find` before broad search when a concrete code anchor exists but its location is unclear.
* Use each graph command to answer a concrete unanswered question.
* Stop graph navigation once the implementation or root-cause area is known.
* Verify graph results directly in code.
* Preserve real failures and exit codes.
* Evaluate usefulness from actual chronology.
* Record feedback once without duplicates.
