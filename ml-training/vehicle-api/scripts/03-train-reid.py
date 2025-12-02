#!/usr/bin/env python3
"""
03-train-reid.py

Train Vehicle ReID model using embedding-based learning.

Architecture:
- Backbone: ResNet50-IBN (from FastReID)
- Pooling: Generalized Mean (GeM)
- Embedding: 512 dimensions
- Loss: Triplet + ArcFace combination

Usage:
    python scripts/03-train-reid.py --config configs/reid_config.json
    python scripts/03-train-reid.py --dataset datasets/prepared/reid --epochs 50
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import Adam
from torch.optim.lr_scheduler import CosineAnnealingLR

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm
import albumentations as A
from albumentations.pytorch import ToTensorV2

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Default Configuration
# ============================================

DEFAULT_CONFIG = {
    "model": {
        "backbone": "resnet50_ibn",
        "embedding_dim": 512,
        "pretrained_weights": "models/pretrained/fastreid_resnet50_ibn_veri776.pth"
    },
    "training": {
        "batch_size": 32,
        "num_instances": 4,  # Images per vehicle per batch
        "phase1_epochs": 20,
        "phase2_epochs": 30,
        "phase1_lr": 0.001,
        "phase2_lr": 0.0001,
        "weight_decay": 0.0005,
        "warmup_epochs": 5
    },
    "losses": {
        "triplet_margin": 0.3,
        "triplet_weight": 0.5,
        "arcface_scale": 30.0,
        "arcface_margin": 0.5,
        "arcface_weight": 0.5
    },
    "data": {
        "input_size": [256, 128],  # Height x Width
        "normalize_mean": [0.485, 0.456, 0.406],
        "normalize_std": [0.229, 0.224, 0.225]
    },
    "augmentation": {
        "random_horizontal_flip": True,
        "random_crop_padding": 10,
        "color_jitter": 0.3,
        "random_erasing_prob": 0.5
    }
}


# ============================================
# Dataset
# ============================================

class VehicleReIDDataset(Dataset):
    """Dataset for Vehicle ReID training."""

    def __init__(
        self,
        data_dir: Path,
        transform=None,
        is_train: bool = True
    ):
        self.data_dir = Path(data_dir)
        self.transform = transform
        self.is_train = is_train

        # Load metadata
        metadata_path = self.data_dir.parent / "metadata.json"
        if metadata_path.exists():
            with open(metadata_path) as f:
                self.metadata = json.load(f)
        else:
            self.metadata = {}

        # Collect all images and labels
        self.samples = []
        self.vehicle_to_images = {}

        for vehicle_dir in self.data_dir.iterdir():
            if not vehicle_dir.is_dir():
                continue

            vehicle_id = vehicle_dir.name
            vehicle_idx = self.metadata.get("vehicle_to_id", {}).get(
                vehicle_id, len(self.vehicle_to_images)
            )

            images = list(vehicle_dir.glob("*.jpg"))

            if vehicle_id not in self.vehicle_to_images:
                self.vehicle_to_images[vehicle_id] = {
                    "idx": vehicle_idx,
                    "images": []
                }

            for img_path in images:
                self.samples.append({
                    "path": img_path,
                    "vehicle_id": vehicle_id,
                    "vehicle_idx": vehicle_idx
                })
                self.vehicle_to_images[vehicle_id]["images"].append(len(self.samples) - 1)

        self.num_vehicles = len(self.vehicle_to_images)
        print(f"Loaded {len(self.samples)} images from {self.num_vehicles} vehicles")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]

        # Load image
        img = cv2.imread(str(sample["path"]))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        if self.transform:
            augmented = self.transform(image=img)
            img = augmented["image"]

        return img, sample["vehicle_idx"]


def get_transforms(config: Dict, is_train: bool = True):
    """Get albumentations transforms."""
    h, w = config["data"]["input_size"]
    mean = config["data"]["normalize_mean"]
    std = config["data"]["normalize_std"]

    if is_train:
        aug_config = config["augmentation"]
        transforms = [
            A.Resize(h, w),
        ]

        if aug_config.get("random_horizontal_flip", True):
            transforms.append(A.HorizontalFlip(p=0.5))

        if aug_config.get("random_crop_padding", 0) > 0:
            pad = aug_config["random_crop_padding"]
            transforms.extend([
                A.PadIfNeeded(h + pad*2, w + pad*2, border_mode=cv2.BORDER_CONSTANT),
                A.RandomCrop(h, w)
            ])

        if aug_config.get("color_jitter", 0) > 0:
            jitter = aug_config["color_jitter"]
            transforms.append(A.ColorJitter(
                brightness=jitter,
                contrast=jitter,
                saturation=jitter,
                hue=jitter/3,
                p=0.8
            ))

        if aug_config.get("random_erasing_prob", 0) > 0:
            transforms.append(A.CoarseDropout(
                max_holes=1,
                max_height=int(h * 0.3),
                max_width=int(w * 0.3),
                min_height=int(h * 0.1),
                min_width=int(w * 0.1),
                fill_value=0,
                p=aug_config["random_erasing_prob"]
            ))

        transforms.extend([
            A.Normalize(mean=mean, std=std),
            ToTensorV2()
        ])

        return A.Compose(transforms)
    else:
        return A.Compose([
            A.Resize(h, w),
            A.Normalize(mean=mean, std=std),
            ToTensorV2()
        ])


# ============================================
# Model
# ============================================

class GeM(nn.Module):
    """Generalized Mean Pooling."""

    def __init__(self, p: float = 3.0, eps: float = 1e-6):
        super().__init__()
        self.p = nn.Parameter(torch.ones(1) * p)
        self.eps = eps

    def forward(self, x):
        return F.adaptive_avg_pool2d(
            x.clamp(min=self.eps).pow(self.p),
            1
        ).pow(1.0 / self.p)


class VehicleReIDModel(nn.Module):
    """Vehicle ReID model with ResNet backbone."""

    def __init__(
        self,
        embedding_dim: int = 512,
        num_classes: int = 0,
        pretrained_path: Optional[str] = None
    ):
        super().__init__()

        # Load backbone
        try:
            import timm
            self.backbone = timm.create_model(
                'resnet50',
                pretrained=True,
                num_classes=0,
                global_pool=''
            )
            backbone_dim = 2048
        except ImportError:
            from torchvision.models import resnet50, ResNet50_Weights
            base = resnet50(weights=ResNet50_Weights.IMAGENET1K_V1)
            self.backbone = nn.Sequential(*list(base.children())[:-2])
            backbone_dim = 2048

        # GeM pooling
        self.pool = GeM()

        # Embedding head
        self.bottleneck = nn.Sequential(
            nn.Linear(backbone_dim, embedding_dim),
            nn.BatchNorm1d(embedding_dim),
            nn.ReLU(inplace=True)
        )

        # Classification head (for ArcFace)
        self.num_classes = num_classes
        if num_classes > 0:
            self.classifier = nn.Linear(embedding_dim, num_classes, bias=False)

        self.embedding_dim = embedding_dim

        # Load pretrained weights if provided
        if pretrained_path and Path(pretrained_path).exists():
            self._load_pretrained(pretrained_path)

    def _load_pretrained(self, path: str):
        """Load pretrained weights from FastReID format."""
        print(f"Loading pretrained weights from: {path}")
        state_dict = torch.load(path, map_location='cpu')

        # Handle different checkpoint formats
        if 'model' in state_dict:
            state_dict = state_dict['model']
        elif 'state_dict' in state_dict:
            state_dict = state_dict['state_dict']

        # Try to load backbone weights
        backbone_dict = {}
        for k, v in state_dict.items():
            if k.startswith('backbone.'):
                new_key = k.replace('backbone.', '')
                backbone_dict[new_key] = v

        if backbone_dict:
            missing, unexpected = self.backbone.load_state_dict(backbone_dict, strict=False)
            print(f"Loaded backbone weights. Missing: {len(missing)}, Unexpected: {len(unexpected)}")
        else:
            print("Could not find backbone weights in checkpoint")

    def forward(self, x, return_features: bool = False):
        # Backbone
        features = self.backbone(x)

        # Pool
        pooled = self.pool(features)
        pooled = pooled.flatten(1)

        # Embedding
        embedding = self.bottleneck(pooled)

        if return_features:
            return embedding

        # Normalize for similarity
        embedding_norm = F.normalize(embedding, p=2, dim=1)

        if self.training and self.num_classes > 0:
            # Classification logits for ArcFace
            logits = self.classifier(embedding)
            return embedding_norm, logits

        return embedding_norm


# ============================================
# Losses
# ============================================

class TripletLoss(nn.Module):
    """Triplet loss with hard mining."""

    def __init__(self, margin: float = 0.3):
        super().__init__()
        self.margin = margin

    def forward(self, embeddings, labels):
        # Compute pairwise distances
        dist_mat = torch.cdist(embeddings, embeddings, p=2)

        # For each sample, find hardest positive and negative
        n = embeddings.size(0)
        labels = labels.view(-1)

        # Mask for same/different class
        same_class = labels.unsqueeze(0) == labels.unsqueeze(1)

        # Hard positive: max distance among same class
        pos_dist = dist_mat.clone()
        pos_dist[~same_class] = 0
        hard_pos, _ = pos_dist.max(dim=1)

        # Hard negative: min distance among different class
        neg_dist = dist_mat.clone()
        neg_dist[same_class] = float('inf')
        hard_neg, _ = neg_dist.min(dim=1)

        # Triplet loss
        loss = F.relu(hard_pos - hard_neg + self.margin)

        return loss.mean()


class ArcFaceLoss(nn.Module):
    """ArcFace loss for discriminative embeddings."""

    def __init__(
        self,
        embedding_dim: int,
        num_classes: int,
        scale: float = 30.0,
        margin: float = 0.5
    ):
        super().__init__()
        self.scale = scale
        self.margin = margin
        self.weight = nn.Parameter(torch.FloatTensor(num_classes, embedding_dim))
        nn.init.xavier_uniform_(self.weight)

    def forward(self, embeddings, labels):
        # Normalize
        embeddings = F.normalize(embeddings, p=2, dim=1)
        weights = F.normalize(self.weight, p=2, dim=1)

        # Cosine similarity
        cos_theta = torch.matmul(embeddings, weights.t())
        cos_theta = cos_theta.clamp(-1 + 1e-7, 1 - 1e-7)

        # Arc margin
        theta = torch.acos(cos_theta)
        target_logits = torch.cos(theta + self.margin)

        # One-hot
        one_hot = torch.zeros_like(cos_theta)
        one_hot.scatter_(1, labels.view(-1, 1), 1)

        # Apply margin to target class only
        output = (one_hot * target_logits) + ((1 - one_hot) * cos_theta)
        output *= self.scale

        return F.cross_entropy(output, labels)


# ============================================
# Training
# ============================================

class VehicleReIDTrainer:
    """Trainer for Vehicle ReID model."""

    def __init__(self, config: Dict, output_dir: Path):
        self.config = config
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Device
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")

        # Save config
        config_path = self.output_dir / "config.json"
        with open(config_path, 'w') as f:
            json.dump(config, f, indent=2)

    def train(self, train_dataset: VehicleReIDDataset, val_dataset: Optional[VehicleReIDDataset] = None):
        """Train the model."""
        cfg = self.config

        # Model
        model = VehicleReIDModel(
            embedding_dim=cfg["model"]["embedding_dim"],
            num_classes=train_dataset.num_vehicles,
            pretrained_path=cfg["model"].get("pretrained_weights")
        )
        model = model.to(self.device)

        # Data loaders
        train_loader = DataLoader(
            train_dataset,
            batch_size=cfg["training"]["batch_size"],
            shuffle=True,
            num_workers=4,
            pin_memory=True,
            drop_last=True
        )

        val_loader = None
        if val_dataset:
            val_loader = DataLoader(
                val_dataset,
                batch_size=cfg["training"]["batch_size"],
                shuffle=False,
                num_workers=4,
                pin_memory=True
            )

        # Losses
        triplet_loss = TripletLoss(margin=cfg["losses"]["triplet_margin"])
        arcface_loss = ArcFaceLoss(
            embedding_dim=cfg["model"]["embedding_dim"],
            num_classes=train_dataset.num_vehicles,
            scale=cfg["losses"]["arcface_scale"],
            margin=cfg["losses"]["arcface_margin"]
        ).to(self.device)

        # Phase 1: Train head only
        print(f"\n{'='*60}")
        print("PHASE 1: Training embedding head (backbone frozen)")
        print(f"{'='*60}")

        # Freeze backbone
        for param in model.backbone.parameters():
            param.requires_grad = False

        optimizer = Adam(
            list(model.bottleneck.parameters()) +
            list(model.classifier.parameters()) +
            list(arcface_loss.parameters()),
            lr=cfg["training"]["phase1_lr"],
            weight_decay=cfg["training"]["weight_decay"]
        )

        self._train_loop(
            model, train_loader, val_loader,
            optimizer, triplet_loss, arcface_loss,
            epochs=cfg["training"]["phase1_epochs"],
            phase="phase1"
        )

        # Phase 2: Fine-tune all
        print(f"\n{'='*60}")
        print("PHASE 2: Fine-tuning entire model")
        print(f"{'='*60}")

        # Unfreeze backbone
        for param in model.backbone.parameters():
            param.requires_grad = True

        optimizer = Adam(
            model.parameters(),
            lr=cfg["training"]["phase2_lr"],
            weight_decay=cfg["training"]["weight_decay"]
        )
        scheduler = CosineAnnealingLR(
            optimizer,
            T_max=cfg["training"]["phase2_epochs"]
        )

        self._train_loop(
            model, train_loader, val_loader,
            optimizer, triplet_loss, arcface_loss,
            epochs=cfg["training"]["phase2_epochs"],
            phase="phase2",
            scheduler=scheduler
        )

        # Save final model
        final_path = self.output_dir / "vehicle_reid_final.pth"
        torch.save({
            'model_state_dict': model.state_dict(),
            'config': self.config,
            'num_vehicles': train_dataset.num_vehicles,
            'embedding_dim': cfg["model"]["embedding_dim"],
            'timestamp': datetime.now().isoformat()
        }, final_path)
        print(f"\nFinal model saved to: {final_path}")

        return model

    def _train_loop(
        self,
        model,
        train_loader,
        val_loader,
        optimizer,
        triplet_loss,
        arcface_loss,
        epochs: int,
        phase: str,
        scheduler=None
    ):
        """Training loop."""
        cfg = self.config
        best_loss = float('inf')

        for epoch in range(epochs):
            model.train()
            epoch_loss = 0
            triplet_losses = 0
            arcface_losses = 0

            pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{epochs}")

            for images, labels in pbar:
                images = images.to(self.device)
                labels = labels.to(self.device)

                optimizer.zero_grad()

                # Forward
                embeddings, logits = model(images)

                # Losses
                t_loss = triplet_loss(embeddings, labels)
                a_loss = arcface_loss(embeddings, labels)

                loss = (
                    cfg["losses"]["triplet_weight"] * t_loss +
                    cfg["losses"]["arcface_weight"] * a_loss
                )

                # Backward
                loss.backward()
                optimizer.step()

                epoch_loss += loss.item()
                triplet_losses += t_loss.item()
                arcface_losses += a_loss.item()

                pbar.set_postfix({
                    'loss': f'{loss.item():.4f}',
                    'triplet': f'{t_loss.item():.4f}',
                    'arcface': f'{a_loss.item():.4f}'
                })

            if scheduler:
                scheduler.step()

            avg_loss = epoch_loss / len(train_loader)
            avg_triplet = triplet_losses / len(train_loader)
            avg_arcface = arcface_losses / len(train_loader)

            print(f"Epoch {epoch+1}/{epochs} | Loss: {avg_loss:.4f} | "
                  f"Triplet: {avg_triplet:.4f} | ArcFace: {avg_arcface:.4f}")

            # Save best model
            if avg_loss < best_loss:
                best_loss = avg_loss
                best_path = self.output_dir / f"vehicle_reid_best_{phase}.pth"
                torch.save({
                    'model_state_dict': model.state_dict(),
                    'epoch': epoch,
                    'loss': avg_loss
                }, best_path)
                print(f"  Saved best model (loss: {avg_loss:.4f})")


def main():
    parser = argparse.ArgumentParser(
        description="Train Vehicle ReID model"
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(__file__).parent.parent / "datasets" / "prepared" / "reid",
        help="Path to prepared ReID dataset"
    )
    parser.add_argument(
        "--config",
        type=Path,
        help="Path to config JSON file"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "models" / "reid_training",
        help="Output directory for trained models"
    )
    parser.add_argument(
        "--epochs",
        type=int,
        help="Override total epochs (phase1 + phase2)"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        help="Override batch size"
    )

    args = parser.parse_args()

    # Load config
    if args.config and args.config.exists():
        with open(args.config) as f:
            config = json.load(f)
    else:
        config = DEFAULT_CONFIG.copy()

    # Override with CLI args
    if args.epochs:
        config["training"]["phase1_epochs"] = args.epochs // 2
        config["training"]["phase2_epochs"] = args.epochs - args.epochs // 2

    if args.batch_size:
        config["training"]["batch_size"] = args.batch_size

    print(f"\n{'='*60}")
    print("VEHICLE REID TRAINING")
    print(f"{'='*60}")
    print(f"Dataset: {args.dataset}")
    print(f"Output: {args.output}")

    # Check dataset
    if not args.dataset.exists():
        print(f"\nERROR: Dataset not found at {args.dataset}")
        print("Please run: python scripts/02-prepare-dataset.py first")
        return

    train_dir = args.dataset / "train"
    val_dir = args.dataset / "val"

    if not train_dir.exists():
        print(f"\nERROR: Training data not found at {train_dir}")
        return

    # Create datasets
    train_transform = get_transforms(config, is_train=True)
    val_transform = get_transforms(config, is_train=False)

    train_dataset = VehicleReIDDataset(train_dir, transform=train_transform, is_train=True)

    val_dataset = None
    if val_dir.exists():
        val_dataset = VehicleReIDDataset(val_dir, transform=val_transform, is_train=False)

    # Train
    trainer = VehicleReIDTrainer(config, args.output)
    model = trainer.train(train_dataset, val_dataset)

    print(f"\n{'='*60}")
    print("TRAINING COMPLETE")
    print(f"{'='*60}")
    print(f"\nModels saved to: {args.output}")
    print("\nNext steps:")
    print("1. Validate: python scripts/06-test-inference.py")
    print("2. Export ONNX: python scripts/05-export-onnx.py")


if __name__ == "__main__":
    main()
