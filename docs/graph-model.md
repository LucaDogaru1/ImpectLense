# Graph model

ImpactLens stores a code graph in SQLite (`nodes`, `edges`) and JSON. All analyzers query this graph.

## Example (PHP)

```text
UserController::show
        |
        v
UserService::create
      /     \
     v       v
EventService  UserRepository
```

## Example (full-stack)

```text
SlidePresetDropdown.vue::fetchSlidePresets
        |
        | HTTP_REQUEST
        v
api:GET:/slide-presets
        |
        | ROUTES_TO
        v
SlidePresetsController::index
```

## Node types

### PHP

| Type | Description |
|---|---|
| `class` | PHP class |
| `interface` | PHP interface |
| `method` | Method on class/interface |
| `api_endpoint` | Laravel route endpoint |
| `request_field` | Validated request field |
| `integration_entrypoint` | Job, listener, command, etc. |

### JavaScript / Vue

| Type | Description |
|---|---|
| `js_module` | JS/Vue file module |
| `vue_component` | Vue component (SFC or defineComponent) |
| `vue_prop` | Declared component prop |
| `method` | Function or Vue option method (incl. `setup`) |
| `api_endpoint` | Inferred HTTP path (fetch or HTTP client) |
| `external_api_call` | Browser/runtime API (not project code) |

## Edge types

### PHP

| Type | Description |
|---|---|
| `CONTAINS` | Class/module contains method |
| `EXTENDS` / `IMPLEMENTS` | Inheritance |
| `CALLS` | Direct method call |
| `DEPENDS_ON` | Constructor injection |
| `ROUTES_TO` | API endpoint → controller method |
| `PERSIST` / `SERIALIZES` | Model/request/response field flow |

### JavaScript / Vue

| Type | Description |
|---|---|
| `IMPORTS` | Module import |
| `REFERENCES` | Vue `components` map entry |
| `HTTP_REQUEST` | Client call → `api_endpoint` |
| `CALLS` | Local or imported function call |
| `PASSES_PROP` / `DECLARES_PROP` | Template → prop flow |
| `EXTERNAL_API_CALL` | Runtime API usage |

Cross-language linking merges JS `api_endpoint` nodes with PHP routes when paths align.

## SQLite schema

- **`nodes`**: `id`, `type`, `name`, `file`, `keywords`, …
- **`edges`**: `from_id`, `to_id`, `type`, `via`, `confidence`, `reason`

## How analyzers use the graph

| Analyzer | Graph usage |
|---|---|
| Impact / change impact | Caller/callee traversal |
| Cycles | Loop detection on call edges |
| Dead code | Methods without incoming usage |
| Architecture | Layer direction on dependencies |
| Hotspots / risk | Connection density |
| Ticket analysis | Keyword match + workflow boost + flow paths |
