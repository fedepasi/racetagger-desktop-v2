#!/usr/bin/env python3
"""
02-prepare-dataset.py

Prepare datasets for Vehicle ReID and Make/Model training.

Supports:
1. Roboflow export (YOLO/COCO format) → vehicle crops
2. Custom folder structure → standardized format
3. VMMRdb dataset → training splits

Usage:
    python scripts/02-prepare-dataset.py --input datasets/raw --output datasets/prepared
    python scripts/02-prepare-dataset.py --roboflow path/to/roboflow/export
    python scripts/02-prepare-dataset.py --vmmrdb path/to/vmmrdb
"""

import os
import sys
import json
import argparse
import shutil
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm
from sklearn.model_selection import train_test_split

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Configuration
# ============================================

REID_INPUT_SIZE = (128, 256)  # Width x Height (standard for vehicle ReID)
MAKEMODEL_INPUT_SIZE = (224, 224)  # Square for classification

MIN_IMAGES_PER_VEHICLE = 2  # Minimum images per vehicle for ReID training
TRAIN_RATIO = 0.7
VAL_RATIO = 0.15
TEST_RATIO = 0.15


def load_roboflow_annotations(export_path: Path, format: str = "yolo") -> Dict:
    """
    Load annotations from Roboflow export.

    Args:
        export_path: Path to Roboflow export folder
        format: 'yolo' or 'coco'

    Returns:
        Dict with image paths and bounding boxes
    """
    annotations = {}

    if format == "yolo":
        # YOLO format: images/ and labels/ folders
        images_dir = export_path / "images"
        labels_dir = export_path / "labels"

        if not images_dir.exists():
            # Try train/valid/test structure
            for split in ["train", "valid", "test"]:
                split_images = export_path / split / "images"
                split_labels = export_path / split / "labels"

                if split_images.exists():
                    for img_path in split_images.glob("*.[jJ][pP][gG]"):
                        label_path = split_labels / f"{img_path.stem}.txt"
                        if label_path.exists():
                            annotations[img_path] = parse_yolo_label(label_path)
        else:
            for img_path in images_dir.glob("*.[jJ][pP][gG]"):
                label_path = labels_dir / f"{img_path.stem}.txt"
                if label_path.exists():
                    annotations[img_path] = parse_yolo_label(label_path)

    elif format == "coco":
        # COCO format: annotations.json
        coco_file = export_path / "_annotations.coco.json"
        if not coco_file.exists():
            coco_file = export_path / "annotations.json"

        if coco_file.exists():
            with open(coco_file) as f:
                coco_data = json.load(f)

            # Build image_id to filename mapping
            id_to_file = {img["id"]: img["file_name"] for img in coco_data["images"]}

            # Group annotations by image
            for ann in coco_data["annotations"]:
                img_file = id_to_file[ann["image_id"]]
                img_path = export_path / img_file

                if img_path not in annotations:
                    annotations[img_path] = []

                # COCO bbox: [x, y, width, height]
                bbox = ann["bbox"]
                annotations[img_path].append({
                    "class_id": ann["category_id"],
                    "bbox": bbox,
                    "format": "xywh"
                })

    print(f"Loaded {len(annotations)} images with annotations")
    return annotations


def parse_yolo_label(label_path: Path) -> List[Dict]:
    """Parse YOLO format label file."""
    boxes = []
    with open(label_path) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                class_id = int(parts[0])
                x_center, y_center, width, height = map(float, parts[1:5])
                boxes.append({
                    "class_id": class_id,
                    "bbox": [x_center, y_center, width, height],
                    "format": "yolo"  # normalized center x,y,w,h
                })
    return boxes


def crop_vehicle_from_image(
    image_path: Path,
    bbox: Dict,
    output_size: Tuple[int, int] = REID_INPUT_SIZE,
    padding: float = 0.1
) -> Optional[np.ndarray]:
    """
    Crop vehicle from image using bounding box.

    Args:
        image_path: Path to image
        bbox: Bounding box dict with 'bbox' and 'format'
        output_size: (width, height) of output
        padding: Padding ratio around bbox

    Returns:
        Cropped and resized image as numpy array
    """
    img = cv2.imread(str(image_path))
    if img is None:
        return None

    h, w = img.shape[:2]
    box = bbox["bbox"]

    # Convert bbox to absolute coordinates
    if bbox["format"] == "yolo":
        # YOLO: normalized center x, y, w, h
        cx, cy, bw, bh = box
        x1 = int((cx - bw/2) * w)
        y1 = int((cy - bh/2) * h)
        x2 = int((cx + bw/2) * w)
        y2 = int((cy + bh/2) * h)
    elif bbox["format"] == "xywh":
        # COCO: absolute x, y, w, h
        x1, y1, bw, bh = map(int, box)
        x2 = x1 + bw
        y2 = y1 + bh
    else:
        # Assume xyxy
        x1, y1, x2, y2 = map(int, box)

    # Add padding
    pad_w = int((x2 - x1) * padding)
    pad_h = int((y2 - y1) * padding)
    x1 = max(0, x1 - pad_w)
    y1 = max(0, y1 - pad_h)
    x2 = min(w, x2 + pad_w)
    y2 = min(h, y2 + pad_h)

    # Crop
    crop = img[y1:y2, x1:x2]

    if crop.size == 0:
        return None

    # Resize
    crop = cv2.resize(crop, output_size)

    return crop


def prepare_reid_dataset(
    input_dir: Path,
    output_dir: Path,
    annotations: Optional[Dict] = None
):
    """
    Prepare dataset for Vehicle ReID training.

    Expected input structure:
    input_dir/
    ├── vehicle_001/
    │   ├── img1.jpg
    │   ├── img2.jpg
    │   └── ...
    ├── vehicle_002/
    └── ...

    Or with annotations dict from Roboflow.
    """
    print(f"\n{'='*60}")
    print("PREPARING VEHICLE REID DATASET")
    print(f"{'='*60}")

    output_dir.mkdir(parents=True, exist_ok=True)

    vehicle_images = defaultdict(list)

    if annotations:
        # From Roboflow annotations - group by detected class or file prefix
        print("Processing Roboflow annotations...")

        for img_path, boxes in tqdm(annotations.items()):
            for i, box in enumerate(boxes):
                # Use class_id + image stem as vehicle ID
                vehicle_id = f"class_{box['class_id']}_{img_path.stem}_{i}"

                crop = crop_vehicle_from_image(img_path, box, REID_INPUT_SIZE)
                if crop is not None:
                    vehicle_images[vehicle_id].append({
                        "image": crop,
                        "source": str(img_path),
                        "bbox": box
                    })
    else:
        # From folder structure
        print(f"Processing folder structure from: {input_dir}")

        for vehicle_dir in tqdm(list(input_dir.iterdir())):
            if not vehicle_dir.is_dir():
                continue

            vehicle_id = vehicle_dir.name

            for img_path in vehicle_dir.glob("*.[jJ][pP][gG]"):
                img = cv2.imread(str(img_path))
                if img is not None:
                    img = cv2.resize(img, REID_INPUT_SIZE)
                    vehicle_images[vehicle_id].append({
                        "image": img,
                        "source": str(img_path)
                    })

            for img_path in vehicle_dir.glob("*.[pP][nN][gG]"):
                img = cv2.imread(str(img_path))
                if img is not None:
                    img = cv2.resize(img, REID_INPUT_SIZE)
                    vehicle_images[vehicle_id].append({
                        "image": img,
                        "source": str(img_path)
                    })

    # Filter vehicles with minimum images
    valid_vehicles = {
        vid: imgs for vid, imgs in vehicle_images.items()
        if len(imgs) >= MIN_IMAGES_PER_VEHICLE
    }

    print(f"\nVehicles with {MIN_IMAGES_PER_VEHICLE}+ images: {len(valid_vehicles)}")
    print(f"Total images: {sum(len(imgs) for imgs in valid_vehicles.values())}")

    # Split into train/val/test
    vehicle_ids = list(valid_vehicles.keys())

    if len(vehicle_ids) < 3:
        print("WARNING: Not enough vehicles for proper split. Using all for training.")
        train_ids = vehicle_ids
        val_ids = []
        test_ids = []
    else:
        train_ids, temp_ids = train_test_split(
            vehicle_ids, train_size=TRAIN_RATIO, random_state=42
        )
        if len(temp_ids) >= 2:
            val_ids, test_ids = train_test_split(
                temp_ids, train_size=VAL_RATIO/(VAL_RATIO+TEST_RATIO), random_state=42
            )
        else:
            val_ids = temp_ids
            test_ids = []

    # Save images
    splits = {
        "train": train_ids,
        "val": val_ids,
        "test": test_ids
    }

    metadata = {
        "num_vehicles": len(valid_vehicles),
        "splits": {},
        "vehicle_to_id": {},
        "id_to_vehicle": {}
    }

    vehicle_idx = 0

    for split_name, split_ids in splits.items():
        split_dir = output_dir / split_name
        split_dir.mkdir(exist_ok=True)

        split_count = 0

        for vehicle_id in tqdm(split_ids, desc=f"Saving {split_name}"):
            vehicle_dir = split_dir / vehicle_id
            vehicle_dir.mkdir(exist_ok=True)

            metadata["vehicle_to_id"][vehicle_id] = vehicle_idx
            metadata["id_to_vehicle"][vehicle_idx] = vehicle_id

            for i, img_data in enumerate(valid_vehicles[vehicle_id]):
                img_path = vehicle_dir / f"{i:04d}.jpg"
                cv2.imwrite(str(img_path), img_data["image"])
                split_count += 1

            vehicle_idx += 1

        metadata["splits"][split_name] = {
            "num_vehicles": len(split_ids),
            "num_images": split_count
        }

    # Save metadata
    metadata_path = output_dir / "metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\nDataset saved to: {output_dir}")
    print(f"Metadata: {metadata_path}")
    print(f"\nSplit summary:")
    for split_name, info in metadata["splits"].items():
        print(f"  {split_name}: {info['num_vehicles']} vehicles, {info['num_images']} images")

    return metadata


def prepare_makemodel_dataset(
    input_dir: Path,
    output_dir: Path,
    class_labels: Optional[Path] = None
):
    """
    Prepare dataset for Make/Model classification.

    Expected input structure:
    input_dir/
    ├── Ferrari/
    │   ├── 488_GTB/
    │   │   ├── 2019/
    │   │   │   ├── img1.jpg
    │   │   │   └── ...
    │   │   └── 2020/
    │   └── F8_Tributo/
    ├── Porsche/
    └── ...

    Or flat structure with class_labels.json mapping.
    """
    print(f"\n{'='*60}")
    print("PREPARING MAKE/MODEL DATASET")
    print(f"{'='*60}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect all images with labels
    all_samples = []
    make_set = set()
    model_set = set()
    year_set = set()

    # Try hierarchical structure first
    for make_dir in input_dir.iterdir():
        if not make_dir.is_dir():
            continue

        make = make_dir.name
        make_set.add(make)

        for model_dir in make_dir.iterdir():
            if not model_dir.is_dir():
                continue

            model = model_dir.name
            model_set.add(f"{make}_{model}")

            # Check for year subdirectories
            has_years = any(d.is_dir() for d in model_dir.iterdir())

            if has_years:
                for year_dir in model_dir.iterdir():
                    if not year_dir.is_dir():
                        continue

                    year = year_dir.name
                    year_set.add(year)

                    for img_path in year_dir.glob("*.[jJ][pP][gG]"):
                        all_samples.append({
                            "path": img_path,
                            "make": make,
                            "model": model,
                            "year": year,
                            "full_label": f"{make}_{model}_{year}"
                        })
            else:
                for img_path in model_dir.glob("*.[jJ][pP][gG]"):
                    all_samples.append({
                        "path": img_path,
                        "make": make,
                        "model": model,
                        "year": "unknown",
                        "full_label": f"{make}_{model}"
                    })

    if not all_samples:
        print("No samples found in hierarchical structure.")
        print("Trying flat structure...")

        # Flat structure: all images in one folder with naming convention
        for img_path in input_dir.glob("**/*.[jJ][pP][gG]"):
            # Try to parse filename or use parent folder
            label = img_path.parent.name if img_path.parent != input_dir else img_path.stem
            parts = label.split("_")

            make = parts[0] if parts else "unknown"
            model = parts[1] if len(parts) > 1 else "unknown"
            year = parts[2] if len(parts) > 2 else "unknown"

            make_set.add(make)
            model_set.add(f"{make}_{model}")
            if year != "unknown":
                year_set.add(year)

            all_samples.append({
                "path": img_path,
                "make": make,
                "model": model,
                "year": year,
                "full_label": label
            })

    print(f"\nFound {len(all_samples)} samples")
    print(f"Makes: {len(make_set)}")
    print(f"Models: {len(model_set)}")
    print(f"Years: {len(year_set)}")

    if not all_samples:
        print("ERROR: No samples found!")
        return None

    # Create label mappings
    make_to_id = {make: i for i, make in enumerate(sorted(make_set))}
    model_to_id = {model: i for i, model in enumerate(sorted(model_set))}
    year_to_id = {year: i for i, year in enumerate(sorted(year_set))}

    # Split dataset
    train_samples, temp_samples = train_test_split(
        all_samples, train_size=TRAIN_RATIO, random_state=42
    )
    val_samples, test_samples = train_test_split(
        temp_samples, train_size=VAL_RATIO/(VAL_RATIO+TEST_RATIO), random_state=42
    )

    splits = {
        "train": train_samples,
        "val": val_samples,
        "test": test_samples
    }

    # Save images and labels
    for split_name, samples in splits.items():
        split_dir = output_dir / split_name
        split_dir.mkdir(exist_ok=True)

        labels = []

        for i, sample in enumerate(tqdm(samples, desc=f"Saving {split_name}")):
            # Load and resize image
            img = cv2.imread(str(sample["path"]))
            if img is None:
                continue

            img = cv2.resize(img, MAKEMODEL_INPUT_SIZE)

            # Save image
            output_path = split_dir / f"{i:06d}.jpg"
            cv2.imwrite(str(output_path), img)

            # Save label
            labels.append({
                "image": output_path.name,
                "make": sample["make"],
                "model": sample["model"],
                "year": sample["year"],
                "make_id": make_to_id[sample["make"]],
                "model_id": model_to_id.get(f"{sample['make']}_{sample['model']}", 0),
                "year_id": year_to_id.get(sample["year"], 0)
            })

        # Save labels JSON
        labels_path = split_dir / "labels.json"
        with open(labels_path, 'w') as f:
            json.dump(labels, f, indent=2)

    # Save class labels
    class_labels = {
        "makes": {v: k for k, v in make_to_id.items()},
        "models": {v: k for k, v in model_to_id.items()},
        "years": {v: k for k, v in year_to_id.items()},
        "num_makes": len(make_set),
        "num_models": len(model_set),
        "num_years": len(year_set)
    }

    labels_path = output_dir / "class_labels.json"
    with open(labels_path, 'w') as f:
        json.dump(class_labels, f, indent=2)

    print(f"\nDataset saved to: {output_dir}")
    print(f"Class labels: {labels_path}")

    return class_labels


def main():
    parser = argparse.ArgumentParser(
        description="Prepare datasets for Vehicle-API training"
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Input directory with raw images"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent / "datasets" / "prepared",
        help="Output directory for prepared dataset"
    )
    parser.add_argument(
        "--mode",
        choices=["reid", "makemodel", "both"],
        default="both",
        help="Dataset type to prepare"
    )
    parser.add_argument(
        "--roboflow",
        type=Path,
        help="Path to Roboflow export (for ReID with bounding boxes)"
    )
    parser.add_argument(
        "--roboflow-format",
        choices=["yolo", "coco"],
        default="yolo",
        help="Roboflow export format"
    )

    args = parser.parse_args()

    if args.roboflow:
        print(f"Loading Roboflow annotations from: {args.roboflow}")
        annotations = load_roboflow_annotations(args.roboflow, args.roboflow_format)

        if args.mode in ["reid", "both"]:
            prepare_reid_dataset(
                args.roboflow,
                args.output / "reid",
                annotations=annotations
            )

    elif args.input:
        if args.mode in ["reid", "both"]:
            prepare_reid_dataset(
                args.input,
                args.output / "reid"
            )

        if args.mode in ["makemodel", "both"]:
            prepare_makemodel_dataset(
                args.input,
                args.output / "makemodel"
            )

    else:
        print("Please specify --input or --roboflow")
        parser.print_help()
        return

    print(f"\n{'='*60}")
    print("DATASET PREPARATION COMPLETE")
    print(f"{'='*60}")
    print(f"\nOutput: {args.output}")
    print("\nNext steps:")
    print("1. Review prepared dataset")
    print("2. Train ReID: python scripts/03-train-reid.py")
    print("3. Train Make/Model: python scripts/04-train-makemodel.py")


if __name__ == "__main__":
    main()
