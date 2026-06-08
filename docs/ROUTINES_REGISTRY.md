# Routines Registry — RaceTagger

> Fonte unica per **non confondere** le routine Claude man mano che crescono.
> Ogni routine ha un **ID univoco** (`trig_…` per le remote cloud) → il `/fire` colpisce sempre quella giusta.
> Qui teniamo traccia di chi-fa-cosa e chi-lancia-chi. Aggiorna questa tabella quando ne crei/ritiri una.

## Convenzioni

- **Nome (cloud / claude.ai/code):** prefisso `RaceTagger · <Scopo> (<remote|local>)`.
- **`agent_name`** nei log (`agent_decisions` / `support_triage_runs`): `<scopo>-routine-<remote|local>`.
- **Secret per-routine** (mai generici): `<SCOPO>_FIRE_URL` / `<SCOPO>_FIRE_TOKEN`. Il token sta **solo** nei secret (Supabase/env), mai in chiaro/in repo. Se esposto → **rigenerare**.
- **Payload `/fire` strutturato** (auto-descrittivo, tracciabile): nel campo `text`
  ```
  TRIGGER source=<chi-lancia> mode=<modalità> ticket_id=<uuid?> github_issue_number=<n?> repo=<owner/repo>
  ```
  La routine parsa questa riga: se presente → fire MIRATO (lavora solo quel target); se assente → run schedulata/manuale (scansione coda).

## Routine attive / pianificate

| Routine | ID / dove | Trigger | Schedule | Lanciata da | `agent_name` | Scope | Secret | Stato |
|---|---|---|---|---|---|---|---|---|
| **Support Triage (remote)** | `trig_01CcMYgKvLyBkk58zTpoX7sD` (cloud) | API `/fire` (evento) | — (event-driven; cron opz. ≥1h) | EF `support-triage` / `support-followup-submit` su nuovo ticket | `triage-routine-remote` | Ticket clienti `user-feedback` → **pipeline** (`support_triage_runs` → `pending_review` → portale → Brevo) | `SUPPORT_TRIAGE_FIRE_URL`, `SUPPORT_TRIAGE_FIRE_TOKEN` | ⏳ da cablare (EF) + prompt aggiornato |
| **Issue Triage (local mirror)** | task locale `~/.claude/scheduled-tasks/issue-triage-local/SKILL.md` | manuale / cron locale | da definire (es. 15-30 min) | Federico / scheduler locale (PC acceso) | `triage-routine-local` | Backlog `[AUTO]`/`[BUG]`/`[FEATURE]` + fix dal working tree live (draft PR) | — (auth locale: Supabase/gh/Gmail) | 🟡 dry-run/manuale, non schedulata |

Prompt condiviso da entrambe: [`ISSUE_TRIAGE_ROUTINE.md`](./ISSUE_TRIAGE_ROUTINE.md) (ibrido). Differiscono per `agent_name` + scope; l'idempotenza (<15 min) impedisce che si sovrappongano.

## Altre automazioni correlate (NON routine Claude — per contesto)

| Cosa | Tipo | Stato | Note |
|---|---|---|---|
| `claude.yml` (`@claude`) | GitHub Action | ✅ resta | risponde alle menzioni `@claude` |
| `claude-code-review.yml` | GitHub Action | ✅ resta | review automatica sui PR |
| `report-automatic-error` + `error-telemetry-service` | EF + desktop | ✅ resta | crea le issue `[AUTO]` (input della routine) |
| `backlog-autopilot-{sweep,implement}.yml` | GitHub Action | 🔴 disattivate 2026-06-08 (`if:false` + cron commentato) | sostituite dalla routine; reversibili |
| `claude-issue-triage.yml` / `claude-issue-pr.yml` | GitHub Action | ⏳ da ritirare dopo cutover routine | il cervello passa alla routine; livello cliente (portale/Brevo) resta |

## Come aggiungere una nuova routine (checklist anti-confusione)

1. Creala nel cloud con **nome convenzionale** `RaceTagger · <Scopo> (remote)`; annota l'**ID** `trig_…`.
2. Assegna un `agent_name` univoco e usalo in **ogni** log.
3. Secret per-routine `<SCOPO>_FIRE_URL/TOKEN` (Supabase secrets).
4. Definisci `source`/`mode` del payload `TRIGGER` e chi la lancia.
5. **Aggiungi una riga** alla tabella qui sopra. Se le routine diventano molte, valuta di promuovere questo registro a una tabella Supabase `routines` consultabile da EF/portale.
