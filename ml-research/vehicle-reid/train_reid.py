"""Fase 2 — Domain fine-tune (metric learning), TransReID / CLIP-ReID style.

Fine-tunes a frozen-backbone + trainable projection head on the auto-labeled identities using
a PK-balanced sampler and a triplet loss with hard-negative mining. Backbone is DINOv3 by
default, mostly frozen (cheap, robust at our data scale). Produces a checkpoint; re-embed with
a small wrapper and re-run eval_retrieval.py to measure the lift over the zero-training baseline.

This is a GPU script. It is intentionally a clean, runnable skeleton — tune epochs/lr/P/K and
unfreeze depth on a real box.

Usage:
    python train_reid.py --manifest data/manifest.parquet --out data/reid_finetuned.pt
"""
from __future__ import annotations

import argparse
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import AutoImageProcessor, AutoModel

from embed_baseline import DEFAULT_MODEL

try:
    from pytorch_metric_learning import losses, miners
except ImportError:  # keep the file importable without the heavy dep installed
    losses = miners = None


class CropDataset(Dataset):
    def __init__(self, df: pd.DataFrame, data_root: Path, processor):
        self.df = df.reset_index(drop=True)
        self.data_root = data_root
        self.processor = processor
        self.id_to_label = {ident: i for i, ident in enumerate(sorted(df["identity_id"].unique()))}

    def __len__(self):
        return len(self.df)

    def __getitem__(self, i):
        row = self.df.iloc[i]
        img = Image.open(self.data_root / row["crop_path"]).convert("RGB")
        pixel = self.processor(images=img, return_tensors="pt")["pixel_values"][0]
        return pixel, self.id_to_label[row["identity_id"]]


class PKSampler(torch.utils.data.Sampler):
    """Each batch = P identities x K crops (standard for triplet ReID training)."""

    def __init__(self, labels: list[int], p: int, k: int, batches: int):
        self.p, self.k, self.batches = p, k, batches
        self.by_label: dict[int, list[int]] = defaultdict(list)
        for idx, lab in enumerate(labels):
            self.by_label[lab].append(idx)
        self.labels = [l for l, idxs in self.by_label.items() if len(idxs) >= 2]

    def __iter__(self):
        for _ in range(self.batches):
            chosen = random.sample(self.labels, min(self.p, len(self.labels)))
            for lab in chosen:
                pool = self.by_label[lab]
                pick = random.choices(pool, k=self.k) if len(pool) < self.k else random.sample(pool, self.k)
                yield from pick

    def __len__(self):
        return self.batches * self.p * self.k


class ReIDModel(torch.nn.Module):
    def __init__(self, backbone_id: str, emb_dim: int = 512, unfreeze_last: int = 2):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(backbone_id)
        hidden = self.backbone.config.hidden_size
        # Freeze everything, then optionally unfreeze the last few encoder layers.
        for p in self.backbone.parameters():
            p.requires_grad = False
        layers = getattr(getattr(self.backbone, "encoder", None), "layer", None)
        if layers is not None and unfreeze_last > 0:
            for layer in layers[-unfreeze_last:]:
                for p in layer.parameters():
                    p.requires_grad = True
        self.head = torch.nn.Sequential(
            torch.nn.Linear(hidden, emb_dim), torch.nn.BatchNorm1d(emb_dim)
        )

    def forward(self, pixel_values):
        out = self.backbone(pixel_values=pixel_values)
        feat = out.pooler_output if getattr(out, "pooler_output", None) is not None \
            else out.last_hidden_state.mean(dim=1)
        return torch.nn.functional.normalize(self.head(feat), dim=-1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, default=Path("data/manifest.parquet"))
    ap.add_argument("--data-root", type=Path, default=Path("data"))
    ap.add_argument("--out", type=Path, default=Path("data/reid_finetuned.pt"))
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--p", type=int, default=16, help="identities per batch")
    ap.add_argument("--k", type=int, default=4, help="crops per identity")
    ap.add_argument("--batches-per-epoch", type=int, default=200)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    if losses is None:
        raise SystemExit("pip install -r requirements-ml.txt (pytorch-metric-learning missing)")

    df = pd.read_parquet(args.manifest)
    df = df[df["split"] == "train"].reset_index(drop=True)
    print(f"Training on {len(df)} crops / {df['identity_id'].nunique()} identities (train split).")

    processor = AutoImageProcessor.from_pretrained(args.model)
    ds = CropDataset(df, args.data_root, processor)
    labels = [ds.id_to_label[i] for i in df["identity_id"]]
    sampler = PKSampler(labels, args.p, args.k, args.batches_per_epoch)
    loader = DataLoader(ds, batch_size=args.p * args.k, sampler=sampler, num_workers=4, drop_last=True)

    model = ReIDModel(args.model).to(args.device)
    loss_fn = losses.TripletMarginLoss(margin=0.3)
    miner = miners.MultiSimilarityMiner()
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr)

    model.train()
    for epoch in range(args.epochs):
        running = 0.0
        for pixel, lab in loader:
            pixel, lab = pixel.to(args.device), lab.to(args.device)
            emb = model(pixel)
            loss = loss_fn(emb, lab, miner(emb, lab))
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += loss.item()
        print(f"epoch {epoch + 1}/{args.epochs}  loss={running / args.batches_per_epoch:.4f}")

    torch.save({"model": args.model, "state_dict": model.state_dict()}, args.out)
    print(f"Saved checkpoint -> {args.out}")
    print("Next: write a small re-embed loop using ReIDModel, then re-run eval_retrieval.py.")


if __name__ == "__main__":
    main()
