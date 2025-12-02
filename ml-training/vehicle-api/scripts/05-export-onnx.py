#!/usr/bin/env python3
"""
05-export-onnx.py

Export trained models to ONNX format for inference in RaceTagger.

Exports:
1. Vehicle ReID model → vehicle_reid.onnx
2. Make/Model classifier → vehicle_makemodel.onnx

Usage:
    python scripts/05-export-onnx.py --model models/reid_training/vehicle_reid_final.pth
    python scripts/05-export-onnx.py --model models/makemodel_training/vehicle_makemodel_final.pth
    python scripts/05-export-onnx.py --all
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import model classes
from scripts import train_reid  # Assuming 03-train-reid.py can be imported as module


# ============================================
# Model Wrapper for ONNX Export
# ============================================

class VehicleReIDONNX(nn.Module):
    """Wrapper for ReID model ONNX export (embedding only, no classification)."""

    def __init__(self, model):
        super().__init__()
        self.backbone = model.backbone
        self.pool = model.pool
        self.bottleneck = model.bottleneck

    def forward(self, x):
        # Backbone
        features = self.backbone(x)

        # Pool
        pooled = self.pool(features)
        pooled = pooled.flatten(1)

        # Embedding
        embedding = self.bottleneck(pooled)

        # L2 normalize
        embedding = F.normalize(embedding, p=2, dim=1)

        return embedding


class VehicleMakeModelONNX(nn.Module):
    """Wrapper for Make/Model classifier ONNX export."""

    def __init__(self, model):
        super().__init__()
        self.backbone = model.backbone
        self.pool = model.pool
        self.make_head = model.make_head
        self.model_head = model.model_head
        self.year_head = getattr(model, 'year_head', None)

    def forward(self, x):
        # Backbone
        features = self.backbone(x)

        # Pool
        pooled = self.pool(features)
        pooled = pooled.flatten(1)

        # Classification heads
        make_logits = self.make_head(pooled)
        model_logits = self.model_head(pooled)

        # Softmax for probabilities
        make_probs = F.softmax(make_logits, dim=1)
        model_probs = F.softmax(model_logits, dim=1)

        if self.year_head is not None:
            year_logits = self.year_head(pooled)
            year_probs = F.softmax(year_logits, dim=1)
            return make_probs, model_probs, year_probs

        return make_probs, model_probs


def export_reid_model(
    checkpoint_path: Path,
    output_path: Path,
    input_size: tuple = (256, 128)
):
    """
    Export Vehicle ReID model to ONNX.

    Args:
        checkpoint_path: Path to PyTorch checkpoint
        output_path: Path for ONNX output
        input_size: (height, width) of input
    """
    print(f"\n{'='*60}")
    print("EXPORTING VEHICLE REID MODEL TO ONNX")
    print(f"{'='*60}")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Output: {output_path}")

    # Load checkpoint
    checkpoint = torch.load(checkpoint_path, map_location='cpu')

    config = checkpoint.get('config', {})
    embedding_dim = checkpoint.get('embedding_dim', 512)
    num_vehicles = checkpoint.get('num_vehicles', 100)

    print(f"Embedding dim: {embedding_dim}")
    print(f"Num vehicles: {num_vehicles}")

    # Rebuild model
    # Import here to avoid circular imports
    try:
        from scripts.train_reid import VehicleReIDModel
        model = VehicleReIDModel(
            embedding_dim=embedding_dim,
            num_classes=num_vehicles
        )
    except ImportError:
        # Fallback: create simple model
        print("Warning: Could not import VehicleReIDModel, using fallback")
        model = create_fallback_reid_model(embedding_dim)

    model.load_state_dict(checkpoint['model_state_dict'], strict=False)
    model.eval()

    # Wrap for export (embedding only)
    export_model = VehicleReIDONNX(model)
    export_model.eval()

    # Create dummy input
    h, w = input_size
    dummy_input = torch.randn(1, 3, h, w)

    # Export
    print("\nExporting to ONNX...")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        export_model,
        dummy_input,
        str(output_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['embedding'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'embedding': {0: 'batch_size'}
        }
    )

    print(f"Exported to: {output_path}")

    # Verify and simplify
    try:
        import onnx
        from onnxsim import simplify

        print("\nSimplifying ONNX model...")
        onnx_model = onnx.load(str(output_path))
        model_simplified, check = simplify(onnx_model)

        if check:
            onnx.save(model_simplified, str(output_path))
            print("Simplification successful")
        else:
            print("Warning: Simplification check failed, keeping original")

        # Verify
        onnx.checker.check_model(onnx.load(str(output_path)))
        print("ONNX model verification passed")

    except ImportError:
        print("Warning: onnx/onnxsim not installed, skipping simplification")

    # Test inference
    print("\nTesting ONNX Runtime inference...")
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(output_path))
        test_input = np.random.randn(1, 3, h, w).astype(np.float32)

        import time
        start = time.time()
        result = session.run(['embedding'], {'input': test_input})
        inference_time = (time.time() - start) * 1000

        print(f"Output shape: {result[0].shape}")  # Should be [1, embedding_dim]
        print(f"Inference time: {inference_time:.2f}ms")

        # Verify output is normalized
        norm = np.linalg.norm(result[0])
        print(f"Embedding L2 norm: {norm:.4f} (should be ~1.0)")

    except ImportError:
        print("Warning: onnxruntime not installed, skipping inference test")

    # Get file size
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"\nONNX model size: {size_mb:.2f} MB")

    # Save model info
    info_path = output_path.parent / "model_info.json"
    info = {
        "model_type": "vehicle_reid",
        "onnx_file": output_path.name,
        "input_name": "input",
        "output_name": "embedding",
        "input_shape": [1, 3, h, w],
        "output_shape": [1, embedding_dim],
        "embedding_dim": embedding_dim,
        "input_format": "NCHW",
        "color_space": "RGB",
        "preprocessing": {
            "resize": [h, w],
            "normalize": {
                "mean": [0.485, 0.456, 0.406],
                "std": [0.229, 0.224, 0.225]
            }
        },
        "similarity_metric": "cosine",
        "recommended_threshold": 0.65,
        "exported_at": datetime.now().isoformat()
    }

    with open(info_path, 'w') as f:
        json.dump(info, f, indent=2)

    print(f"Model info saved to: {info_path}")

    return True


def create_fallback_reid_model(embedding_dim: int = 512):
    """Create a fallback ReID model if import fails."""
    import torchvision.models as models

    class FallbackReIDModel(nn.Module):
        def __init__(self, embedding_dim):
            super().__init__()
            base = models.resnet50(pretrained=True)
            self.backbone = nn.Sequential(*list(base.children())[:-2])
            self.pool = nn.AdaptiveAvgPool2d(1)
            self.bottleneck = nn.Sequential(
                nn.Linear(2048, embedding_dim),
                nn.BatchNorm1d(embedding_dim),
                nn.ReLU(inplace=True)
            )
            self.classifier = nn.Linear(embedding_dim, 100)

        def forward(self, x):
            features = self.backbone(x)
            pooled = self.pool(features).flatten(1)
            embedding = self.bottleneck(pooled)
            return F.normalize(embedding, p=2, dim=1)

    return FallbackReIDModel(embedding_dim)


def export_makemodel_model(
    checkpoint_path: Path,
    output_path: Path,
    input_size: tuple = (224, 224)
):
    """
    Export Make/Model classifier to ONNX.

    Args:
        checkpoint_path: Path to PyTorch checkpoint
        output_path: Path for ONNX output
        input_size: (height, width) of input
    """
    print(f"\n{'='*60}")
    print("EXPORTING MAKE/MODEL CLASSIFIER TO ONNX")
    print(f"{'='*60}")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Output: {output_path}")

    # Load checkpoint
    checkpoint = torch.load(checkpoint_path, map_location='cpu')

    config = checkpoint.get('config', {})
    num_makes = checkpoint.get('num_makes', 50)
    num_models = checkpoint.get('num_models', 500)
    num_years = checkpoint.get('num_years', 20)

    print(f"Num makes: {num_makes}")
    print(f"Num models: {num_models}")
    print(f"Num years: {num_years}")

    # Rebuild model (simplified version)
    try:
        import timm

        class MakeModelClassifier(nn.Module):
            def __init__(self, num_makes, num_models, num_years):
                super().__init__()
                self.backbone = timm.create_model(
                    'efficientnet_b4',
                    pretrained=False,
                    num_classes=0,
                    global_pool='avg'
                )
                backbone_dim = 1792

                self.make_head = nn.Linear(backbone_dim, num_makes)
                self.model_head = nn.Linear(backbone_dim, num_models)
                self.year_head = nn.Linear(backbone_dim, num_years)

            def forward(self, x):
                features = self.backbone(x)
                make_logits = F.softmax(self.make_head(features), dim=1)
                model_logits = F.softmax(self.model_head(features), dim=1)
                year_logits = F.softmax(self.year_head(features), dim=1)
                return make_logits, model_logits, year_logits

        model = MakeModelClassifier(num_makes, num_models, num_years)

    except ImportError:
        print("Error: timm not installed")
        return False

    model.load_state_dict(checkpoint['model_state_dict'], strict=False)
    model.eval()

    # Create dummy input
    h, w = input_size
    dummy_input = torch.randn(1, 3, h, w)

    # Export
    print("\nExporting to ONNX...")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy_input,
        str(output_path),
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['make_probs', 'model_probs', 'year_probs'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'make_probs': {0: 'batch_size'},
            'model_probs': {0: 'batch_size'},
            'year_probs': {0: 'batch_size'}
        }
    )

    print(f"Exported to: {output_path}")

    # Get file size
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"\nONNX model size: {size_mb:.2f} MB")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Export trained models to ONNX format"
    )
    parser.add_argument(
        "--model",
        type=Path,
        help="Path to PyTorch checkpoint"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "models",
        help="Output directory"
    )
    parser.add_argument(
        "--type",
        choices=["reid", "makemodel", "auto"],
        default="auto",
        help="Model type (auto-detect from checkpoint)"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Export all available models"
    )

    args = parser.parse_args()

    if args.all:
        # Export all models found in training directories
        models_dir = Path(__file__).parent.parent / "models"

        reid_checkpoint = models_dir / "reid_training" / "vehicle_reid_final.pth"
        if reid_checkpoint.exists():
            export_reid_model(
                reid_checkpoint,
                models_dir / "vehicle_reid.onnx"
            )

        makemodel_checkpoint = models_dir / "makemodel_training" / "vehicle_makemodel_final.pth"
        if makemodel_checkpoint.exists():
            export_makemodel_model(
                makemodel_checkpoint,
                models_dir / "vehicle_makemodel.onnx"
            )

    elif args.model:
        if not args.model.exists():
            print(f"ERROR: Checkpoint not found: {args.model}")
            return

        # Auto-detect model type
        model_type = args.type
        if model_type == "auto":
            if "reid" in str(args.model).lower():
                model_type = "reid"
            elif "makemodel" in str(args.model).lower():
                model_type = "makemodel"
            else:
                print("Could not auto-detect model type. Please specify --type")
                return

        if model_type == "reid":
            output_path = args.output / "vehicle_reid.onnx"
            export_reid_model(args.model, output_path)
        else:
            output_path = args.output / "vehicle_makemodel.onnx"
            export_makemodel_model(args.model, output_path)

    else:
        parser.print_help()

    print(f"\n{'='*60}")
    print("ONNX EXPORT COMPLETE")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
