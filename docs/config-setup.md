# Config setup

RepoRanger automatically discovers static path aliases from:

- `tsconfig.json` and `jsconfig.json` (`baseUrl`, `paths`, and relative `extends`);
- `nuxt.config.js|ts|mjs|cjs` (`alias`, `srcDir`, and Nuxt's `@`, `~`, `@@`, `~~` defaults);
- `vite.config.js|ts|mjs|cjs` (`resolve.alias`);
- `webpack.config.js|ts|mjs|cjs` (`resolve.alias`).

In monorepos, aliases are scoped to the nearest app/package configuration. Two
apps can therefore use `@/` for different directories without colliding.

Use `repo-ranger.config.json` at the **scan root** only as an override for
dynamic, plugin-generated, or otherwise non-standard aliases:

```text
your-repo/
├── repo-ranger.config.json   ← here
├── apps/
├── packages/
└── ...
```

Also accepted: `.repo-ranger.json` in the same folder. Explicit aliases always
win over auto-detected aliases.

**When you need this:** RepoRanger reports unresolved aliases, the build config
computes aliases dynamically, or you deliberately want to override the project configuration.

**When you skip it:** standard Nuxt, Vue/Vite, webpack, and TypeScript projects,
PHP-only scans, or JS projects with no path aliases.

After creating the file:

```bash
repo-ranger scan /path/to/your-repo --lang=both --output=both
```

The CLI reports separately how many aliases were auto-detected and whether
explicit aliases were loaded.

---

## Copy-paste examples

### 1. Laravel + Vue monorepo (`@/` → CMS assets)

Typical full-stack monorepo: PHP backend with Vue assets under `resources/assets/js/`.

```json
{
  "pathAliases": {
    "@/": "apps/spott-backend/resources/assets/js/"
  },
  "httpResourceClassPattern": "Resource"
}
```

| Import in source | Resolves to |
|------------------|-------------|
| `@/api/index` | `apps/spott-backend/resources/assets/js/api/index` |
| `@/components/Hero.vue` | `apps/spott-backend/resources/assets/js/components/Hero.vue` |

`httpResourceClassPattern` matches API barrel classes like `SlidePresetResource` so `API.slidePresets.fetch()` can link to PHP routes.

**Scan from monorepo root:**

```bash
repo-ranger scan /path/to/monorepo --lang=both --no-merge --output=both
```

---

### 2. Nuxt 3 monorepo (package-scoped aliases)

Nuxt monorepos often use **one alias per package** (`@core/`, `@content/`, …).
RepoRanger normally reads these from the Nuxt/TypeScript configuration. The
following override is only needed when those aliases are generated dynamically:

Real-world example (Nuxt `packages/` layout):

```json
{
  "pathAliases": {
    "@apps/": "apps/",
    "@packages/": "packages/",
    "@clientPackages/": "clientPackages/",
    "@core/": "packages/core/",
    "@content/": "packages/content/",
    "@footer/": "packages/footer/",
    "@navigation/": "packages/navigation/",
    "@schedule/": "packages/schedule/",
    "@search/": "packages/search/",
    "@player/": "packages/player/",
    "@ui-design/": "packages/ui-design/",
    "@payment/": "packages/payment/",
    "@epg/": "packages/epg/"
  }
}
```

| Import in source | Resolves to |
|------------------|-------------|
| `@content/composables/usePage` | `packages/content/composables/usePage` |
| `@ui-design/components/Button.vue` | `packages/ui-design/components/Button.vue` |

**Minimal Nuxt starter** (only the packages you actually import):

```json
{
  "pathAliases": {
    "@core/": "packages/core/",
    "@content/": "packages/content/",
    "@ui-design/": "packages/ui-design/",
    "@/": "packages/core/"
  },
  "httpResourceClassPattern": "Resource"
}
```

**Scan:**

```bash
repo-ranger scan /path/to/nuxt-monorepo --lang=js --output=both
```

For UI → API → controller briefings, also scan the Laravel backend (`--lang=php` or `--lang=both` if both live in one tree). See [support.md](support.md#nuxt-beta).

---

### 3. Single Vue / Vite app (`@/` → `src/`)

```json
{
  "pathAliases": {
    "@/": "src/",
    "~": "src/",
    "@components/": "src/components/"
  }
}
```

| Import in source | Resolves to |
|------------------|-------------|
| `@/api/client` | `src/api/client` |
| `@components/Modal.vue` | `src/components/Modal.vue` |

---

### 4. Scanning a subfolder only

Paths in `pathAliases` are **relative to the scan root**, not the repo root.

If you scan `apps/spott-backend` instead of the whole monorepo:

```json
{
  "pathAliases": {
    "@/": "resources/assets/js/"
  },
  "httpResourceClassPattern": "Resource"
}
```

If you scan `packages/content` only:

```json
{
  "pathAliases": {
    "@content/": "./",
    "@core/": "../core/"
  }
}
```

Prefer scanning the **monorepo root** when possible — one graph, fewer surprises.

---

## How to find your aliases

Copy from the same place your bundler/TS resolver uses:

| File | Look for |
|------|----------|
| `tsconfig.json` | `compilerOptions.paths` |
| `vite.config.ts` | `resolve.alias` |
| `nuxt.config.ts` | `alias` |
| `webpack.config.js` | `resolve.alias` |

**Example `tsconfig.json` paths:**

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["src/*"],
      "@core/*": ["packages/core/*"]
    }
  }
}
```

**Becomes RepoRanger config** (drop the `/*` suffix on keys; values are directories relative to scan root):

```json
{
  "pathAliases": {
    "@/": "src/",
    "@core/": "packages/core/"
  }
}
```

---

## Checklist

1. Create `repo-ranger.config.json` at the scan root.
2. Map every alias prefix your frontend imports use (`from '@core/...'`, `from '@/...'`).
3. Run scan — confirm the auto-detected alias count, or `explicit path aliases loaded` when using an override.
4. If cross-language traces have no `HTTP_REQUEST` edge, re-check aliases first.

---

## More detail

| Doc | Contents |
|-----|----------|
| [scan-config.md](scan-config.md) | Full scan config reference, HTTP resource pattern, before/after chains |
| [config.md](config.md) | Architecture rules and all config types |
| [support.md](support.md) | Language maturity, Nuxt gaps, what the graph can miss |
