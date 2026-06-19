"""Fase 1 — Zero-training embeddings.

Runs every crop through a frozen foundation backbone (DINOv3 by default) and stores L2-
normalized embeddings + parallel metadata arrays in a single .npz. No training here — this
gives the performance *floor* and validates the whole idea cheaply.

Usage:
    python embed_baseline.py --manifest data/manifest.parquet --out data/embeddings_dinov3.npz
    python embed_baseline.py --model facebook/dinov3-vitb16-pretrain-lvd1689m ...

Swap --model for any HF image backbone (e.g. a SigLIP/CLIP id) to compare.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from tqdm import tqdm
from transformers import AutoImageProcessor, AutoModel

# DINOv3 ViT-B/16. If this exact id is unavailable in your environment, set --model to the
# correct hub id (DINOv3 was released Aug 2025); SigLIP2 / CLIP ids also work as comparisons.
DEFAULT_MODEL = "facebook/dinov3-vitb16-pretrain-lvd1689m"


@torch.no_grad()
def embed_batch(model, processor, images: list[Image.Image], device: str) -> np.ndarray:
    inputs = processor(images=images, return_tensors="pt").to(device)
    out = model(**inputs)
    # Prefer a pooled vector; otherwise mean-pool the patch tokens (a robust global descriptor).
    if getattr(out, "pooler_output", None) is not None:
        feat = out.pooler_output
    else:
        feat = out.last_hidden_state.mean(dim=1)
    feat = torch.nn.functional.normalize(feat, dim=-1)
    return feat.cpu().numpy().astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=Path("data/manifest.parquet"))
    ap.add_argument("--data-root", type=Path, default=Path("data"),
                    help="root that crop_path in the manifest is relative to")
    ap.add_argument("--out", type=Path, default=Path("data/embeddings_dinov3.npz"))
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    df = pd.read_parquet(args.manifest)
    print(f"Embedding {len(df)} crops with {args.model} on {args.device} ...")

    processor = AutoImageProcessor.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model).to(args.device).eval()

    embeddings: list[np.ndarray] = []
    keep_idx: list[int] = []
    batch_imgs: list[Image.Image] = []
    batch_rows: list[int] = []

    def flush():
        if not batch_imgs:
            return
        embeddings.append(embed_batch(model, processor, batch_imgs, args.device))
        keep_idx.extend(batch_rows)
        batch_imgs.clear()
        batch_rows.clear()

    for i, row in tqdm(df.iterrows(), total=len(df), desc="embed"):
        try:
            img = Image.open(args.data_root / row["crop_path"]).convert("RGB")
        except OSError:
            continue
        batch_imgs.append(img)
        batch_rows.append(i)
        if len(batch_imgs) >= args.batch_size:
            flush()
    flush()

    emb = np.concatenate(embeddings, axis=0)
    kept = df.iloc[keep_idx].reset_index(drop=True)

    np.savez_compressed(
        args.out,
        embeddings=emb,
        image_id=kept["image_id"].to_numpy(),
        identity_id=kept["identity_id"].to_numpy(),
        execution_id=kept["execution_id"].to_numpy(),
        split=kept["split"].to_numpy(),
        visual_style=kept["visual_style"].fillna("").to_numpy(),
        model=np.array([args.model]),
    )
    print(f"Saved {emb.shape} embeddings -> {args.out}")


if __name__ == "__main__":
    main()
