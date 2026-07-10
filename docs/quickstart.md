# Quickstart

Everything you need once. No hunting through other docs.

## 1. Install

**In your project** (recommended — installs the `impactlens` CLI and Cursor agent skill):

```bash
npm install impactlens
# skill auto-written to .cursor/SKILL.md
impactlens --help
```

**Or clone this repo** for development:

```bash
git clone https://github.com/LucaDogaru1/ImpectLens.git
cd ImpectLens
npm install
```

Use `impactlens …` after npm install in a project, or `npm run scan` / `npm run analyze:ticket` when working from a clone.

List all CLI commands: `npx impactlens --commands`

## 2. Config (only if the target repo uses `@/` imports)

Create **`impactlens.config.json` at the scan root** (the repo you scan, not inside ImpactLens).

**Copy-paste examples:** [config-setup.md](config-setup.md) — Laravel+Vue `@/`, Nuxt package aliases, Vite `src/`, subfolder scans.

Minimal Laravel + Vue example:

```json
{
  "pathAliases": {
    "@/": "apps/your-app/resources/assets/js/"
  }
}
```

Skip this if the project only uses relative imports (`../../api`).

If you use `@/` and skip this, Vue→API→controller links will be missing in the graph.

Details: [config-setup.md](config-setup.md) · [config.md](config.md) · [scan-config.md](scan-config.md)

## 3. Scan (once, re-run when the codebase changes a lot)

```bash
npm run scan -- /path/to/your-repo --lang=both --no-merge --output=both
```

Produces:

- `sqlite/Graph.sqlite` — used by all analyzers
- `Graph.json` — optional backup / inspect

**JS/Vue only:** `--lang=js`  
**Nuxt monorepo:** `--lang=js` at the Nuxt repo root — add `impactlens.config.json` with package aliases. See [config-setup.md](config-setup.md#2-nuxt-3-monorepo-package-scoped-aliases).

## 4. Investigate a symbol (default workflow)

Once you have a keyword from the ticket or repo search:

```bash
impactlens find sqlite/Graph.sqlite PaymentController
impactlens trace sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay"
impactlens ai-context sqlite/Graph.sqlite "App\\Http\\Controllers\\PaymentController::pay" --compact
```

Use **`trace`** for a quick flow story (route → controller → fields → services + coverage gaps).  
Use **`ai-context --compact`** when you need the full navigation paste for an AI tool.

## 5. Optional ticket briefing

Only when the ticket has technical anchors (endpoints, field paths, symbols):

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/my-ticket.txt \
  --scopes=php,js
```

Output is a compact markdown briefing (read-first, flow paths, files to open). Paste into your AI tool, then continue with `find` → `trace` → `ai-context`.

| Flag | When |
|------|------|
| `--scopes=php,js` | Full-stack / CMS / Vue tickets |
| `--scopes=php` | Backend-only (queue, API, jobs) |
| `--full` | Debug ranking (raw matches — high token cost) |
| `--answers=ticket_topic:ui,change_includes:mixed` | Skip interactive prompts |

## 6. Blast radius (optional)

```bash
npm run analyze:change-impact -- sqlite/Graph.sqlite "App\\Services\\SomeService::method"
npm run analyze:impact -- sqlite/Graph.sqlite "App\\Services\\SomeService::method"
```

---

## AI agents

After `npm install`, the skill is at `.cursor/SKILL.md` in your project (source: `assets/agent-skill/SKILL.md` in this repo).

**Developer:** steps 1–3 once per repo.  
**AI:** `find` → `trace` → `ai-context` per task; `ticket` only when anchors are clear.

---

## More detail (only if stuck)

| Doc | Why open it |
|-----|-------------|
| [support.md](support.md) | PHP vs JS/Vue/**Nuxt** maturity, gaps, what to expect from the graph |
| [config-setup.md](config-setup.md) | **Path alias setup** — copy-paste `impactlens.config.json` examples |
| [config.md](config.md) | All config files explained |
| [scan-config.md](scan-config.md) | Alias examples, monorepo paths |
| [commands.md](commands.md) | All CLI flags |
| [trace.md](trace.md) | End-to-end flow + coverage for one symbol |
| [ai-context.md](ai-context.md) | Full navigation report for AI paste |
| [ticket-analysis.md](ticket-analysis.md) | Session, workflows, flow paths |
