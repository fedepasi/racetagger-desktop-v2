#!/usr/bin/env python3
"""
04-train-makemodel.py

Train Vehicle Make/Model/Year classifier using EfficientNet-B4.

Architecture:
- Backbone: EfficientNet-B4 (pre-trained ImageNet)
- Multi-head output: Make, Model, Year
- Hierarchical loss weighting

Usage:
    python scripts/04-train-makemodel.py --data datasets/vmmrdb
    python scripts/04-train-makemodel.py --data datasets/motorsport --epochs 50
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts

import numpy as np
from PIL import Image
import cv2
from tqdm import tqdm

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Configuration
# ============================================

DEFAULT_CONFIG = {
    # Model
    "backbone": "efficientnet_b4",
    "pretrained": True,
    "dropout": 0.3,

    # Input
    "input_size": (224, 224),
    "input_channels": 3,

    # Training
    "batch_size": 32,
    "epochs": 100,
    "lr": 1e-4,
    "weight_decay": 1e-4,
    "warmup_epochs": 5,

    # Loss weights (hierarchical)
    "make_loss_weight": 1.0,
    "model_loss_weight": 1.5,  # Model is more specific, weight higher
    "year_loss_weight": 0.5,   # Year is optional/less important

    # Label smoothing
    "label_smoothing": 0.1,

    # Augmentation
    "augmentation": {
        "horizontal_flip": 0.5,
        "rotation": 15,
        "brightness": 0.2,
        "contrast": 0.2,
        "saturation": 0.2,
        "hue": 0.1
    }
}


# ============================================
# Dataset
# ============================================

class VehicleMakeModelDataset(Dataset):
    """
    Dataset for Make/Model/Year classification.

    Expected folder structure:
        dataset/
        ├── train/
        │   ├── Toyota_Camry_2020/
        │   │   ├── img1.jpg
        │   │   └── img2.jpg
        │   ├── Honda_Civic_2019/
        │   └── ...
        └── val/
            └── ...

    Or with metadata file:
        dataset/
        ├── images/
        │   ├── img1.jpg
        │   └── img2.jpg
        └── metadata.json  # {"img1.jpg": {"make": "Toyota", "model": "Camry", "year": 2020}}
    """

    def __init__(
        self,
        data_dir: Path,
        split: str = "train",
        transform=None,
        config: dict = None
    ):
        self.data_dir = Path(data_dir)
        self.split = split
        self.transform = transform
        self.config = config or DEFAULT_CONFIG

        self.samples = []
        self.make_to_idx = {}
        self.model_to_idx = {}
        self.year_to_idx = {}
        self.idx_to_make = {}
        self.idx_to_model = {}
        self.idx_to_year = {}

        self._load_dataset()

    def _load_dataset(self):
        """Load dataset from folder structure or metadata file."""
        split_dir = self.data_dir / self.split
        metadata_file = self.data_dir / "metadata.json"

        if metadata_file.exists():
            self._load_from_metadata(metadata_file)
        elif split_dir.exists():
            self._load_from_folders(split_dir)
        else:
            raise ValueError(f"Dataset not found: {self.data_dir}")

        print(f"Loaded {len(self.samples)} samples for {self.split}")
        print(f"  Makes: {len(self.make_to_idx)}")
        print(f"  Models: {len(self.model_to_idx)}")
        print(f"  Years: {len(self.year_to_idx)}")

    def _load_from_folders(self, split_dir: Path):
        """Load from folder structure: Make_Model_Year/images."""
        makes = set()
        models = set()
        years = set()

        for class_dir in sorted(split_dir.iterdir()):
            if not class_dir.is_dir():
                continue

            # Parse folder name: Make_Model_Year or Make_Model
            parts = class_dir.name.split("_")
            if len(parts) >= 2:
                make = parts[0]
                model = "_".join(parts[1:-1]) if len(parts) > 2 else parts[1]
                year = parts[-1] if len(parts) > 2 and parts[-1].isdigit() else "unknown"
            else:
                continue

            makes.add(make)
            models.add(f"{make}_{model}")  # Combine make+model for unique ID
            years.add(year)

            for img_path in class_dir.glob("*"):
                if img_path.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]:
                    self.samples.append({
                        "path": str(img_path),
                        "make": make,
                        "model": f"{make}_{model}",
                        "year": year
                    })

        # Create mappings
        self.make_to_idx = {m: i for i, m in enumerate(sorted(makes))}
        self.model_to_idx = {m: i for i, m in enumerate(sorted(models))}
        self.year_to_idx = {y: i for i, y in enumerate(sorted(years))}

        self.idx_to_make = {i: m for m, i in self.make_to_idx.items()}
        self.idx_to_model = {i: m for m, i in self.model_to_idx.items()}
        self.idx_to_year = {i: y for y, i in self.year_to_idx.items()}

    def _load_from_metadata(self, metadata_file: Path):
        """Load from metadata JSON file."""
        with open(metadata_file) as f:
            metadata = json.load(f)

        makes = set()
        models = set()
        years = set()

        images_dir = self.data_dir / "images"
        split_data = metadata.get(self.split, metadata)

        for img_name, info in split_data.items():
            img_path = images_dir / img_name
            if not img_path.exists():
                continue

            make = info.get("make", "unknown")
            model = f"{make}_{info.get('model', 'unknown')}"
            year = str(info.get("year", "unknown"))

            makes.add(make)
            models.add(model)
            years.add(year)

            self.samples.append({
                "path": str(img_path),
                "make": make,
                "model": model,
                "year": year
            })

        # Create mappings
        self.make_to_idx = {m: i for i, m in enumerate(sorted(makes))}
        self.model_to_idx = {m: i for i, m in enumerate(sorted(models))}
        self.year_to_idx = {y: i for i, y in enumerate(sorted(years))}

        self.idx_to_make = {i: m for m, i in self.make_to_idx.items()}
        self.idx_to_model = {i: m for m, i in self.model_to_idx.items()}
        self.idx_to_year = {i: y for y, i in self.year_to_idx.items()}

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]

        # Load image
        img = Image.open(sample["path"]).convert("RGB")

        # Resize
        h, w = self.config["input_size"]
        img = img.resize((w, h), Image.BILINEAR)

        # Convert to tensor
        img = np.array(img).astype(np.float32) / 255.0

        # Apply augmentation
        if self.transform:
            img = self.transform(img)

        # Normalize (ImageNet stats)
        mean = np.array([0.485, 0.456, 0.406])
        std = np.array([0.229, 0.224, 0.225])
        img = (img - mean) / std

        # To tensor (HWC -> CHW)
        img = torch.from_numpy(img.transpose(2, 0, 1)).float()

        # Labels
        make_idx = self.make_to_idx[sample["make"]]
        model_idx = self.model_to_idx[sample["model"]]
        year_idx = self.year_to_idx[sample["year"]]

        return img, make_idx, model_idx, year_idx


def get_augmentation(config: dict, is_train: bool = True):
    """Get augmentation transforms."""
    if not is_train:
        return None

    try:
        import albumentations as A

        aug_config = config.get("augmentation", {})

        transforms = A.Compose([
            A.HorizontalFlip(p=aug_config.get("horizontal_flip", 0.5)),
            A.Rotate(limit=aug_config.get("rotation", 15), p=0.5),
            A.ColorJitter(
                brightness=aug_config.get("brightness", 0.2),
                contrast=aug_config.get("contrast", 0.2),
                saturation=aug_config.get("saturation", 0.2),
                hue=aug_config.get("hue", 0.1),
                p=0.5
            ),
            A.GaussNoise(var_limit=(10, 50), p=0.3),
            A.MotionBlur(blur_limit=3, p=0.2),
        ])

        def apply_transform(img):
            result = transforms(image=img)
            return result["image"]

        return apply_transform

    except ImportError:
        print("Warning: albumentations not installed, skipping augmentation")
        return None


# ============================================
# Model
# ============================================

class VehicleMakeModelClassifier(nn.Module):
    """
    Multi-head classifier for Vehicle Make/Model/Year.

    Uses EfficientNet-B4 backbone with separate classification heads.
    """

    def __init__(
        self,
        num_makes: int,
        num_models: int,
        num_years: int,
        backbone: str = "efficientnet_b4",
        pretrained: bool = True,
        dropout: float = 0.3
    ):
        super().__init__()

        self.num_makes = num_makes
        self.num_models = num_models
        self.num_years = num_years

        # Load backbone
        try:
            import timm
            self.backbone = timm.create_model(
                backbone,
                pretrained=pretrained,
                num_classes=0,  # Remove classifier
                global_pool="avg"
            )

            # Get backbone output dimension
            with torch.no_grad():
                dummy = torch.zeros(1, 3, 224, 224)
                backbone_dim = self.backbone(dummy).shape[1]

        except ImportError:
            print("Warning: timm not installed, using ResNet50 fallback")
            import torchvision.models as models
            base = models.resnet50(pretrained=pretrained)
            self.backbone = nn.Sequential(*list(base.children())[:-1])
            backbone_dim = 2048

        print(f"Backbone output dim: {backbone_dim}")

        # Shared feature layer
        self.shared_fc = nn.Sequential(
            nn.Linear(backbone_dim, 1024),
            nn.BatchNorm1d(1024),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout)
        )

        # Make classification head
        self.make_head = nn.Sequential(
            nn.Linear(1024, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout / 2),
            nn.Linear(512, num_makes)
        )

        # Model classification head (conditioned on make features)
        self.model_head = nn.Sequential(
            nn.Linear(1024 + num_makes, 512),  # Include make predictions
            nn.BatchNorm1d(512),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout / 2),
            nn.Linear(512, num_models)
        )

        # Year classification head
        self.year_head = nn.Sequential(
            nn.Linear(1024, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout / 2),
            nn.Linear(256, num_years)
        )

    def forward(self, x):
        # Backbone features
        features = self.backbone(x)
        if features.dim() > 2:
            features = features.flatten(1)

        # Shared layer
        shared = self.shared_fc(features)

        # Make prediction
        make_logits = self.make_head(shared)

        # Model prediction (hierarchical - uses make info)
        make_probs = F.softmax(make_logits, dim=1)
        model_input = torch.cat([shared, make_probs], dim=1)
        model_logits = self.model_head(model_input)

        # Year prediction
        year_logits = self.year_head(shared)

        return make_logits, model_logits, year_logits

    def predict(self, x):
        """Predict with probabilities."""
        make_logits, model_logits, year_logits = self.forward(x)

        make_probs = F.softmax(make_logits, dim=1)
        model_probs = F.softmax(model_logits, dim=1)
        year_probs = F.softmax(year_logits, dim=1)

        return make_probs, model_probs, year_probs


# ============================================
# Loss Functions
# ============================================

class HierarchicalCrossEntropyLoss(nn.Module):
    """
    Hierarchical cross-entropy loss with label smoothing.

    Applies different weights to Make, Model, and Year predictions.
    """

    def __init__(
        self,
        make_weight: float = 1.0,
        model_weight: float = 1.5,
        year_weight: float = 0.5,
        label_smoothing: float = 0.1
    ):
        super().__init__()
        self.make_weight = make_weight
        self.model_weight = model_weight
        self.year_weight = year_weight

        self.make_criterion = nn.CrossEntropyLoss(label_smoothing=label_smoothing)
        self.model_criterion = nn.CrossEntropyLoss(label_smoothing=label_smoothing)
        self.year_criterion = nn.CrossEntropyLoss(label_smoothing=label_smoothing)

    def forward(self, make_logits, model_logits, year_logits, make_target, model_target, year_target):
        make_loss = self.make_criterion(make_logits, make_target)
        model_loss = self.model_criterion(model_logits, model_target)
        year_loss = self.year_criterion(year_logits, year_target)

        total_loss = (
            self.make_weight * make_loss +
            self.model_weight * model_loss +
            self.year_weight * year_loss
        )

        return total_loss, {
            "make_loss": make_loss.item(),
            "model_loss": model_loss.item(),
            "year_loss": year_loss.item()
        }


# ============================================
# Training
# ============================================

def train_epoch(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    epoch: int
):
    """Train for one epoch."""
    model.train()

    total_loss = 0.0
    make_correct = 0
    model_correct = 0
    year_correct = 0
    total_samples = 0

    loss_components = defaultdict(float)

    pbar = tqdm(dataloader, desc=f"Epoch {epoch} [Train]")

    for images, make_labels, model_labels, year_labels in pbar:
        images = images.to(device)
        make_labels = make_labels.to(device)
        model_labels = model_labels.to(device)
        year_labels = year_labels.to(device)

        # Forward
        make_logits, model_logits, year_logits = model(images)

        # Loss
        loss, components = criterion(
            make_logits, model_logits, year_logits,
            make_labels, model_labels, year_labels
        )

        # Backward
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        # Stats
        total_loss += loss.item() * images.size(0)
        for k, v in components.items():
            loss_components[k] += v * images.size(0)

        make_pred = make_logits.argmax(dim=1)
        model_pred = model_logits.argmax(dim=1)
        year_pred = year_logits.argmax(dim=1)

        make_correct += (make_pred == make_labels).sum().item()
        model_correct += (model_pred == model_labels).sum().item()
        year_correct += (year_pred == year_labels).sum().item()
        total_samples += images.size(0)

        # Update progress bar
        pbar.set_postfix({
            "loss": f"{loss.item():.4f}",
            "make_acc": f"{100*make_correct/total_samples:.1f}%",
            "model_acc": f"{100*model_correct/total_samples:.1f}%"
        })

    return {
        "loss": total_loss / total_samples,
        "make_acc": make_correct / total_samples,
        "model_acc": model_correct / total_samples,
        "year_acc": year_correct / total_samples,
        "components": {k: v / total_samples for k, v in loss_components.items()}
    }


@torch.no_grad()
def validate(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    epoch: int
):
    """Validate model."""
    model.eval()

    total_loss = 0.0
    make_correct = 0
    model_correct = 0
    year_correct = 0
    total_samples = 0

    # Top-5 accuracy
    make_top5_correct = 0
    model_top5_correct = 0

    pbar = tqdm(dataloader, desc=f"Epoch {epoch} [Val]")

    for images, make_labels, model_labels, year_labels in pbar:
        images = images.to(device)
        make_labels = make_labels.to(device)
        model_labels = model_labels.to(device)
        year_labels = year_labels.to(device)

        # Forward
        make_logits, model_logits, year_logits = model(images)

        # Loss
        loss, _ = criterion(
            make_logits, model_logits, year_logits,
            make_labels, model_labels, year_labels
        )

        # Stats
        total_loss += loss.item() * images.size(0)

        # Top-1 accuracy
        make_pred = make_logits.argmax(dim=1)
        model_pred = model_logits.argmax(dim=1)
        year_pred = year_logits.argmax(dim=1)

        make_correct += (make_pred == make_labels).sum().item()
        model_correct += (model_pred == model_labels).sum().item()
        year_correct += (year_pred == year_labels).sum().item()

        # Top-5 accuracy
        _, make_top5 = make_logits.topk(min(5, make_logits.size(1)), dim=1)
        _, model_top5 = model_logits.topk(min(5, model_logits.size(1)), dim=1)

        make_top5_correct += sum(
            make_labels[i] in make_top5[i] for i in range(len(make_labels))
        )
        model_top5_correct += sum(
            model_labels[i] in model_top5[i] for i in range(len(model_labels))
        )

        total_samples += images.size(0)

    return {
        "loss": total_loss / total_samples,
        "make_acc": make_correct / total_samples,
        "model_acc": model_correct / total_samples,
        "year_acc": year_correct / total_samples,
        "make_top5_acc": make_top5_correct / total_samples,
        "model_top5_acc": model_top5_correct / total_samples
    }


def train(
    data_dir: Path,
    output_dir: Path,
    config: dict = None
):
    """
    Main training function.

    Args:
        data_dir: Dataset directory
        output_dir: Output directory for checkpoints
        config: Training configuration
    """
    config = config or DEFAULT_CONFIG

    print(f"\n{'='*60}")
    print("VEHICLE MAKE/MODEL/YEAR CLASSIFIER TRAINING")
    print(f"{'='*60}")
    print(f"Dataset: {data_dir}")
    print(f"Output: {output_dir}")
    print(f"Config: {json.dumps(config, indent=2)}")

    # Device
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    print(f"\nUsing device: {device}")

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load datasets
    print("\n" + "="*40)
    print("LOADING DATASETS")
    print("="*40)

    train_transform = get_augmentation(config, is_train=True)

    train_dataset = VehicleMakeModelDataset(
        data_dir, split="train",
        transform=train_transform,
        config=config
    )

    val_dataset = VehicleMakeModelDataset(
        data_dir, split="val",
        transform=None,
        config=config
    )

    # Copy class mappings from train to val
    val_dataset.make_to_idx = train_dataset.make_to_idx
    val_dataset.model_to_idx = train_dataset.model_to_idx
    val_dataset.year_to_idx = train_dataset.year_to_idx

    train_loader = DataLoader(
        train_dataset,
        batch_size=config["batch_size"],
        shuffle=True,
        num_workers=4,
        pin_memory=True,
        drop_last=True
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=config["batch_size"],
        shuffle=False,
        num_workers=4,
        pin_memory=True
    )

    # Create model
    print("\n" + "="*40)
    print("CREATING MODEL")
    print("="*40)

    model = VehicleMakeModelClassifier(
        num_makes=len(train_dataset.make_to_idx),
        num_models=len(train_dataset.model_to_idx),
        num_years=len(train_dataset.year_to_idx),
        backbone=config["backbone"],
        pretrained=config["pretrained"],
        dropout=config["dropout"]
    )
    model = model.to(device)

    # Count parameters
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Total parameters: {total_params / 1e6:.2f}M")
    print(f"Trainable parameters: {trainable_params / 1e6:.2f}M")

    # Loss function
    criterion = HierarchicalCrossEntropyLoss(
        make_weight=config["make_loss_weight"],
        model_weight=config["model_loss_weight"],
        year_weight=config["year_loss_weight"],
        label_smoothing=config["label_smoothing"]
    )

    # Optimizer
    optimizer = AdamW(
        model.parameters(),
        lr=config["lr"],
        weight_decay=config["weight_decay"]
    )

    # Scheduler
    scheduler = CosineAnnealingWarmRestarts(
        optimizer,
        T_0=10,
        T_mult=2,
        eta_min=1e-6
    )

    # Training loop
    print("\n" + "="*40)
    print("TRAINING")
    print("="*40)

    best_model_acc = 0.0
    training_history = []

    for epoch in range(1, config["epochs"] + 1):
        # Train
        train_metrics = train_epoch(
            model, train_loader, criterion,
            optimizer, device, epoch
        )

        # Validate
        val_metrics = validate(
            model, val_loader, criterion, device, epoch
        )

        # Update scheduler
        scheduler.step()

        # Log
        print(f"\nEpoch {epoch}/{config['epochs']}")
        print(f"  Train - Loss: {train_metrics['loss']:.4f}, "
              f"Make: {100*train_metrics['make_acc']:.2f}%, "
              f"Model: {100*train_metrics['model_acc']:.2f}%, "
              f"Year: {100*train_metrics['year_acc']:.2f}%")
        print(f"  Val   - Loss: {val_metrics['loss']:.4f}, "
              f"Make: {100*val_metrics['make_acc']:.2f}%, "
              f"Model: {100*val_metrics['model_acc']:.2f}%, "
              f"Year: {100*val_metrics['year_acc']:.2f}%")
        print(f"  Val Top-5 - Make: {100*val_metrics['make_top5_acc']:.2f}%, "
              f"Model: {100*val_metrics['model_top5_acc']:.2f}%")

        training_history.append({
            "epoch": epoch,
            "train": train_metrics,
            "val": val_metrics
        })

        # Save best model
        if val_metrics["model_acc"] > best_model_acc:
            best_model_acc = val_metrics["model_acc"]

            checkpoint = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scheduler_state_dict": scheduler.state_dict(),
                "config": config,
                "num_makes": len(train_dataset.make_to_idx),
                "num_models": len(train_dataset.model_to_idx),
                "num_years": len(train_dataset.year_to_idx),
                "make_to_idx": train_dataset.make_to_idx,
                "model_to_idx": train_dataset.model_to_idx,
                "year_to_idx": train_dataset.year_to_idx,
                "val_metrics": val_metrics,
                "training_history": training_history
            }

            torch.save(checkpoint, output_dir / "vehicle_makemodel_best.pth")
            print(f"  [NEW BEST] Saved model with Model Acc: {100*best_model_acc:.2f}%")

        # Save periodic checkpoint
        if epoch % 10 == 0:
            checkpoint = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scheduler_state_dict": scheduler.state_dict(),
                "config": config,
                "num_makes": len(train_dataset.make_to_idx),
                "num_models": len(train_dataset.model_to_idx),
                "num_years": len(train_dataset.year_to_idx),
                "make_to_idx": train_dataset.make_to_idx,
                "model_to_idx": train_dataset.model_to_idx,
                "year_to_idx": train_dataset.year_to_idx,
            }
            torch.save(checkpoint, output_dir / f"checkpoint_epoch_{epoch}.pth")

    # Save final model
    print("\n" + "="*40)
    print("SAVING FINAL MODEL")
    print("="*40)

    final_checkpoint = {
        "epoch": config["epochs"],
        "model_state_dict": model.state_dict(),
        "config": config,
        "num_makes": len(train_dataset.make_to_idx),
        "num_models": len(train_dataset.model_to_idx),
        "num_years": len(train_dataset.year_to_idx),
        "make_to_idx": train_dataset.make_to_idx,
        "model_to_idx": train_dataset.model_to_idx,
        "year_to_idx": train_dataset.year_to_idx,
        "idx_to_make": train_dataset.idx_to_make,
        "idx_to_model": train_dataset.idx_to_model,
        "idx_to_year": train_dataset.idx_to_year,
        "training_history": training_history,
        "final_val_metrics": val_metrics
    }

    torch.save(final_checkpoint, output_dir / "vehicle_makemodel_final.pth")

    # Save class labels for ONNX export
    class_labels = {
        "makes": train_dataset.idx_to_make,
        "models": train_dataset.idx_to_model,
        "years": train_dataset.idx_to_year
    }

    with open(output_dir / "class_labels.json", "w") as f:
        json.dump(class_labels, f, indent=2)

    # Save training summary
    summary = {
        "dataset": str(data_dir),
        "config": config,
        "num_makes": len(train_dataset.make_to_idx),
        "num_models": len(train_dataset.model_to_idx),
        "num_years": len(train_dataset.year_to_idx),
        "best_model_acc": best_model_acc,
        "final_metrics": val_metrics,
        "trained_at": datetime.now().isoformat()
    }

    with open(output_dir / "training_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nTraining complete!")
    print(f"Best Model Accuracy: {100*best_model_acc:.2f}%")
    print(f"Checkpoints saved to: {output_dir}")

    return model, training_history


def main():
    parser = argparse.ArgumentParser(
        description="Train Vehicle Make/Model/Year classifier"
    )
    parser.add_argument(
        "--data",
        type=Path,
        required=True,
        help="Dataset directory"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "models" / "makemodel_training",
        help="Output directory for checkpoints"
    )
    parser.add_argument(
        "--backbone",
        default="efficientnet_b4",
        help="Backbone architecture"
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=100,
        help="Number of training epochs"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch size"
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=1e-4,
        help="Learning rate"
    )
    parser.add_argument(
        "--resume",
        type=Path,
        help="Resume from checkpoint"
    )

    args = parser.parse_args()

    # Build config
    config = DEFAULT_CONFIG.copy()
    config["backbone"] = args.backbone
    config["epochs"] = args.epochs
    config["batch_size"] = args.batch_size
    config["lr"] = args.lr

    # Train
    train(args.data, args.output, config)


if __name__ == "__main__":
    main()
