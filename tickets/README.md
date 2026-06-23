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
--answers=ticket_topic:api,change_includes:api_field
--answers=ticket_topic:api,change_includes:mixed
```

See `.cursor/skills/impactlens/SKILL.md` for agent workflow.

## UI translations / config API expansion (e.g. `NEW-new.txt`)

These tickets describe **public API + module resolver + new CMS routes** — not another BaseConfig CMS form.

**Use:**

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/NEW-new.txt \
  --scopes=php,js \
  --answers=ticket_topic:api,change_includes:mixed \
  --non-interactive
```

**Do not use** `change_includes:cms_ui` — it ranks generic `baseConfigId` Vue forms (RssFeed, Token, Hotjar) instead of the translations stack.

With `ticket_topic:api` + `change_includes:mixed`, route anchoring should put **`GET config/ui-translations`** and the **`UiTranslationsController`** flow path at the top of the briefing. Symbol noise (unrelated `BaseConfig*` CMS forms, loose namespace matches) can still appear — verify against the anchors below.

1. `apps/spott-frontend/app/Http/Controllers/Api/V3/Config/UiTranslationsController.php`
2. `modules/ClientManagement/UiTranslations/Domain/UiTranslationsService.php`
3. `apps/spott-frontend/app/Http/Requests/V3/Config/UiTranslationsRequest.php`
4. `.cursor/plans/static_ui_translations_api_14ada0c0.plan.md` (or path in ticket)
5. `tests/ClientManagement/UiTranslations/`

Then:

```bash
npm run analyze:ai-context -- sqlite/Graph.sqlite \
  "SpOTTFrontend\Http\Controllers\Api\V3\Config\UiTranslationsController::__invoke" \
  --compact
```

**Expect many acceptance-criteria items to be net-new** (CMS skeleton/preview/meta/hotfix routes, Artisan `ui-translations:*`, Git `structure.partials/`). The graph reflects today's implementation, not the full BDD spec.
