# Configuration

RepoRanger uses **two kinds of config**, in **two locations**. No hunting — this page explains each file, why it exists, and how to run it.

## At a glance

| Config | Location | Loaded by | Purpose |
|--------|----------|-----------|---------|
| **Scan config** | `<scan-root>/repo-ranger.config.json` | `npm run scan` | JS path aliases, HTTP resource class pattern |
| **Architecture rules** | `config/architecture_scan/*.json` | `analyze:architecture --architecture-config=...` | Ignore/allow layer violations |

```
Your monorepo/                          RepoRanger repo/
├── repo-ranger.config.json   ← scan    ├── config/
└── (code)                               ├── architecture_scan/
                                         │   ├── spott.json
                                         │   └── laravel.example.json
```

---

## 1. Scan config — `repo-ranger.config.json`

**Why:** The scanner reads import strings literally. Bundler aliases like `@/` do not exist on disk unless you map them.

**Where:** At the **scan root** (the repo you pass to `npm run scan`), not inside the RepoRanger tool folder.

**Also accepts:** `.repo-ranger.json` in the same place.

### Example (Vue/Laravel monorepo with `@/`)

```json
{
  "pathAliases": {
    "@/": "apps/spott-backend/resources/assets/js/"
  },
  "httpResourceClassPattern": "Resource"
}
```

| Key | Why |
|-----|-----|
| `pathAliases` | `@/api/index` → real file path → `API.slidePresets.fetch()` links to backend routes |
| `httpResourceClassPattern` | Matches `SpOTTResource`, `PageResource`, etc. when extracting API barrel files |

### Run

```bash
npm run scan -- /path/to/your-repo --lang=both --no-merge --output=both
```

Scan auto-loads `repo-ranger.config.json` from `/path/to/your-repo`.

**More detail:** [config-setup.md](config-setup.md) (copy-paste examples) · [scan-config.md](scan-config.md) (reference)

---

## 2. Architecture rules — `config/architecture_scan/`

**Why:** Layer checks (Controller → Service → Repository) produce noise in Laravel apps: repositories call `Model::query()`, services use `Http::`, controllers type-hint `Request`. Config tells RepoRanger which edges are **acceptable** vs real violations.

**Where:** Shipped examples live in this repo under `config/architecture_scan/`. Point `--architecture-config` at your copy or these files.

### Files

| File | Purpose |
|------|---------|
| `laravel.example.json` | Minimal starter for any Laravel project |
| `spott.json` | SpOTT-specific architecture ignores |

### Structure

```json
{
  "architecture": {
    "ignorePatterns": [
      "*Repository::* -> *::query",
      "*Service::* -> Illuminate\\Support\\Facades\\Http::*"
    ],
    "allow": [
      "Repository -> Domain",
      "Infrastructure -> Domain"
    ],
    "notes": ["Optional human-readable notes — not used by analyzer"]
  }
}
```

| Key | Why |
|-----|-----|
| `ignorePatterns` | Edge patterns to treat as allowed (not violations). Format: `*Source* -> *Target*` |
| `allow` | Layer pairs that are always OK (e.g. Repository accessing Domain models) |

### Example patterns

```json
"*Repository::* -> *::query"
```
Repository calling Eloquent `query()` — normal persistence, not “repository calls controller”.

```json
"*Service::* -> Illuminate\\Http\\Request::*"
```
Service method receives HTTP request — framework plumbing, not a layer breach.

```json
"*Connector::* -> Illuminate\\Support\\Facades\\Http::*"
```
Outbound HTTP client in a connector class — expected.

### Run

```bash
npm run analyze:architecture -- sqlite/Graph.sqlite \
  --architecture-config=config/architecture_scan/spott.json \
  --include-depends-on \
  --ignore-likely-false-positives
```

Use `laravel.example.json` as a template for new projects; copy and trim to your namespaces.

---

## 3. Architecture preset — `config/architecture_scan/spott.json`

**Why:** Keep SpOTT-specific architecture ignores in one reusable file.

It contains full `architecture.ignorePatterns` for SpOTT namespaces (`SpOTTBackend`, `Modules`, HTTP facades, repository interfaces).

Use architecture part today:

```bash
npm run analyze:architecture -- sqlite/Graph.sqlite \
  --architecture-config=config/architecture_scan/spott.json \
  --ignore-likely-false-positives
```

---

## Which config do I need?

| Goal | Config | Action |
|------|--------|--------|
| First-time setup on a monorepo | Scan config | Add `repo-ranger.config.json` at scan root — [config-setup.md](config-setup.md) |
| CI architecture gate | Architecture JSON | `--architecture-config=config/architecture_scan/your.json` |
| SpOTT codebase | `spott.json` | Architecture rules ready to use |

**Quick path:** [quickstart.md](quickstart.md)
