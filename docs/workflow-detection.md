# Workflow detection

Before ranking components, the ticket analyzer scores **workflow types** from ticket text and picks a dominant one (with confidence). That prevents secondary keywords (`status`, `api`, `content`) from overriding the primary signal.

## Supported workflows

| Type | Typical signals |
|---|---|
| Queue / event | sqs, queue, listener, consumer, job, filepath |
| API | post, put, endpoint, controller, request body |
| Import / feed | csv, xml, feed, import, transformer |
| Cron / scheduled | cron, daily, schedule, recurring |
| UI / CMS | ui, form, cms, button, hero, preset, frontend |
| Migration | migrate, schema, alter table |
| Background job | worker, async, process |

## Confidence

| Condition | Confidence |
|---|---|
| Dominant > secondary × 2.5 | 0.95 |
| Dominant > secondary × 1.5 | 0.75 |
| Dominant > secondary | 0.60 |
| Tie / unclear | 0.40 |

## Entrypoint filtering (high confidence)

Once a workflow dominates, entrypoint candidates are filtered:

- **Queue**: `handle`, job, listener, consumer — not controllers
- **API**: controller, store, update — not background jobs
- **UI**: Vue components, setup, frontend paths — not search/index plumbing
- **Import**: import, transformer, parse

Low confidence (< 0.6) uses loose filtering with mild boosts only.

## Examples

**SQS processing**

```text
"Process S3 files via SQS queue; update content status."
→ Queue (0.95) → Job/Listener handle(), not Controller
```

**CMS hero layout**

```text
"Hero Teaser preset — position summary, frontend display rules."
→ UI (0.80) → heroTeaser/index.vue, SlidePreset components
```

**REST endpoint**

```text
"POST /api/v3/editorial with image attachments."
→ API (0.95) → Controller store/update
```

## Implementation

- Signals: `src/analyzers/ticket/ticketWorkflow.ts`
- Integration: `analyzeTicket()` in `ticketAnalyzerV3.ts`
- Tests: `ticketAnalyzerV3.test.ts`, `ticketSession.test.ts`
