"""Fase 1/2 — Retrieval evaluation (the decision gate).

Protocol = WITHIN-EVENT re-identification, matching the product scope:
  for each query crop, the gallery is the OTHER crops of the SAME event; a hit is a gallery
  crop with the same identity (event+number). We report Rank-1, Rank-5 and mAP, overall and
  stratified by `visual_style` (e.g. motion blur / panning) to expose where it breaks.

Works on any embeddings .npz produced by embed_baseline.py (baseline or fine-tuned).

Usage:
    python eval_retrieval.py --embeddings data/embeddings_dinov3.npz
    python eval_retrieval.py --embeddings data/embeddings_dinov3.npz --split test
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict

import numpy as np


def average_precision(hits: np.ndarray) -> float:
    """AP for a single ranked list of boolean relevance (descending similarity)."""
    n_rel = int(hits.sum())
    if n_rel == 0:
        return 0.0
    ranks = np.arange(1, len(hits) + 1)
    precision_at_hits = np.cumsum(hits) / ranks
    return float((precision_at_hits * hits).sum() / n_rel)


def evaluate(emb, ident, event, mask) -> dict:
    """Within-event retrieval metrics over the rows selected by `mask`."""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return {"queries": 0}

    # Group selected rows by event so each query only ranks its own event's gallery.
    by_event: dict[str, list[int]] = defaultdict(list)
    for i in idx:
        by_event[event[i]].append(i)

    r1 = r5 = ap_sum = 0.0
    n_queries = 0
    for _, members in by_event.items():
        if len(members) < 2:
            continue
        members = np.array(members)
        sub_emb = emb[members]
        sub_ident = ident[members]
        sims = sub_emb @ sub_emb.T  # cosine (embeddings are L2-normalized)
        np.fill_diagonal(sims, -np.inf)  # exclude the query itself

        for q in range(len(members)):
            relevant = sub_ident == sub_ident[q]
            relevant[q] = False
            if not relevant.any():
                continue  # singleton identity within this event's selection
            order = np.argsort(-sims[q])
            ranked_hits = relevant[order]
            r1 += float(ranked_hits[0])
            r5 += float(ranked_hits[:5].any())
            ap_sum += average_precision(ranked_hits)
            n_queries += 1

    if n_queries == 0:
        return {"queries": 0}
    return {
        "queries": n_queries,
        "Rank-1": round(r1 / n_queries, 4),
        "Rank-5": round(r5 / n_queries, 4),
        "mAP": round(ap_sum / n_queries, 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--embeddings", required=True)
    ap.add_argument("--split", default="test", choices=["train", "val", "test", "all"])
    args = ap.parse_args()

    d = np.load(args.embeddings, allow_pickle=True)
    emb = d["embeddings"].astype(np.float32)
    ident = d["identity_id"].astype(str)
    event = d["execution_id"].astype(str)
    split = d["split"].astype(str)
    vstyle = d["visual_style"].astype(str)

    base_mask = np.ones(len(emb), bool) if args.split == "all" else (split == args.split)

    print(f"Model: {d['model'][0]}  |  split={args.split}  |  rows={int(base_mask.sum())}")
    overall = evaluate(emb, ident, event, base_mask)
    print("\n=== Overall (within-event) ===")
    print(json.dumps(overall, indent=2))

    # Stratify by individual visual_style tags (hard cases live here).
    tags = ["motion blur", "panning", "side view"]
    print("\n=== Stratified by visual_style ===")
    for tag in tags:
        has_tag = np.array([tag in v for v in vstyle])
        m = base_mask & has_tag
        res = evaluate(emb, ident, event, m)
        print(f"[{tag:>12}] {json.dumps(res)}")


if __name__ == "__main__":
    main()
