"""
RaceTagger ML Training - Utility Functions

Shared functions used across training scripts.
"""

import os
import json
import hashlib
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from PIL import Image
import tensorflow as tf


# ═══════════════════════════════════════════════════════════════
# Path Utilities
# ═══════════════════════════════════════════════════════════════

def get_project_root() -> Path:
    """Get ml-training directory root."""
    return Path(__file__).parent.parent


def get_dataset_path(subset: str = 'raw') -> Path:
    """Get dataset directory path."""
    return get_project_root() / 'f1_scenes_dataset' / subset


def get_models_path() -> Path:
    """Get models directory path."""
    return get_project_root() / 'models'


def ensure_dir(path: Path) -> Path:
    """Ensure directory exists, create if not."""
    path.mkdir(parents=True, exist_ok=True)
    return path


# ═══════════════════════════════════════════════════════════════
# Image Utilities
# ═══════════════════════════════════════════════════════════════

def load_image(image_path: str, target_size: Optional[Tuple[int, int]] = None) -> np.ndarray:
    """
    Load image from path and optionally resize.

    Args:
        image_path: Path to image file
        target_size: Optional (width, height) to resize to

    Returns:
        Numpy array with shape (height, width, channels)
    """
    img = Image.open(image_path).convert('RGB')

    if target_size:
        img = img.resize(target_size, Image.Resampling.LANCZOS)

    return np.array(img)


def preprocess_image_for_model(
    img: np.ndarray,
    normalize: bool = True
) -> np.ndarray:
    """
    Preprocess image for model input.

    Args:
        img: Image array (H, W, C)
        normalize: Whether to normalize to [0, 1]

    Returns:
        Preprocessed image array
    """
    img = img.astype(np.float32)

    if normalize:
        img = img / 255.0

    return img


def compute_image_hash(image_path: str) -> str:
    """Compute MD5 hash of image file."""
    with open(image_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


# ═══════════════════════════════════════════════════════════════
# Dataset Utilities
# ═══════════════════════════════════════════════════════════════

def get_category_distribution(dataset_path: Path) -> Dict[str, int]:
    """
    Get distribution of images per category.

    Args:
        dataset_path: Path to dataset directory (with category subdirs)

    Returns:
        Dict mapping category name to image count
    """
    distribution = {}

    for category_dir in dataset_path.iterdir():
        if category_dir.is_dir():
            images = list(category_dir.glob('*.jpg')) + \
                    list(category_dir.glob('*.png')) + \
                    list(category_dir.glob('*.jpeg'))
            distribution[category_dir.name] = len(images)

    return distribution


def validate_dataset_structure(dataset_path: Path, expected_categories: List[str]) -> bool:
    """
    Validate dataset has expected structure.

    Args:
        dataset_path: Path to dataset root
        expected_categories: List of expected category names

    Returns:
        True if valid, False otherwise
    """
    if not dataset_path.exists():
        print(f"❌ Dataset path does not exist: {dataset_path}")
        return False

    for category in expected_categories:
        category_path = dataset_path / category
        if not category_path.exists():
            print(f"❌ Missing category: {category}")
            return False

        images = list(category_path.glob('*.jpg')) + \
                list(category_path.glob('*.png'))

        if len(images) == 0:
            print(f"⚠️  Category {category} has no images")

    return True


def print_dataset_stats(dataset_path: Path):
    """Print dataset statistics."""
    distribution = get_category_distribution(dataset_path)

    total = sum(distribution.values())

    print("\n" + "="*60)
    print(f"📊 Dataset Statistics: {dataset_path.name}")
    print("="*60)

    for category, count in sorted(distribution.items()):
        percentage = (count / total * 100) if total > 0 else 0
        bar_length = int(percentage / 2)  # 50 chars max
        bar = "█" * bar_length + "░" * (50 - bar_length)
        print(f"{category:20s} {count:5d} ({percentage:5.1f}%) {bar}")

    print("-"*60)
    print(f"{'TOTAL':20s} {total:5d} (100.0%)")
    print("="*60)


# ═══════════════════════════════════════════════════════════════
# Model Utilities
# ═══════════════════════════════════════════════════════════════

def save_model_metadata(
    model_path: Path,
    metadata: Dict,
    filename: str = 'metadata.json'
):
    """Save model metadata to JSON."""
    metadata_path = model_path / filename

    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2, default=str)

    print(f"✅ Saved metadata: {metadata_path}")


def load_model_metadata(
    model_path: Path,
    filename: str = 'metadata.json'
) -> Dict:
    """Load model metadata from JSON."""
    metadata_path = model_path / filename

    if not metadata_path.exists():
        return {}

    with open(metadata_path, 'r') as f:
        return json.load(f)


def get_gpu_info() -> Dict:
    """Get GPU information."""
    gpus = tf.config.list_physical_devices('GPU')

    info = {
        'available': len(gpus) > 0,
        'count': len(gpus),
        'devices': []
    }

    for gpu in gpus:
        info['devices'].append({
            'name': gpu.name,
            'type': gpu.device_type
        })

    return info


def print_gpu_info():
    """Print GPU information."""
    info = get_gpu_info()

    print("\n" + "="*60)
    print("🖥️  GPU Information")
    print("="*60)

    if info['available']:
        print(f"✅ GPU Available: {info['count']} device(s)")
        for i, device in enumerate(info['devices']):
            print(f"   GPU {i}: {device['name']}")
    else:
        print("⚠️  No GPU detected. Training will use CPU (slow).")
        print("   Consider using Google Colab for free GPU access.")

    print("="*60)


# ═══════════════════════════════════════════════════════════════
# Training Utilities
# ═══════════════════════════════════════════════════════════════

def compute_class_weights(dataset_path: Path) -> Dict[int, float]:
    """
    Compute class weights for imbalanced dataset.

    Args:
        dataset_path: Path to dataset with category subdirs

    Returns:
        Dict mapping class index to weight
    """
    distribution = get_category_distribution(dataset_path)

    # Sort by category name for consistent ordering
    categories = sorted(distribution.keys())
    counts = [distribution[cat] for cat in categories]

    # Inverse frequency weighting
    total = sum(counts)
    num_classes = len(counts)

    weights = {}
    for i, count in enumerate(counts):
        weights[i] = total / (num_classes * count)

    return weights


def format_time(seconds: float) -> str:
    """Format seconds to human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        secs = int(seconds % 60)
        return f"{minutes}m {secs}s"
    else:
        hours = int(seconds / 3600)
        minutes = int((seconds % 3600) / 60)
        return f"{hours}h {minutes}m"


def format_bytes(bytes_size: int) -> str:
    """Format bytes to human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"


# ═══════════════════════════════════════════════════════════════
# Configuration Utilities
# ═══════════════════════════════════════════════════════════════

def load_config(config_name: str) -> Dict:
    """
    Load configuration from configs directory.

    Args:
        config_name: Name of config file (without .json)

    Returns:
        Configuration dictionary
    """
    config_path = get_project_root() / 'configs' / f'{config_name}.json'

    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(config_path, 'r') as f:
        return json.load(f)


def save_config(config: Dict, config_name: str):
    """Save configuration to configs directory."""
    config_path = get_project_root() / 'configs' / f'{config_name}.json'

    ensure_dir(config_path.parent)

    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)

    print(f"✅ Saved config: {config_path}")


# ═══════════════════════════════════════════════════════════════
# Logging Utilities
# ═══════════════════════════════════════════════════════════════

class ProgressLogger:
    """Simple progress logger for long-running operations."""

    def __init__(self, total: int, description: str = "Processing"):
        self.total = total
        self.current = 0
        self.description = description
        self.start_time = None

    def start(self):
        """Start progress tracking."""
        self.start_time = __import__('time').time()
        self.update(0)

    def update(self, count: int = 1):
        """Update progress."""
        self.current += count

        if self.start_time is None:
            self.start()
            return

        elapsed = __import__('time').time() - self.start_time
        progress = self.current / self.total

        eta = (elapsed / progress - elapsed) if progress > 0 else 0

        bar_length = 40
        filled = int(bar_length * progress)
        bar = "█" * filled + "░" * (bar_length - filled)

        print(f"\r{self.description}: {bar} {self.current}/{self.total} "
              f"({progress*100:.1f}%) - ETA: {format_time(eta)}",
              end='', flush=True)

    def finish(self):
        """Finish progress tracking."""
        elapsed = __import__('time').time() - self.start_time
        print(f"\n✅ Completed in {format_time(elapsed)}")


# ═══════════════════════════════════════════════════════════════
# Validation Utilities
# ═══════════════════════════════════════════════════════════════

def validate_image_file(image_path: str) -> bool:
    """
    Validate that file is a valid image.

    Args:
        image_path: Path to image file

    Returns:
        True if valid, False otherwise
    """
    try:
        img = Image.open(image_path)
        img.verify()
        return True
    except Exception:
        return False


def check_disk_space(path: Path, required_gb: float = 5.0) -> bool:
    """
    Check if there's enough disk space.

    Args:
        path: Path to check
        required_gb: Required space in GB

    Returns:
        True if enough space, False otherwise
    """
    import shutil

    stat = shutil.disk_usage(path)
    free_gb = stat.free / (1024 ** 3)

    if free_gb < required_gb:
        print(f"⚠️  Low disk space: {free_gb:.1f} GB free (need {required_gb:.1f} GB)")
        return False

    return True


# ═══════════════════════════════════════════════════════════════
# Export
# ═══════════════════════════════════════════════════════════════

__all__ = [
    # Path utilities
    'get_project_root',
    'get_dataset_path',
    'get_models_path',
    'ensure_dir',

    # Image utilities
    'load_image',
    'preprocess_image_for_model',
    'compute_image_hash',

    # Dataset utilities
    'get_category_distribution',
    'validate_dataset_structure',
    'print_dataset_stats',

    # Model utilities
    'save_model_metadata',
    'load_model_metadata',
    'get_gpu_info',
    'print_gpu_info',

    # Training utilities
    'compute_class_weights',
    'format_time',
    'format_bytes',

    # Configuration utilities
    'load_config',
    'save_config',

    # Logging utilities
    'ProgressLogger',

    # Validation utilities
    'validate_image_file',
    'check_disk_space',
]
