#!/usr/bin/env python3
"""
RaceTagger ML Training - Dataset Preparation Script

Preprocesses raw images and splits into train/val/test sets.

Features:
- Image validation and quality checks
- Duplicate detection using perceptual hashing
- Automatic resizing and normalization
- Stratified train/val/test split (70/20/10)
- Data augmentation preview

Usage:
    python 02-prepare-dataset.py [--preview-augmentation]
"""

import os
import sys
import shutil
import random
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import json

import cv2
import numpy as np
from PIL import Image
from sklearn.model_selection import train_test_split

from utils import (
    get_project_root,
    get_dataset_path,
    ensure_dir,
    load_image,
    validate_image_file,
    compute_image_hash,
    print_dataset_stats,
    ProgressLogger,
    get_category_distribution
)

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

# Load training config
CONFIG_PATH = get_project_root() / 'ml-training' / 'configs' / 'training_config.json'
with open(CONFIG_PATH) as f:
    CONFIG = json.load(f)

TARGET_SIZE = tuple(CONFIG['model']['input_size'][:2])  # (224, 224)
SPLIT_RATIOS = CONFIG['dataset']  # train: 0.7, val: 0.2, test: 0.1
RANDOM_SEED = CONFIG['dataset']['seed']  # 42

# Image quality thresholds
MIN_WIDTH = 300
MIN_HEIGHT = 300
MAX_FILE_SIZE_MB = 20
MIN_FILE_SIZE_KB = 10

# Duplicate detection
HASH_SIMILARITY_THRESHOLD = 5  # Hamming distance for perceptual hash

# ═══════════════════════════════════════════════════════════════
# Image Validation
# ═══════════════════════════════════════════════════════════════

def check_image_quality(image_path: Path) -> Tuple[bool, Optional[str]]:
    """
    Validate image quality and detect issues.

    Returns:
        (is_valid, error_message)
    """

    # Check file size
    file_size_mb = image_path.stat().st_size / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        return False, f"File too large: {file_size_mb:.1f}MB"

    file_size_kb = image_path.stat().st_size / 1024
    if file_size_kb < MIN_FILE_SIZE_KB:
        return False, f"File too small: {file_size_kb:.1f}KB (likely corrupted)"

    try:
        # Load image
        img = Image.open(image_path)

        # Check dimensions
        width, height = img.size
        if width < MIN_WIDTH or height < MIN_HEIGHT:
            return False, f"Resolution too low: {width}x{height}"

        # Check if image is readable
        img.verify()

        # Reopen for actual pixel check (verify() closes the file)
        img = Image.open(image_path)

        # Try to load pixels (catches some corruption issues)
        img.load()

        # Check for completely black or white images
        img_array = np.array(img.convert('RGB'))
        mean_val = img_array.mean()
        std_val = img_array.std()

        if std_val < 5:  # Very low variance = likely blank image
            return False, f"Image appears blank (std={std_val:.2f})"

        if mean_val < 10 or mean_val > 245:
            return False, f"Image too dark/bright (mean={mean_val:.2f})"

        return True, None

    except Exception as e:
        return False, f"Corrupted or invalid: {str(e)}"


def find_duplicates(
    image_paths: List[Path],
    threshold: int = HASH_SIMILARITY_THRESHOLD
) -> Dict[str, List[Path]]:
    """
    Find duplicate/near-duplicate images using perceptual hashing.

    Returns:
        Dictionary mapping hash to list of similar images
    """

    print("\n🔍 Detecting duplicates...")

    hash_to_paths = defaultdict(list)

    progress = ProgressLogger(len(image_paths), "Hashing images")

    for img_path in image_paths:
        try:
            img_hash = compute_image_hash(str(img_path))
            hash_to_paths[img_hash].append(img_path)
            progress.update()
        except Exception as e:
            print(f"\n  ⚠️  Error hashing {img_path.name}: {e}")

    progress.finish()

    # Find groups of similar images
    duplicate_groups = {}
    processed_hashes = set()

    all_hashes = list(hash_to_paths.keys())

    for i, hash1 in enumerate(all_hashes):
        if hash1 in processed_hashes:
            continue

        similar_group = [hash1]

        for hash2 in all_hashes[i+1:]:
            if hash2 in processed_hashes:
                continue

            # Calculate Hamming distance
            distance = bin(int(hash1, 16) ^ int(hash2, 16)).count('1')

            if distance <= threshold:
                similar_group.append(hash2)
                processed_hashes.add(hash2)

        if len(similar_group) > 1:
            # Merge all similar images
            all_similar_paths = []
            for h in similar_group:
                all_similar_paths.extend(hash_to_paths[h])
            duplicate_groups[hash1] = all_similar_paths

        processed_hashes.add(hash1)

    if duplicate_groups:
        print(f"\n  Found {len(duplicate_groups)} groups of similar images")
        for group_hash, paths in duplicate_groups.items():
            print(f"    Group: {len(paths)} similar images")
    else:
        print("  ✅ No duplicates found")

    return duplicate_groups


def remove_duplicates(
    duplicate_groups: Dict[str, List[Path]],
    strategy: str = "keep_first"
) -> List[Path]:
    """
    Remove duplicate images, keeping one representative per group.

    Strategies:
    - keep_first: Keep first image in group
    - keep_largest: Keep image with largest file size
    - keep_best_quality: Keep image with best estimated quality

    Returns:
        List of paths to remove
    """

    to_remove = []

    for group_hash, paths in duplicate_groups.items():
        if strategy == "keep_first":
            # Keep first, remove rest
            to_remove.extend(paths[1:])

        elif strategy == "keep_largest":
            # Keep largest file
            sorted_paths = sorted(paths, key=lambda p: p.stat().st_size, reverse=True)
            to_remove.extend(sorted_paths[1:])

        elif strategy == "keep_best_quality":
            # Estimate quality by resolution and file size
            quality_scores = []
            for path in paths:
                img = Image.open(path)
                w, h = img.size
                size_mb = path.stat().st_size / (1024 * 1024)
                quality = (w * h) * size_mb  # Simple quality metric
                quality_scores.append(quality)

            best_idx = quality_scores.index(max(quality_scores))
            to_remove.extend([p for i, p in enumerate(paths) if i != best_idx])

    return to_remove


# ═══════════════════════════════════════════════════════════════
# Dataset Preparation
# ═══════════════════════════════════════════════════════════════

def prepare_dataset(
    skip_duplicate_check: bool = False,
    preview_augmentation: bool = False
):
    """
    Main dataset preparation pipeline.
    """

    print("\n" + "="*60)
    print("📦 RaceTagger Dataset Preparation")
    print("="*60)

    raw_path = get_dataset_path('raw')
    processed_path = get_dataset_path('processed')

    # Get all categories
    categories = [d.name for d in raw_path.iterdir() if d.is_dir()]

    if not categories:
        print("❌ No categories found in raw dataset!")
        print(f"   Expected structure: {raw_path}/<category>/*.jpg")
        sys.exit(1)

    print(f"\n📊 Dataset Statistics:")
    print_dataset_stats(raw_path)

    # ───────────────────────────────────────────────────────────
    # Step 1: Validate images
    # ───────────────────────────────────────────────────────────

    print("\n" + "─"*60)
    print("Step 1: Validating images...")
    print("─"*60)

    valid_images = {}
    invalid_images = {}

    for category in categories:
        category_path = raw_path / category
        image_files = list(category_path.glob("*.jpg")) + list(category_path.glob("*.jpeg")) + list(category_path.glob("*.png"))

        print(f"\n  {category}: {len(image_files)} images")

        valid_images[category] = []
        invalid_images[category] = []

        progress = ProgressLogger(len(image_files), f"Validating {category}")

        for img_path in image_files:
            is_valid, error_msg = check_image_quality(img_path)

            if is_valid:
                valid_images[category].append(img_path)
            else:
                invalid_images[category].append((img_path, error_msg))

            progress.update()

        progress.finish()

        if invalid_images[category]:
            print(f"\n  ⚠️  {len(invalid_images[category])} invalid images:")
            for img_path, error in invalid_images[category][:5]:  # Show first 5
                print(f"      - {img_path.name}: {error}")
            if len(invalid_images[category]) > 5:
                print(f"      ... and {len(invalid_images[category]) - 5} more")

    # ───────────────────────────────────────────────────────────
    # Step 2: Detect and remove duplicates
    # ───────────────────────────────────────────────────────────

    if not skip_duplicate_check:
        print("\n" + "─"*60)
        print("Step 2: Detecting duplicates...")
        print("─"*60)

        all_removed = []

        for category in categories:
            if not valid_images[category]:
                continue

            print(f"\n  {category}:")

            duplicates = find_duplicates(valid_images[category])

            if duplicates:
                to_remove = remove_duplicates(duplicates, strategy="keep_best_quality")
                all_removed.extend(to_remove)

                # Update valid images list
                valid_images[category] = [p for p in valid_images[category] if p not in to_remove]

                print(f"    Removing {len(to_remove)} duplicate images")

        if all_removed:
            print(f"\n  ℹ️  Total duplicates to remove: {len(all_removed)}")
            print("    (Files not deleted yet, will be skipped in processing)")

    # ───────────────────────────────────────────────────────────
    # Step 3: Split dataset
    # ───────────────────────────────────────────────────────────

    print("\n" + "─"*60)
    print("Step 3: Splitting dataset...")
    print("─"*60)

    train_split = SPLIT_RATIOS['train_split']
    val_split = SPLIT_RATIOS['val_split']
    test_split = SPLIT_RATIOS['test_split']

    print(f"\n  Split ratios: train={train_split}, val={val_split}, test={test_split}")

    splits = {'train': {}, 'val': {}, 'test': {}}

    for category in categories:
        if not valid_images[category]:
            print(f"\n  ⚠️  {category}: No valid images, skipping")
            continue

        images = valid_images[category]
        n_images = len(images)

        # Shuffle
        random.seed(RANDOM_SEED)
        random.shuffle(images)

        # Calculate split sizes
        n_train = int(n_images * train_split)
        n_val = int(n_images * val_split)
        n_test = n_images - n_train - n_val

        # Split
        splits['train'][category] = images[:n_train]
        splits['val'][category] = images[n_train:n_train+n_val]
        splits['test'][category] = images[n_train+n_val:]

        print(f"\n  {category}:")
        print(f"    Train: {n_train} images ({n_train/n_images*100:.1f}%)")
        print(f"    Val:   {n_val} images ({n_val/n_images*100:.1f}%)")
        print(f"    Test:  {n_test} images ({n_test/n_images*100:.1f}%)")

    # ───────────────────────────────────────────────────────────
    # Step 4: Process and copy images
    # ───────────────────────────────────────────────────────────

    print("\n" + "─"*60)
    print("Step 4: Processing images...")
    print("─"*60)

    print(f"  Target size: {TARGET_SIZE[0]}x{TARGET_SIZE[1]}")

    for split_name in ['train', 'val', 'test']:
        print(f"\n  Processing {split_name} set...")

        split_path = processed_path / split_name

        for category in categories:
            if category not in splits[split_name] or not splits[split_name][category]:
                continue

            category_output = split_path / category
            ensure_dir(category_output)

            images = splits[split_name][category]

            progress = ProgressLogger(len(images), f"{split_name}/{category}")

            for img_path in images:
                try:
                    # Load and resize
                    img = load_image(str(img_path), target_size=TARGET_SIZE)

                    # Convert back to PIL for saving
                    img_pil = Image.fromarray((img * 255).astype(np.uint8))

                    # Save to output directory
                    output_path = category_output / img_path.name
                    img_pil.save(output_path, quality=95)

                    progress.update()

                except Exception as e:
                    print(f"\n  ❌ Error processing {img_path.name}: {e}")

            progress.finish()

    # ───────────────────────────────────────────────────────────
    # Step 5: Create dataset metadata
    # ───────────────────────────────────────────────────────────

    print("\n" + "─"*60)
    print("Step 5: Creating metadata...")
    print("─"*60)

    metadata = {
        'categories': categories,
        'category_to_index': {cat: i for i, cat in enumerate(sorted(categories))},
        'split_ratios': {
            'train': train_split,
            'val': val_split,
            'test': test_split
        },
        'target_size': list(TARGET_SIZE),
        'total_images': {},
        'split_counts': {}
    }

    for split_name in ['train', 'val', 'test']:
        split_path = processed_path / split_name

        metadata['split_counts'][split_name] = {}

        for category in categories:
            category_path = split_path / category
            if category_path.exists():
                n_images = len(list(category_path.glob("*.jpg")))
                metadata['split_counts'][split_name][category] = n_images

                if category not in metadata['total_images']:
                    metadata['total_images'][category] = 0
                metadata['total_images'][category] += n_images

    metadata_path = processed_path / 'dataset_metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  ✅ Metadata saved: {metadata_path}")

    # ───────────────────────────────────────────────────────────
    # Summary
    # ───────────────────────────────────────────────────────────

    print("\n" + "="*60)
    print("✅ Dataset Preparation Complete!")
    print("="*60)

    print("\n📊 Final Dataset:")
    print_dataset_stats(processed_path)

    print("\n📁 Output Structure:")
    print(f"  {processed_path}/")
    print("  ├── train/")
    print("  │   ├── racing_action/")
    print("  │   ├── portrait_paddock/")
    print("  │   └── ...")
    print("  ├── val/")
    print("  │   └── ...")
    print("  ├── test/")
    print("  │   └── ...")
    print("  └── dataset_metadata.json")

    print("\n🚀 Next Steps:")
    print("1. Review dataset balance in each split")
    print("2. Run training: python scripts/03-train-scene-classifier.py")

    # ───────────────────────────────────────────────────────────
    # Optional: Preview augmentation
    # ───────────────────────────────────────────────────────────

    if preview_augmentation:
        print("\n" + "─"*60)
        print("Preview: Data Augmentation")
        print("─"*60)

        preview_augmentation_samples(processed_path / 'train')


def preview_augmentation_samples(train_path: Path, n_samples: int = 3):
    """
    Preview augmentation by showing before/after examples.
    """

    from tensorflow.keras.preprocessing.image import ImageDataGenerator
    import matplotlib.pyplot as plt

    # Load augmentation config
    aug_config_path = get_project_root() / 'ml-training' / 'configs' / 'augmentation_config.json'
    with open(aug_config_path) as f:
        aug_config = json.load(f)['training_augmentation']

    # Create data generator
    datagen = ImageDataGenerator(
        rotation_range=aug_config['rotation_range']['degrees'],
        width_shift_range=aug_config['width_shift_range']['factor'],
        height_shift_range=aug_config['height_shift_range']['factor'],
        shear_range=aug_config['shear_range']['factor'],
        zoom_range=aug_config['zoom_range']['factor'],
        horizontal_flip=aug_config['horizontal_flip']['enabled'],
        brightness_range=[aug_config['brightness_range']['min'], aug_config['brightness_range']['max']],
        fill_mode=aug_config['fill_mode']['mode']
    )

    # Get sample images
    categories = [d.name for d in train_path.iterdir() if d.is_dir()]

    for category in categories[:2]:  # Show 2 categories
        category_path = train_path / category
        image_files = list(category_path.glob("*.jpg"))

        if not image_files:
            continue

        sample_path = random.choice(image_files)

        img = load_image(str(sample_path), target_size=TARGET_SIZE)
        img = np.expand_dims(img, axis=0)

        print(f"\n  {category}: {sample_path.name}")

        # Generate augmented samples
        fig, axes = plt.subplots(1, n_samples + 1, figsize=(15, 3))

        # Original
        axes[0].imshow(img[0])
        axes[0].set_title("Original")
        axes[0].axis('off')

        # Augmented
        i = 0
        for batch in datagen.flow(img, batch_size=1):
            axes[i + 1].imshow(batch[0])
            axes[i + 1].set_title(f"Augmented {i+1}")
            axes[i + 1].axis('off')
            i += 1
            if i >= n_samples:
                break

        plt.tight_layout()

        # Save preview
        preview_path = get_project_root() / 'ml-training' / f'augmentation_preview_{category}.png'
        plt.savefig(preview_path, dpi=150)
        print(f"    Preview saved: {preview_path}")

        plt.close()


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Prepare F1 dataset for training'
    )

    parser.add_argument(
        '--skip-duplicate-check',
        action='store_true',
        help='Skip duplicate detection step'
    )

    parser.add_argument(
        '--preview-augmentation',
        action='store_true',
        help='Generate augmentation preview images'
    )

    args = parser.parse_args()

    try:
        prepare_dataset(
            skip_duplicate_check=args.skip_duplicate_check,
            preview_augmentation=args.preview_augmentation
        )
    except KeyboardInterrupt:
        print("\n\n⚠️  Preparation interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
