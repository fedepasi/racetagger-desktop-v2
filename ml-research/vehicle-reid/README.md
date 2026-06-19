# Vehicle Re-Identification — R&D feasibility study

> **What this is.** A self-contained Python research harness to test whether RaceTagger can
> build a *re-identification* (ReID) system: given ONE reference photo of a vehicle, retrieve
> **all** other photos of the **same** vehicle within the same event, robust to angle / light /
> color changes. This directory does **not** touch the production app (`src/`). It reads from
> the production DB **read-only** and writes only to a local `data/` workspace.

See the full plan at the repo root planning notes. TL;DR of the approach: ReID is a
**metric-learning + embedding-retrieval** problem, **not** an LLM problem. The "memory game"
intuition (one reference → find all matches) is content-based image retrieval with a learned
embedding and nearest-neighbour search, fused with the structured signals RaceTagger already
extracts (number, livery, sponsors, team, temporal clustering).

## Why this is feasible — the data (measured 2026-06-19, production DB)

The key realization: **identity labels already exist for free**. Two crops are "the same
vehicle" when they share the same *event* (`images.execution_id`) **and** the same
*recognized race number* (`analysis_results.recognized_number`). No manual labeling.

Measured on the live DB (`confidence_level IN ('HIGH','manual')`):

| Metric | Value |
|---|---:|
| Images total | 332,017 |
| Analyses with a recognized number | 270,626 |
| Distinct events (`execution_id`) | 1,690 |
| **(event, number) identities** | **49,217** |
| Identities with ≥2 photos (positives possible) | **27,336** |
| Identities with ≥5 photos | 11,625 |
| Events usable for ReID (≥1 multi-photo identity) | 1,106 |
| **Labeled images inside multi-photo identities** | **211,135** |
| **Auto-generated positive pairs** | **~2,353,322** |

For scale context, this is **larger than standard ReID benchmarks**: VeRi-776 (~50k images /
776 vehicles), Market-1501 (~32k / 1,501 ids). We have ~211k images across ~27k identities —
**enough to seriously fine-tune a backbone**, not just run a zero-shot baseline.

## Frontier models used (verified web, Jun 2026)

- **DINOv3** (Meta, Aug 2025) — SOTA self-supervised ViT. High-quality global **and** dense
  (region-level) features out of the box → the embedding backbone. `embed_baseline.py`.
- **SAM 3 / 3.1** (Meta, Nov 2025) — Promptable Concept Segmentation (text prompt
  "race car"/"motorcycle"); open-vocabulary, tracks all instances. Optional cleaner crops in
  `export_dataset.py` (`--crop-source sam3`). Default uses the bboxes already in the DB.
- **TransReID / CLIP-ReID** — the metric-learning recipe (triplet + ID/ArcFace loss) for the
  domain fine-tune. `train_reid.py`.

## Pipeline (each script is a gate)

```
export_dataset.py   Fase 0  DB → manifest (identities) → download images → crop → split-by-event
embed_baseline.py   Fase 1  crops → DINOv3 embeddings (zero training) → FAISS index
eval_retrieval.py   Fase 1  Rank-1 / Rank-5 / mAP on per-event held-out queries (+ stratified by visualStyle)
train_reid.py       Fase 2  metric-learning fine-tune on auto-labeled pairs → re-embed → re-eval
fusion_poc.py       Fase 3  (todo) fuse embedding score with number/livery/sponsor/temporal
```

The decision gate: if Fase 1 (zero-training DINOv3) already gives strong Rank-1/mAP, the
feature is viable immediately; Fase 2 quantifies how much domain fine-tuning adds.

## Setup

```bash
cd ml-research/vehicle-reid
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # add -r requirements-ml.txt on a GPU box

# Read-only DB + storage access (service role key, never commit it)
export SUPABASE_DB_URL="postgresql://...:5432/postgres"   # pooler/direct connection string
export SUPABASE_URL="https://taompbzifylmdzgbbrpv.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
```

## Run

```bash
# Fase 0 — build a manageable subset first (e.g. 50 events, ≥3 photos/identity)
python export_dataset.py --max-events 50 --min-per-identity 3 --out data/

# Fase 1 — zero-training baseline (GPU recommended; CPU works for small subsets)
python embed_baseline.py --crops data/crops --out data/embeddings_dinov3.npz
python eval_retrieval.py --embeddings data/embeddings_dinov3.npz --manifest data/manifest.parquet

# Fase 2 — domain fine-tune, then re-eval with the same eval_retrieval.py
python train_reid.py --crops data/crops --manifest data/manifest.parquet --out data/reid_finetuned.pt
```

## Honest caveats

- **Scope = within-event.** Cross-event / cross-season (same physical car, different livery)
  is out of scope — much harder, treat as later R&D.
- **Auto-labels are noisy** (OCR errors). We filter to `HIGH`/`manual` confidence; the eval
  set should be spot-checked.
- **No data leakage:** the train/val/test split is **by event** (`split_by_event`). Never let
  the same event appear in both train and test.
- **Hard cases** are real and present in the data (`visualStyle` tags: `panning`,
  `motion blur`) — `eval_retrieval.py` reports metrics stratified by these so we see where it
  breaks.
- Storage egress: downloading 211k full images is heavy. Always start with `--max-events`.
