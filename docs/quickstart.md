# Quickstart

Everything you need once. No hunting through other docs.

## 1. Install

**In your project** (recommended — installs the `impactlens` CLI and Cursor agent skill):

```bash
npm install impactlens
# skill auto-written to .cursor/skills/impactlens/SKILL.md
impactlens --help
```

**Or clone this repo** for development:

```bash
git clone https://github.com/LucaDogaru1/ImpectLense.git
cd ImpectLense
npm install
```

Use `impactlens …` after npm install in a project, or `npm run scan` / `npm run analyze:ticket` when working from a clone.

## 2. Config (only if the target repo uses `@/` imports)

Create **`impactlens.config.json` at the scan root** (the repo you scan, not inside ImpactLens):

```json
{
  "pathAliases": {
    "@/": "apps/your-app/resources/assets/js/"
  }
}
```

Skip this if the project only uses relative imports (`../../api`).

If you use `@/` and skip this, Vue→API→controller links will be missing in the graph.

Details: [config.md](config.md) · [scan-config.md](scan-config.md)

## 3. Scan (once, re-run when the codebase changes a lot)

```bash
npm run scan -- /path/to/your-repo --lang=both --no-merge --output=both
```

Produces:

- `sqlite/Graph.sqlite` — used by all analyzers
- `Graph.json` — optional backup / inspect

**PHP only:** `--lang=php`  
**JS/Vue only:** `--lang=js`

## 4. Analyze a ticket (default = AI briefing)

```bash
npm run analyze:ticket -- sqlite/Graph.sqlite \
  --ticket=tickets/my-ticket.txt \
  --scopes=php,js
```

Output is a compact markdown briefing (read-first, flow paths, files to open). Paste into your AI tool.

| Flag | When |
|------|------|
| `--scopes=php,js` | Full-stack / CMS / Vue tickets |
| `--scopes=php` | Backend-only (queue, API, jobs) |
| `--full` | Debug ranking (raw matches — high token cost) |
| `--answers=ticket_topic:ui,change_includes:mixed` | Skip interactive prompts |

## 5. Deep dive one symbol (optional)

Pick something from **Read first** in the briefing:

```bash
npm run analyze:ai-context -- sqlite/Graph.sqlite \
  "App\\Services\\SomeService::method" --compact
```

---

## AI agents

Cursor loads `.cursor/skills/impactlens/SKILL.md` from this repo — same workflow as above.

**Developer:** steps 1–3 once per repo.  
**AI:** step 4 per ticket, step 5 only if needed.

---

## More detail (only if stuck)

| Doc | Why open it |
|-----|-------------|
| [config.md](config.md) | All config files explained |
| [scan-config.md](scan-config.md) | Alias examples, monorepo paths |
| [commands.md](commands.md) | All CLI flags |
| [ticket-analysis.md](ticket-analysis.md) | Session, workflows, flow paths |
