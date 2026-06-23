# Config setup

ImpactLens needs **one file in your project** for accurate JS/Vue/Nuxt graphs: `impactlens.config.json` at the **scan root** (the folder you pass to `scan`, not inside the ImpactLens package).

```text
your-repo/
├── impactlens.config.json   ← here
├── apps/
├── packages/
└── ...
```

Also accepted: `.impactlens.json` in the same folder.

**When you need this:** any project that uses import aliases (`@/`, `@core/`, `~`, etc.). Relative imports (`../../api`) work without config.

**When you skip it:** PHP-only scans, or JS with no path aliases.

After creating the file:

```bash
npx impactlens scan /path/to/your-repo --lang=both --output=both
```

The CLI prints `scan config: path aliases loaded` when the file is found.

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
npx impactlens scan /path/to/monorepo --lang=both --no-merge --output=both
```

---

### 2. Nuxt 3 monorepo (package-scoped aliases)

Nuxt monorepos often use **one alias per package** (`@core/`, `@content/`, …). Map each prefix to `packages/<name>/` relative to the scan root.

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
  }
}
```

**Scan:**

```bash
npx impactlens scan /path/to/nuxt-monorepo --lang=js --output=both
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

**Becomes ImpactLens config** (drop the `/*` suffix on keys; values are directories relative to scan root):

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

1. Create `impactlens.config.json` at the scan root.
2. Map every alias prefix your frontend imports use (`from '@core/...'`, `from '@/...'`).
3. Run scan — confirm `scan config: path aliases loaded`.
4. For ticket briefings on full-stack work, use `--lang=both` and `--scopes=php,js`.
5. If flow paths show `[partial]` with no `HTTP_REQUEST` edge, re-check aliases first.

---

## More detail

| Doc | Contents |
|-----|----------|
| [scan-config.md](scan-config.md) | Full scan config reference, HTTP resource pattern, before/after chains |
| [config.md](config.md) | Architecture rules, ticket tuning, all config types |
| [support.md](support.md) | Language maturity, Nuxt gaps, what the graph can miss |
