# Tickets (local)

Put ticket text files here and pass the path to the analyzer:

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/my-ticket.txt \
  --scopes=php,js \
  --answers=ticket_topic:ui,change_includes:cms_ui
```

**Only `--ticket=path`** — path to a text file (relative or absolute).

```bash
--ticket=tickets/hero-layout.txt
--ticket=/path/to/jira-export.txt
```

All ticket files in this folder are **gitignored** (private). Only this README is tracked.

## Suggested ticket structure

Title, context, acceptance criteria, technical notes, edge cases.

## Intent (agents / CI)

Infer answers from the ticket text — do not use `unsure`:

```bash
--answers=ticket_topic:ui,change_includes:cms_ui
--answers=ticket_topic:queue,change_includes:queue_job
```

See `.cursor/skills/impactlens/SKILL.md` for agent workflow.
