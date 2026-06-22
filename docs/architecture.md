# Architecture Validation

## Layer model

ImpactLens maps classes to layers by namespace/path keywords:

| Rank | Layer keywords |
|---|---|
| 0 | `Presentation`, `Http`, `Controller` |
| 1 | `UseCase`, `UseCases` |
| 2 | `Service`, `Services` |
| 3 | `Repository`, `Repositories` |
| 4 | `Domain` |
| 5 | `Infrastructure` |

A violation is reported when a lower-level layer depends on a higher-level layer.

## Allowed dependencies

Typical expected flow:

```text
Controller -> Service -> Repository
Repository -> Domain
```

This keeps business flow readable and avoids lower-level code reaching into UI/application orchestration.

## Violation examples

Human-readable example:

```text
Infrastructure code should not call Presentation code.

Expected flow:
Controller -> Service -> Repository

Detected flow:
Infrastructure -> Presentation
```

Other common violations:

- `Repository -> Controller`
- `Service -> Controller`
- `Domain -> Service`

## Severity explanation

| Edge type | Severity | Meaning |
|---|---|---|
| `CALLS` | `HIGH` | Direct runtime coupling; usually fix quickly |
| `DEPENDS_ON` | `MEDIUM` | Constructor dependency direction issue; review architecture intent |

## Interpreting reports

Each violation includes:

- `reason`: plain-language explanation.
- `expected`: recommended dependency direction.
- `detected`: currently observed dependency direction.

Use this as a refactor checklist:

1. Move orchestration upward (toward UseCase/Controller).
2. Move infrastructure details downward behind interfaces.
3. Re-run architecture analysis and verify `detected` matches `expected`.

## False positives (Laravel / HTTP namespaces)

Some `* -> Http` violations are likely false positives when the target is framework HTTP client code rather than your presentation layer.

Typical examples:

- `Illuminate\\Http\\*`
- `Illuminate\\Support\\Facades\\Http::*`
- `Psr\\Http\\*`
- `Symfony\\Component\\HttpFoundation\\*`

Repository-to-ORM access is also often a normal persistence concern when the target is a model query call:

- `*Repository::* -> *::query`

Typical examples that can be configured away:

- `Repository -> CompetitorRankingSet::query`
- `Repository -> CompetitorRankingSetEntry::query`
- `Service -> Illuminate\\Http\\Request::*`
- `Service -> SpOTTBackend\\Http\\Requests\\*::*`

Architecture output now marks these as likely false positives and includes an `fp note`.

You can configure these rules in a JSON file and pass it with `--architecture-config`:

```json
{
  "architecture": {
	"ignorePatterns": [
	  "*Repository::* -> *::query",
	  "*Service::* -> Illuminate\\Http\\Request::*"
	],
	"allow": [
	  "Infrastructure -> Domain",
	  "Repository -> Domain"
	]
  }
}
```

For the SpOTT codebase, use `config/architecture_scan/spott.json`:

```bash
npm run analyze:architecture -- sqlite/Graph.sqlite --include-depends-on \
  --architecture-config=config/architecture_scan/spott.json \
  --ignore-likely-false-positives --fail-on-violations
```

## Command

```bash
npm run analyze:architecture -- Graph.sqlite [--include-depends-on] [--ignore-likely-false-positives] [--architecture-config=<file>] [--json]
```

