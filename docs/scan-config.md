# Scan configuration

ImpactLens reads an optional config file from the **scan root** (the path you pass to `npm run scan`):

- `impactlens.config.json`
- `.impactlens.json` (fallback)

If neither exists, defaults apply.

## Example

```json
{
  "pathAliases": {
    "@/": "apps/spott-backend/resources/assets/js/"
  },
  "httpResourceClassPattern": "Resource"
}
```

## Options

| Key | Purpose |
|---|---|
| `pathAliases` | Map bundler import aliases to repo-relative paths |
| `httpResourceClassPattern` | Suffix for HTTP resource classes (default: `Resource`) — matches `SpOTTResource`, `PageResource`, etc. |

---

## Path aliases

### Why they are needed

Frontend code often uses **compile-time import aliases** (`@/`, `~`, `@components/`). Webpack/Vite resolve these at build time; the scanner only sees the string in source.

ImpactLens links imports to graph nodes by resolving that string to a file path:

```javascript
import API from '@/api/index'
```

**Without aliases:**

```text
@/api/index  →  js:@/api/index.js   (no such file — linking fails)
```

**With aliases:**

```text
@/api/index  →  apps/spott-backend/resources/assets/js/api/index.js
            →  js:apps/spott-backend/resources/assets/js/api/index.js
```

This matters for **HTTP client linking**. The chain is:

1. `api/index.js` registers `slidePresets → /slide-presets/{id}` in the HTTP resource registry
2. A Vue file calls `API.slidePresets.fetch()`
3. The scanner must resolve `API` to `api/index.js` to connect the call to that registry

Relative imports (`../../api`) work without config. Aliases do not.

### Before / after (SpOTT example)

**Broken chain (no alias):**

```text
SlidePresetDropdown.vue
  import API from '@/api/index'
       ↓
  js:@/api/index.js          ← stub, resources not found
       ↓
  API.slidePresets.fetch()   ← no HTTP_REQUEST edge
```

**Working chain (with alias):**

```text
SlidePresetDropdown.vue
  import API from '@/api/index'
       ↓
  js:.../api/index.js
       ↓  (registry: slidePresets → /slide-presets/{id})
  API.slidePresets.fetch()
       ↓
  HTTP_REQUEST → api:GET:/slide-presets
       ↓
  ROUTES_TO → SlidePresetsController::index
```

### Common alias mappings

Mirror what your `vite.config.ts`, `webpack.config.js`, or `tsconfig.json` `paths` define:

```json
{
  "pathAliases": {
    "@/": "src/",
    "~": "src/",
    "@components/": "frontend/components/"
  }
}
```

**Rule of thumb:** if the codebase uses `from '@/` or `from '~/'`, add `pathAliases` for accurate JS graph linking.

### Monorepo with multiple apps

Use the path **relative to the scan root**. For SpOTT backend CMS assets:

```json
{
  "pathAliases": {
    "@/": "apps/spott-backend/resources/assets/js/"
  }
}
```

If you scan a subfolder only (e.g. `apps/spott-backend`), adjust the target accordingly:

```json
{
  "pathAliases": {
    "@/": "resources/assets/js/"
  }
}
```

---

## HTTP resource class pattern

Used when extracting `new SomeResource({ url: '...' })` from API barrel files. Default pattern `Resource` matches class names ending in `Resource`.

Override only if your project uses a different convention:

```json
{
  "httpResourceClassPattern": "ApiClient"
}
```

Large API index files that crash the JS parser still register resources via a regex fallback when this pattern matches.
