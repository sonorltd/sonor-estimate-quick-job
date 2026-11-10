# Quick Job — Claude Code Context (v0.1.0)

> **Current version: v0.1.0** — 2026-11-10 BIRTH (Bryn: "easy way to quote small jobs like recent cctv maintenance or tv installs" · chose "Own app in Estimates family" · "build a template and we sort that after"). Small jobs quoted in two minutes: pick recipes → answer 2–4 questions → real WeQuote product lines → **Create WeQuote quote** (or push the missing lines into the quote it made). Roadmap: Claude Doc "Survey to quote roadmap" (Quick lane).

> **Spine version: 1.3** (SONOR-APP-SPINE.md — SonorShell-mounted, graphite)
> Inherits: `../CLAUDE.md` (master brand rules + cross-project references)
> Brand source: `../Branding - CORE/brand-core.xml`
> Repo: `sonor-estimate-quick-job` (to create) · Pages: https://apps.sonor.co.uk/sonor-estimate-quick-job/
> **Active theme: graphite** — back-end default (sonor-platform §2).

## What this is
The **Quick lane** of the Estimates family (Master Hub section "Business"). Not a budget PDF like the other estimates: the
output is the WeQuote quote itself. WeQuote stays the price SSOT — the app never sends a price; WeQuote's catalogue sell applies.

## Files
| File | What |
|---|---|
| `dashboard/sonor-estimate-quick-job.html` | host page (SonorShell, project bar, inline app-local layout CSS) — `APP_VERSION` bump site 1 |
| `data/quick-job-app.js` | app-local UI + recipe maths (`QuickJobApp._test` exposes env / linesOf / sections / plan) |
| `data/estimate-quick-job-config.js` | built-in recipe template (kind `quick-job`) + `__ESTIMATE_APP_CONFIG__` |
| `supabase/migrations/20261110_quick_job_template_v0_1_0.sql` | the same template into `estimate_templates` (applied 2026-11-10) |
| everything else in `data/` | synced copies of the root masters (sync-everything.sh) |

## Recipe template (estimate_templates.kind = 'quick-job')
`{ version, job: {questions, lines}, recipes: [{ key, title, icon, service_nn, blurb, questions, lines }] }`
- question `{ key, label, type: choice|number|bool, options[{value,label}], default, min, max, when }` — a choice also sets
  `<key>_<value> = 1` for expressions (`when: 'bracket_flat'`); `!x` works in `when`.
- line `{ wq_product_id, label, qty (expr, default 1), when (expr), check (note until Bryn confirms), bundle (API adds it empty) }`.
- Expressions = `SonorEstimate.evalQty`. The table copy is used only when its version ≥ the built-in one (sonor-platform §6).
- **Edit recipes in the table row** (or bump the built-in + migration). Product ids must exist in `wq_products`; the app flags
  "not found" / "discontinued" / "bundle" / "check" per line.

## Data
- `estimates` rows, `kind = 'quick-job'`, one row per quick job (rev = next number on the project — the table is UNIQUE (project, kind, rev)).
  `inputs = { items: [{id, recipe, answers}], job: {travel, days} }`, `sections` = one per item + Travel with `rows [{wq_product_id, qty, label, check, bundle}]`,
  `metadata = { wq_push: {quote_id, quote_no, at, by, lines, created}, wq_customer_id?, notes, log[] }`. `estimate_link` RPC on first save.
- Reads `projects` (customer = `metadata.wequote_customer_id`, WeQuote project = `metadata.wequote_internal_id`), `estimate_templates`, `wq_products` (names).
- Push: `SonorWqPush.push(plan, { createQuote: {customer_id, description, project_id} })` → `wq-push` ≥ 1.4.0, slot `estimate-quick-job`.
  Plan = group "Quick job" → one area per item ("01 TV install"…) + "Travel"; same product merged per area. Re-push = delta (adds missing lines only).

## Not yet (IDEAS.md)
Board / Tasks entry on create · open from a Service Call (pre-filled) · new customer without a project · house prices in the preview once the WeQuote price mirror exists.

## Bump sites (5)
`APP_VERSION` in the host page · CHANGELOG.md · this file · `app_versions` row (shell self-report) · SESSION-LOG.
