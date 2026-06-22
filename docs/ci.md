# CI Integration

ImpactLens supports fail flags so pipelines can block merges when issues are found.

## Fail flags

| Flag | Command | Exits with code `1` when |
|---|---|---|
| `--fail-on-cycles` | `analyze:cycles` | At least one cycle exists |
| `--fail-on-violations` | `analyze:architecture` | At least one architecture violation exists |
| `--fail-on-dead-code` | `analyze:dead-code` | At least one dead method exists |

## Example commands

```bash
npm run analyze:cycles -- Graph.sqlite --fail-on-cycles
npm run analyze:architecture -- Graph.sqlite --fail-on-violations
npm run analyze:architecture -- Graph.sqlite --ignore-likely-false-positives --fail-on-violations
npm run analyze:architecture -- Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives --fail-on-violations
npm run analyze:dead-code -- Graph.sqlite --fail-on-dead-code --json --output=dead-code.json
```

## GitHub Actions example

```yaml
name: Code Analysis

on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm install

      - name: Scan project
        run: npm run scan -- src --output=sqlite --sqlite-path=Graph.sqlite

      - name: Check for cycles
        run: npm run analyze:cycles -- Graph.sqlite --fail-on-cycles

      - name: Check architecture
        run: npm run analyze:architecture -- Graph.sqlite --architecture-config=config/architecture_scan/spott.json --ignore-likely-false-positives --fail-on-violations

      - name: Check dead code
        run: npm run analyze:dead-code -- Graph.sqlite --fail-on-dead-code --output=dead-code.txt

      - name: Upload dead code report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: dead-code-report
          path: dead-code.txt
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Analysis finished and no fail condition matched |
| `1` | Fail condition matched (`--fail-on-*`) |
| `2` | Usage error (invalid/missing arguments) |

## JSON in CI

You can still use fail flags with JSON output:

```bash
npm run analyze:cycles -- Graph.sqlite --json --fail-on-cycles --output=cycles.json
```

This keeps machine-readable artifacts while preserving correct CI status.

Tip: use `--ignore-likely-false-positives` when framework HTTP namespaces (for example `Illuminate\\Http` or `Psr\\Http`) create known non-actionable architecture noise.

