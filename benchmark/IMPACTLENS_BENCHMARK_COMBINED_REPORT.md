# ImpactLens Benchmark

**50 runs** across **5 tickets** (5 WITH / 5 WITHOUT each) · all completed  
**Sources:** `summary/*-with-impactlens-summary.md`, `summary/*-without-impactlens-summary.md`, `benchmarkSummary/10_runs.md`–`50_runs.md`

**Metrics:** Navigation = repo searches + ImpactLens commands. Open files = unique read paths, excluding benchmark infra (`.cursor/`, skill files, `package.json`, etc.). Edits don't count as opens. Percent change: `(WITHOUT − WITH) / WITHOUT × 100`.

---

## TL;DR

ImpactLens consistently reduced **searching** and **files opened** while keeping **100% completion**. It did **not** make runs faster overall — only 1 of 5 tickets was quicker with ImpactLens.

| Signal | Result |
| ------ | ------ |
| Fewer repo searches | **5/5** tickets (40–67% less) |
| Fewer files opened | **5/5** tickets (15–57% less) |
| Fewer navigation steps | **4/5** tickets (1 unchanged — searches replaced by graph commands) |
| Faster runs | **1/5** faster, **1/5** same, **3/5** slower |
| Same root cause found | **4/5** tickets fully; Cat3 same query class, different match semantics |

---

## Results by ticket

Medians. Multiview WITHOUT excludes run `933aad21` (broken telemetry).

| Ticket | Duration | Files | Searches | Navigation | Notes |
| ------ | -------- | ----- | -------- | ---------- | ----- |
| **UTR** – CMS download toggle | 198s vs 230s (**14% faster**) | 17 vs 22 (−23%) | 9 vs 17 (−47%) | 13 vs 17 (−24%) | Strongest overall win |
| **fullIsoCode** – CMS language | 371s vs 222s (**67% slower**) | 10 vs 16 (−38%) | 3 vs 9 (−67%) | 6 vs 9 (−33%) | Route finds often miss; 521s outlier in WITH |
| **Image duplicates** – CMS editorial | 190s vs 189s (same) | 6 vs 14 (**−57%**) | 4 vs 8 (−50%) | 6 vs 8 (−25%) | Best file reduction; EPERM issues in 4/5 WITH runs |
| **Cat3** – related contents API | 300s vs 182s (**65% slower**) | 9 vs 11 (−18%) | 6 vs 10 (−40%) | 8 vs 10 (−20%) | Same query method, divergent Cat3 semantics |
| **Multiview** – country filter API | 306s vs 245s (**25% slower**) | 14 vs 16.5 (−15%) | 4 vs 7 (−43%) | 7 vs 7 (same) | Graph helps find controller; query layer still needs grep |

**Pooled (25 WITH vs 25 WITHOUT):** 280s vs 221s duration · 9 vs 15.5 files · 4 vs 8.5 searches · 7 vs 8.5 navigation steps.

---

## What worked / what didn't

**ImpactLens helped most when** the ticket had a clear symbol or controller anchor (UTR download toggle, image duplicates, Multiview/Cat3 entry points). **It helped least when** root cause sat deep in query builders or routes weren't in the graph (fullIsoCode settings route, Cat3 criteria, Multiview geo-joins).

**Common pattern:** `find` narrowed the entry point, but **grep fallback was needed in every WITH run** — missing route edges, incomplete traces to query/service classes, and Sandbox/EPERM CLI failures.

---

## Safe claims vs not

**Supported (conservative):**
- Fewer classic repo searches in all 5 tickets
- Fewer files opened in all 5 tickets
- Fewer navigation steps in 4/5 tickets
- 100% completion in all 50 runs
- Same root-cause region in 4/5 tickets

**Not supported:**
- "ImpactLens makes agents faster" (only 1/5 tickets)
- "Fewer files = fewer tokens" (not measured)
- "ImpactLens writes better code"
- A single blended % without per-ticket context

---

## Limitations

- Small sample: 5 tickets, same `benchmark-monorepo`, often same base commit
- Model/prompt/cache effects not controlled
- Sandbox EPERM, missing Redis extension, Podman/DB workarounds, dirty worktrees in several runs
- One WITHOUT run with no navigation telemetry; two extra fullIsoCode WITH runs outside the primary 50
- Cat3: completed ≠ identical business logic

---

## Conclusion

ImpactLens measurably reduces **how much an agent searches and reads** to finish the same tickets. It does **not** reliably reduce **wall-clock time** or improve code quality.

Next steps for stronger public claims: more diverse tickets/repos, stable CLI execution (no EPERM), and better graph coverage for routes and controller→query edges — not just more repeats of the same five tickets.

**Priority improvements from the benchmark:**
1. Reliable CLI without Sandbox/EPERM breaks
2. Better HTTP route and controller→service/query indexing
3. Less immediate grep fallback after first `find`
4. Telemetry validation for incomplete event logs

---

## Data quality notes

11 runs had caveats (kept in primary analysis unless noted):

| Ticket | Run | Issue | Impact |
| ------ | --- | ----- | ------ |
| fullIsoCode | `a7f3c2e8` | 521s disturbed run | Exclude from duration sensitivity only |
| Cat3 | `4efcbef2` | EPERM + DB/Podman detour, 420s | Exclude from duration sensitivity only |
| Multiview | `933aad21` | 0 telemetry events | Exclude from nav metrics only |
| Image | 4 WITH runs | EPERM/Sandbox | Navigation usable, ImpactLens weakened |
| UTR, Cat3, Multiview | various | Dirty worktree / Redis / DB blocks | Duration interpretation only |
