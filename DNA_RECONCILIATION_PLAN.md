# Visual-DNA Consistency & Smart Correction Propagation — Implementation Plan

> Status: **PLAN (pending approval + phased build on an isolated worktree)**. Generated 2026-06-09 by a multi-agent ultraplan (4 code-mappers + 3 designers) grounded in the current desktop code. Owner decisions captured at the end.

## 0. Goal & cardinal rules

Catch (and where safe, fix) the case where a read race number is matched to a participant but the car's **visual DNA (make / model / livery / color)** contradicts it — *probabilistically*, by leveraging the **many similar shots of the same car in one execution**. Plus let the user **propagate a manual correction to similar results** in one move.

**Cardinal rules (non-negotiable):**
1. **Race number is the PRIMARY KEY; DNA is VALIDATION.** Never flip a number solely on DNA. DNA can *demote to review* or, only in unambiguous cases, *propose* an auto-correction.
2. **Avoid BOTH frustrations:** (a) the silent wrong "Matched" the user must catch by eye, AND (b) crying wolf with false `needs_review`. Honesty about confidence over false confidence.
3. **Face recognition is OUT OF SCOPE** (premature, travels separately, not always populated).
4. **Measure before trusting.** No veto/demote ships until a benchmark proves it (P0 gate).
5. **Feature-gated, default OFF.** Zero risk to the imminent release; tunable per sport via `sport_categories.matching_config` (no code deploy).

## 1. Architecture — three phases at finalize

The existing pipeline already has a **temporal second-pass** (`unified-image-processor.ts` ~line 9300-9450, `rescoreVehiclesWithTemporalMultiConfirm`) that groups bursts by race number and flips uncertain numbers to the confirmed consensus. We hang the new work AFTER it:

```
finalize()
  → [existing] TEMPORAL SECOND-PASS  → finalized race_number per image (numbers corrected FIRST)
  → [NEW] DNA CONSENSUS              → per number, confidence-weighted majority vote on make/model/livery → canonical DNA + outliers
  → [NEW] FINAL RE-CHECK             → per detection: detected DNA vs canonical/expected → KEEP | DEMOTE_TO_REVIEW | AUTO_CORRECT
  → DB flush + JSONL upload
  → REVIEW LAYER reads it: re-rank candidates by DNA coherence, surface mismatches, offer propagation
```

**Why this order solves the chicken-and-egg:** clustering happens by number *after* the number is corrected, so a misread can't poison the cluster. DNA consensus is **read-only validation** — it does NOT re-flip numbers.

### 1.1 Canonical DNA (probabilistic voting)
Per race-number cluster: confidence-weighted majority vote over make / model / liveryPrimary across the last *N* images (`dnaVotingWindow`, default 5). Output `{value, confidence, voteCount}` per field + an `outliers[]` list (images whose DNA diverges from the consensus, flagged not deleted).

### 1.2 Final re-check — graduated response
| Situation | Response | What the user sees |
|---|---|---|
| Detected DNA aligns with canonical | **KEEP** | unchanged |
| DNA contradicts the number AND no clearly-better DNA-consistent alternative | **DEMOTE_TO_REVIEW** | moves to `needs_review`, candidates re-ranked with the DNA-consistent one first, model/livery shown as **context** (not accusation) |
| DNA contradicts AND exactly one DNA-consistent alternative whose number is a plausible OCR confusion, within the `clearWinner` score gap | **AUTO_CORRECT** (gated, default off) | number flipped with a transparent "auto-corrected #X→#Y (DNA)" note |

This is the resolution of the "why didn't you fix it yourself?" frustration: when the app is **not** confident, it stops claiming "Matched" and moves the photo to review (where showing the model is *helpful*); it only auto-fixes when genuinely unambiguous.

## 2. Smart correction propagation ("apply to similar")
After a manual correction (gallery resolve or edit), compute client-side **similarity** to other results and offer a modal: *"Found N photos similar to this correction — apply to all? / quick-select."* Reuses the **WF-01 bulk multi-select** infra (a second bulk-bar button: "Apply correction to selected").

- **Similarity score** (0–100, threshold ~70): same number (+40), same team (+20), same make (+15 if confident), same livery (+15 if confident), same scene (+5), temporal burst (+5); degrade for low-confidence DNA on the target.
- **Never silent:** modal previews exactly what changes per file; pre-checks only high-similarity items; user can uncheck. Optional 30s undo.
- **Low-confidence guard:** if the source DNA confidence is weak, propagate only number/team/drivers (not DNA); never override a target's detected DNA with an uncertain one.
- Persisted as a batch via `update-analysis-log` / a new `propagate-corrections` IPC, with `propagation_info` (source, similarity, batch id) in the JSONL for audit.

## 3. No-code tuning (`sport_categories.matching_config`)
New OPTIONAL fields (defaults conservative): `dnaVotingWindow` (5), `dnaOutlierZScore` (2.0), `dnaContradictionThreshold` (−15/−20), `enableDNAContradictionDemote` (false), `preferDNAOverNumber` (false), `propagation_similarity_threshold` (70). Motorsport stricter (static liveries), cycling looser (jersey variance), running n/a.

## 4. Measurement gate (P0 — prerequisite for everything)
Extend the benchmark to PROVE the signals are trustworthy before any veto ships. Gates that MUST hold to proceed:
- **DNA field population ≥ 75%** (V6 returns make/model/livery this often)
- **Make/model/livery accuracy ≥ 70%** vs ground truth (confusion matrix)
- **Temporal coherence ≥ 90%** (same-car burst agrees on DNA)
- **Propagation safety: < 2% false-positive** (simulated propagations that flip a correct match to wrong)
- **Perf regression < 100 ms** added to finalize for a 1k-image batch
- **Legacy JSONL loads without exceptions** (backward compat)

If any gate misses → reopen design, no P1.

## 5. Phased plan (each phase: gated, reversible, behind a config flag)

| Phase | What | Key files | Gate to proceed | Rollback |
|---|---|---|---|---|
| **P0** | Benchmark: measure DNA accuracy, population, temporal coherence, propagation safety | `tests/performance/*`, new ground-truth dataset, `benchmark-helpers` | metrics in §4 | delete branch |
| **P1** | Conservative **demote-to-needs-review** on DNA contradiction (Hooks A/B/E) | `smart-matcher.ts`, `sport-config.ts`, `unified-image-processor.ts` | <5% false demotion, ≥80% of demotions actually wrong, no match-rate regression | `enableDNAContradictionDemote=false` |
| **P2** | **Propagation UI** ("apply to similar" + WF-01 bulk extension) | `log-visualizer.js`, `analysis-handlers.ts`, `preload.ts`, `analysis-logger.ts` | ≥2 similar/correction, ≤3% propagation FP, ≥40% engagement | hide modal via flag |
| **P3** | **DNA consensus voting** + outlier surfacing + optional **auto-correct** + "Learn DNA" | `smart-matcher.ts`, `unified-image-processor.ts`, `log-visualizer.js`, preset handler | ≥95% consensus derived, ≥80% outlier accuracy, <1% auto-correct FP | `enableDNAConsensus=false` |

Data model: new fields are **optional JSONB** on `analysis_results.raw_response` + a `DNA_CONSENSUS` JSONL event (backward compatible). Optional remote table `temporal_dna_consensus` for cross-event seeding (future).

## 6. Worktree / git strategy
**Current state:** branch `fix/exiftool-execfile-spaces-147`, working tree MIXES this session's Gruppe-C work + an ExifTool fix + ~458 regenerated `vendor/win32` files — **all uncommitted**. An `rt-184-wt` worktree pattern exists (node_modules **junction**, removed with `rmdir` BEFORE worktree removal).

**Recommended (hybrid):**
1. **Secure the current work first** (it's the release candidate) — commit it on the current branch (optionally split ExifTool vs Gruppe-C). This also gives the worktree a clean base that includes the WF-01 infra P2 builds on.
2. **P0 + P1 on an isolated worktree** off that base (`git worktree add ../racetagger-dna feature/dna-reconciliation`), node_modules via junction. Release branch stays untouched.
3. **P2 + P3** as sequential branches once P1 is merged and stable.

## 7. Decisions for Federico
1. **Git base** (immediate): commit the current working tree as the release candidate first, then worktree off it? (recommended) — vs worktree off clean HEAD — vs you handle the release commit and tell me the base.
2. **Start with P0 benchmark** (measure first) before any matcher change? (recommended)
3. **Preset DNA vs image-derived DNA conflict** (later, P1): when the start-list says #42=Ferrari but the images consistently say Porsche, do we trust the **images** (derived consensus) and demote, or trust the **preset**? (recommendation: surface as review, let the user decide / "Learn DNA").
4. **Auto-correct (P3)**: keep it gated OFF until P1/P2 are battle-tested? (recommended)

---
*Full pseudo-code, candidate-card mockups, similarity-scoring, IPC shapes, CSS, and per-phase commit plan are in the ultraplan workflow output and will be expanded in the worktree as each phase starts.*
