# Change Impact Analysis

## What does Change Impact answer?

- Who will be affected if I change this method?
- Which files are involved?
- Which methods depend on it?
- Which methods does it depend on?
- How risky is the change?

Change Impact is designed to answer practical review questions before you refactor or merge.

## Run it

```bash
npm run analyze:change-impact -- Graph.sqlite "App\Services\UserService::create"
```

Useful options:

```bash
npm run analyze:change-impact -- Graph.sqlite "App\Services\UserService::create" --depth=3 --limit=10 --decay=0.5 --verbose
npm run analyze:change-impact -- Graph.sqlite "App\Services\UserService" --include-depends-on
npm run analyze:change-impact -- Graph.sqlite "App\Services\UserService::create" --json --output=change-impact.json
```

## How to read the output

### Risk and score

- `risk` is the headline signal: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- `score` is a relative impact score used to derive risk.
- Use risk for quick triage; use score/components for deeper inspection.

### Risk levels

| Level | Meaning |
|---|---|
| `LOW` | Small local change. |
| `MEDIUM` | Multiple callers or dependencies affected. |
| `HIGH` | Core functionality may be affected. |
| `CRITICAL` | Large blast radius across multiple components. |

## Key fields

- `affectedCallers`: methods that depend on this target (upstream impact).
- `methodsUsedByTarget`: methods called by this target (downstream usage).
- `affectedFiles`: number of distinct files touched by the impact graph.
- `affectedFilesList`: full file list (shown in CLI with `--verbose`).

## Component breakdown

- `directCallers`: immediate callers of the target.
- `indirectCallers`: callers of callers (within selected depth).
- `directCallees`: immediate methods used by the target.
- `dependencyLinks`: constructor dependency edges involved.
- `inheritanceLinks`: inheritance/interface edges involved.

Score companion fields:

- `directCallerScore`
- `indirectCallerScore`
- `directCalleeScore`
- `dependencyScore`
- `inheritanceScore`

These help explain why a target got a specific risk level.

## Practical interpretation

- High `directCallers` + high `directCallerScore` means change can break many consumers quickly.
- High `indirectCallers` means wider ripple effects.
- High `directCallees` means more downstream checks and integration testing.
- Non-zero `dependencyLinks` or `inheritanceLinks` means structural coupling should be reviewed.

## Example

```text
Blast radius
risk: MEDIUM
score: 14 (relative impact score)
affected callers: 2
methods used by target: 3
affected files: 4

Affected callers
- UserController::show
- UserRepository::badPresentationCoupling

What this method uses
- EventService::record
- UserService::ping
- UserRepository::save
```

## Tips for everyday engineering use

- Use `--depth=2` for quick reviews and pull requests.
- Use `--depth=3`+ for risky core service changes.
- Enable `--include-depends-on` for dependency-injection-heavy projects.
- Keep `--json` output as build artifact for auditability in CI.

