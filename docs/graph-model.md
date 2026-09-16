# Graph model

RepoRanger stores a code graph in SQLite (`nodes`, `edges`) and JSON. All analyzers query this graph.

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
| `enum` | PHP enum |
| `method` | Method on class/interface |
| `api_endpoint` | Laravel route endpoint |
| `middleware` | Middleware attached to a Laravel route |
| `request_field` | Validated request field |
| `integration_entrypoint` | Job, listener, command, etc. |

### JavaScript / Vue

| Type | Description |
|---|---|
| `js_module` | JS/Vue file module |
| `vue_component` | Vue component (SFC or defineComponent) |
| `vue_prop` | Declared component prop |
| `dynamic_component` | A Vue `<component :is="...">` binding |
| `component_registry` | Map that registers component implementations by key |
| `registry_entry` | One key in a component registry |
| `method` | Function or Vue option method (incl. `setup`) |
| `api_endpoint` | Inferred HTTP path (fetch or HTTP client) |
| `external_api_call` | Browser/runtime API (not project code) |

### Project structure

| Type | Description |
|---|---|
| `project_scope` | Auto-detected workspace/runtime boundary from package and build configuration |

Project scopes record a workspace path, runtime (`legacy-vue`, `nuxt`, `vue`,
`shared`, `backend`, or `unknown`), confidence, evidence, and configuration
sources. `find` uses the nearest scope plus strong path signals such as
`resources/assets/js` to classify and filter results.

## Edge types

### PHP

| Type | Description |
|---|---|
| `CONTAINS` | Class/module contains method |
| `EXTENDS` / `IMPLEMENTS` | Inheritance |
| `CALLS` | Direct method call |
| `DEPENDS_ON` | Constructor injection |
| `ROUTES_TO` | API endpoint → controller method |
| `USES_MIDDLEWARE` | API endpoint → route middleware |
| `PERSIST` / `SERIALIZES` | Model/request/response field flow |

### JavaScript / Vue

| Type | Description |
|---|---|
| `IMPORTS` | Module import |
| `REFERENCES` | Vue `components` map entry |
| `HTTP_REQUEST` | Client call → `api_endpoint` |
| `CALLS` | Local or imported function call |
| `PASSES_PROP` / `DECLARES_PROP` | Template → prop flow |
| `RENDERS_COMPONENT` | Vue template/dynamic binding → rendered component module |
| `RENDERS_DYNAMIC` | Vue component → `<component :is>` binding |
| `DECLARES_REGISTRY` | Module → component registry |
| `REGISTERED_AS` | Registry key → registered component module |
| `RESOLVES_VIA_REGISTRY` | Dynamic component binding → registry |
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
| Feature / context | File clustering, runtime filtering, registries, and bounded task context |
| Similar | Deterministic file-shape and graph-neighborhood comparison |
