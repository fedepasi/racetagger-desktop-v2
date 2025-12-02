#!/usr/bin/env python3
"""
01-download-models.py

Download pre-trained models for Vehicle ReID and Make/Model classification.

Models downloaded:
1. FastReID ResNet50-IBN pre-trained on VeRi-776 (vehicle re-identification)
2. EfficientNet-B4 pre-trained on ImageNet (for make/model fine-tuning)

Usage:
    python scripts/01-download-models.py
    python scripts/01-download-models.py --model reid
    python scripts/01-download-models.py --model makemodel
"""

import os
import sys
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlretrieve
from tqdm import tqdm

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# ============================================
# Model URLs and checksums
# ============================================

MODELS = {
    "reid": {
        "name": "FastReID ResNet50-IBN (VeRi-776)",
        "url": "https://github.com/JDAI-CV/fast-reid/releases/download/v0.1.1/veri_r50_ibn.pth",
        "filename": "fastreid_resnet50_ibn_veri776.pth",
        "size_mb": 94,
        "description": "Vehicle ReID model pre-trained on VeRi-776 dataset"
    },
    "reid_osnet": {
        "name": "OSNet-AIN (VeRi-776) - Lightweight",
        "url": "https://github.com/JDAI-CV/fast-reid/releases/download/v0.1.1/veri_osnet_ain.pth",
        "filename": "osnet_ain_veri776.pth",
        "size_mb": 17,
        "description": "Lightweight vehicle ReID model for faster inference"
    },
    "efficientnet_b4": {
        "name": "EfficientNet-B4 (ImageNet)",
        "url": None,  # Downloaded via timm
        "filename": None,
        "size_mb": 75,
        "description": "Base model for Make/Model classification (via timm)"
    }
}

# VMMRdb dataset info (for reference)
DATASETS = {
    "vmmrdb": {
        "name": "VMMRdb (Vehicle Make Model Recognition Database)",
        "url": "https://github.com/faezetta/VMMRdb",
        "description": "9,170 classes, 291,752 images",
        "note": "Must be downloaded manually from the repository"
    },
    "stanford_cars": {
        "name": "Stanford Cars Dataset",
        "url": "http://ai.stanford.edu/~jkrause/cars/car_dataset.html",
        "description": "196 classes, 16,185 images",
        "note": "Requires registration"
    }
}


class DownloadProgressBar(tqdm):
    """Progress bar for downloads."""
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)


def download_file(url: str, output_path: Path, desc: str = "Downloading"):
    """Download file with progress bar."""
    print(f"\n{desc}")
    print(f"URL: {url}")
    print(f"Output: {output_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with DownloadProgressBar(unit='B', unit_scale=True, miniters=1, desc=output_path.name) as t:
        urlretrieve(url, output_path, reporthook=t.update_to)

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Downloaded: {size_mb:.1f} MB")
    return output_path


def download_reid_model(output_dir: Path, lightweight: bool = False):
    """Download FastReID or OSNet model."""
    model_key = "reid_osnet" if lightweight else "reid"
    model_info = MODELS[model_key]

    print(f"\n{'='*60}")
    print(f"Downloading: {model_info['name']}")
    print(f"Description: {model_info['description']}")
    print(f"Expected size: ~{model_info['size_mb']} MB")
    print(f"{'='*60}")

    output_path = output_dir / "pretrained" / model_info["filename"]

    if output_path.exists():
        print(f"Model already exists: {output_path}")
        return output_path

    return download_file(
        url=model_info["url"],
        output_path=output_path,
        desc=f"Downloading {model_info['name']}"
    )


def download_efficientnet(output_dir: Path):
    """Download EfficientNet-B4 via timm (will be cached)."""
    print(f"\n{'='*60}")
    print("Downloading: EfficientNet-B4 (ImageNet)")
    print("Description: Base model for Make/Model classification")
    print("Note: Downloaded via timm library to cache")
    print(f"{'='*60}")

    try:
        import timm

        print("\nLoading EfficientNet-B4 (this will download weights)...")
        model = timm.create_model('efficientnet_b4', pretrained=True)
        print("EfficientNet-B4 loaded successfully!")
        print(f"Model cached in: ~/.cache/torch/hub/checkpoints/")

        # Get model info
        num_params = sum(p.numel() for p in model.parameters())
        print(f"Parameters: {num_params / 1e6:.1f}M")

        return True

    except ImportError:
        print("\nERROR: timm not installed. Run: pip install timm")
        return False


def create_model_info(output_dir: Path):
    """Create model_info.json with metadata."""
    import json

    info = {
        "vehicle_reid": {
            "model_file": "pretrained/fastreid_resnet50_ibn_veri776.pth",
            "architecture": "ResNet50-IBN",
            "embedding_dim": 512,
            "input_size": [256, 128],
            "input_format": "RGB",
            "normalization": {
                "mean": [0.485, 0.456, 0.406],
                "std": [0.229, 0.224, 0.225]
            },
            "pretrained_dataset": "VeRi-776",
            "similarity_metric": "cosine",
            "recommended_threshold": 0.65
        },
        "vehicle_makemodel": {
            "model_file": "vehicle_makemodel.onnx",
            "architecture": "EfficientNet-B4",
            "input_size": [224, 224],
            "input_format": "RGB",
            "normalization": {
                "mean": [0.485, 0.456, 0.406],
                "std": [0.229, 0.224, 0.225]
            },
            "output_heads": ["make", "model", "year"],
            "class_labels_file": "class_labels.json"
        }
    }

    info_path = output_dir / "model_info.json"
    with open(info_path, 'w') as f:
        json.dump(info, f, indent=2)

    print(f"\nCreated: {info_path}")
    return info_path


def print_dataset_info():
    """Print information about available datasets."""
    print(f"\n{'='*60}")
    print("DATASET INFORMATION")
    print(f"{'='*60}")

    for key, info in DATASETS.items():
        print(f"\n{info['name']}")
        print(f"  URL: {info['url']}")
        print(f"  Description: {info['description']}")
        print(f"  Note: {info['note']}")

    print(f"\n{'='*60}")
    print("For motorsport-specific training, collect your own images")
    print("and organize them in datasets/motorsport/ folder.")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(
        description="Download pre-trained models for Vehicle-API"
    )
    parser.add_argument(
        "--model",
        choices=["reid", "makemodel", "all"],
        default="all",
        help="Which model to download (default: all)"
    )
    parser.add_argument(
        "--lightweight",
        action="store_true",
        help="Download lightweight OSNet instead of ResNet50 for ReID"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).parent.parent / "models",
        help="Output directory for models"
    )
    parser.add_argument(
        "--show-datasets",
        action="store_true",
        help="Show information about available datasets"
    )

    args = parser.parse_args()

    if args.show_datasets:
        print_dataset_info()
        return

    print(f"\n{'='*60}")
    print("VEHICLE-API MODEL DOWNLOADER")
    print(f"{'='*60}")
    print(f"Output directory: {args.output_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Download models
    if args.model in ["reid", "all"]:
        download_reid_model(args.output_dir, lightweight=args.lightweight)

    if args.model in ["makemodel", "all"]:
        download_efficientnet(args.output_dir)

    # Create model info
    create_model_info(args.output_dir)

    # Print dataset info
    print_dataset_info()

    print(f"\n{'='*60}")
    print("DOWNLOAD COMPLETE")
    print(f"{'='*60}")
    print(f"\nModels saved to: {args.output_dir}")
    print("\nNext steps:")
    print("1. Prepare your dataset: python scripts/02-prepare-dataset.py")
    print("2. Train ReID model: python scripts/03-train-reid.py")
    print("3. Train Make/Model: python scripts/04-train-makemodel.py")


if __name__ == "__main__":
    main()
