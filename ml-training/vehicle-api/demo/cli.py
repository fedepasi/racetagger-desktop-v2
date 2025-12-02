#!/usr/bin/env python3
"""
Vehicle-API CLI Demo

Command-line interface for testing Vehicle ReID and Make/Model classification.

Usage:
    # ReID - Compare two vehicles
    python demo/cli.py reid --img1 car1.jpg --img2 car2.jpg

    # ReID - Find matches in a folder
    python demo/cli.py reid --query car.jpg --gallery ./gallery/

    # Make/Model classification
    python demo/cli.py classify --image car.jpg

    # Batch processing
    python demo/cli.py batch --input ./images/ --output ./results/
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import numpy as np
from PIL import Image

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Model Loading
# ============================================

class VehicleReIDModel:
    """Vehicle ReID model wrapper for ONNX Runtime."""

    def __init__(self, model_path: Path, model_info: dict = None):
        import onnxruntime as ort

        self.model_path = model_path
        self.session = ort.InferenceSession(str(model_path))

        # Default config
        self.input_size = (256, 128)  # height, width
        self.mean = np.array([0.485, 0.456, 0.406])
        self.std = np.array([0.229, 0.224, 0.225])

        if model_info:
            self.input_size = tuple(model_info.get("input_shape", [256, 128])[-2:])

        print(f"Loaded ReID model: {model_path.name}")
        print(f"  Input size: {self.input_size}")

    def preprocess(self, image: Image.Image) -> np.ndarray:
        """Preprocess image for inference."""
        # Resize
        h, w = self.input_size
        img = image.resize((w, h), Image.BILINEAR)

        # Convert to numpy
        img = np.array(img).astype(np.float32) / 255.0

        # Normalize
        img = (img - self.mean) / self.std

        # HWC -> NCHW
        img = img.transpose(2, 0, 1)
        img = np.expand_dims(img, 0)

        return img.astype(np.float32)

    def extract_embedding(self, image: Image.Image) -> np.ndarray:
        """Extract embedding from image."""
        input_tensor = self.preprocess(image)
        outputs = self.session.run(None, {"input": input_tensor})
        return outputs[0][0]  # [embedding_dim]

    def compute_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """Compute cosine similarity between embeddings."""
        return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))


class VehicleMakeModelModel:
    """Vehicle Make/Model classifier wrapper for ONNX Runtime."""

    def __init__(self, model_path: Path, labels_path: Path = None):
        import onnxruntime as ort

        self.model_path = model_path
        self.session = ort.InferenceSession(str(model_path))

        # Default config
        self.input_size = (224, 224)
        self.mean = np.array([0.485, 0.456, 0.406])
        self.std = np.array([0.229, 0.224, 0.225])

        # Load labels
        self.idx_to_make = {}
        self.idx_to_model = {}
        self.idx_to_year = {}

        if labels_path and labels_path.exists():
            with open(labels_path) as f:
                labels = json.load(f)
                self.idx_to_make = {int(k): v for k, v in labels.get("makes", {}).items()}
                self.idx_to_model = {int(k): v for k, v in labels.get("models", {}).items()}
                self.idx_to_year = {int(k): v for k, v in labels.get("years", {}).items()}

        print(f"Loaded Make/Model classifier: {model_path.name}")
        print(f"  Makes: {len(self.idx_to_make)}, Models: {len(self.idx_to_model)}, Years: {len(self.idx_to_year)}")

    def preprocess(self, image: Image.Image) -> np.ndarray:
        """Preprocess image for inference."""
        h, w = self.input_size
        img = image.resize((w, h), Image.BILINEAR)
        img = np.array(img).astype(np.float32) / 255.0
        img = (img - self.mean) / self.std
        img = img.transpose(2, 0, 1)
        img = np.expand_dims(img, 0)
        return img.astype(np.float32)

    def predict(self, image: Image.Image, top_k: int = 5) -> Dict:
        """Predict make, model, and year."""
        input_tensor = self.preprocess(image)
        outputs = self.session.run(None, {"input": input_tensor})

        # outputs: [make_probs, model_probs, year_probs]
        make_probs = outputs[0][0]
        model_probs = outputs[1][0]
        year_probs = outputs[2][0] if len(outputs) > 2 else None

        # Get top predictions
        make_top = self._get_top_k(make_probs, self.idx_to_make, top_k)
        model_top = self._get_top_k(model_probs, self.idx_to_model, top_k)
        year_top = self._get_top_k(year_probs, self.idx_to_year, top_k) if year_probs is not None else []

        return {
            "make": make_top,
            "model": model_top,
            "year": year_top
        }

    def _get_top_k(self, probs: np.ndarray, idx_to_label: dict, k: int) -> List[Dict]:
        """Get top-k predictions."""
        top_indices = np.argsort(probs)[-k:][::-1]
        results = []
        for idx in top_indices:
            label = idx_to_label.get(int(idx), f"class_{idx}")
            results.append({
                "label": label,
                "confidence": float(probs[idx])
            })
        return results


# ============================================
# CLI Commands
# ============================================

def load_image(path: Path) -> Image.Image:
    """Load and validate image."""
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    return Image.open(path).convert("RGB")


def cmd_reid(args):
    """Compare vehicles or find matches in gallery."""
    models_dir = Path(__file__).parent.parent / "models"
    model_path = models_dir / "vehicle_reid.onnx"

    if not model_path.exists():
        print(f"ERROR: Model not found: {model_path}")
        print("Run: python scripts/05-export-onnx.py --all")
        return 1

    model = VehicleReIDModel(model_path)

    if args.img1 and args.img2:
        # Compare two images
        print(f"\nComparing images...")
        print(f"  Image 1: {args.img1}")
        print(f"  Image 2: {args.img2}")

        img1 = load_image(Path(args.img1))
        img2 = load_image(Path(args.img2))

        emb1 = model.extract_embedding(img1)
        emb2 = model.extract_embedding(img2)

        similarity = model.compute_similarity(emb1, emb2)

        print(f"\nResults:")
        print(f"  Cosine similarity: {similarity:.4f}")

        if similarity > 0.75:
            print(f"  Verdict: SAME VEHICLE (high confidence)")
        elif similarity > 0.65:
            print(f"  Verdict: SAME VEHICLE (moderate confidence)")
        elif similarity > 0.55:
            print(f"  Verdict: POSSIBLY SAME (low confidence)")
        else:
            print(f"  Verdict: DIFFERENT VEHICLES")

    elif args.query and args.gallery:
        # Find matches in gallery
        gallery_dir = Path(args.gallery)
        query_path = Path(args.query)

        print(f"\nSearching gallery for matches...")
        print(f"  Query: {query_path}")
        print(f"  Gallery: {gallery_dir}")

        query_img = load_image(query_path)
        query_emb = model.extract_embedding(query_img)

        # Process gallery
        results = []
        image_extensions = {".jpg", ".jpeg", ".png", ".webp"}

        for img_path in gallery_dir.iterdir():
            if img_path.suffix.lower() not in image_extensions:
                continue

            try:
                gallery_img = load_image(img_path)
                gallery_emb = model.extract_embedding(gallery_img)
                similarity = model.compute_similarity(query_emb, gallery_emb)
                results.append((img_path.name, similarity))
            except Exception as e:
                print(f"  Warning: Failed to process {img_path.name}: {e}")

        # Sort by similarity
        results.sort(key=lambda x: x[1], reverse=True)

        print(f"\nTop matches:")
        for i, (name, sim) in enumerate(results[:10], 1):
            status = "MATCH" if sim > 0.65 else "possible" if sim > 0.55 else ""
            print(f"  {i:2}. {name:40} {sim:.4f} {status}")

    else:
        print("ERROR: Specify --img1 and --img2 for comparison, or --query and --gallery for search")
        return 1

    return 0


def cmd_classify(args):
    """Classify vehicle make/model/year."""
    models_dir = Path(__file__).parent.parent / "models"
    model_path = models_dir / "vehicle_makemodel.onnx"
    labels_path = models_dir / "class_labels.json"

    if not model_path.exists():
        print(f"ERROR: Model not found: {model_path}")
        print("Run: python scripts/05-export-onnx.py --all")
        return 1

    model = VehicleMakeModelModel(model_path, labels_path)

    img_path = Path(args.image)
    img = load_image(img_path)

    print(f"\nClassifying: {img_path}")

    results = model.predict(img, top_k=args.top_k)

    print(f"\n--- Make ---")
    for pred in results["make"]:
        bar = "=" * int(pred["confidence"] * 40)
        print(f"  {pred['label']:20} {pred['confidence']*100:5.1f}% |{bar}")

    print(f"\n--- Model ---")
    for pred in results["model"]:
        bar = "=" * int(pred["confidence"] * 40)
        print(f"  {pred['label']:30} {pred['confidence']*100:5.1f}% |{bar}")

    if results["year"]:
        print(f"\n--- Year ---")
        for pred in results["year"]:
            bar = "=" * int(pred["confidence"] * 40)
            print(f"  {pred['label']:10} {pred['confidence']*100:5.1f}% |{bar}")

    return 0


def cmd_batch(args):
    """Batch process images."""
    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    models_dir = Path(__file__).parent.parent / "models"

    # Load models
    reid_model = None
    classify_model = None

    reid_path = models_dir / "vehicle_reid.onnx"
    classify_path = models_dir / "vehicle_makemodel.onnx"
    labels_path = models_dir / "class_labels.json"

    if reid_path.exists():
        reid_model = VehicleReIDModel(reid_path)

    if classify_path.exists():
        classify_model = VehicleMakeModelModel(classify_path, labels_path)

    if not reid_model and not classify_model:
        print("ERROR: No models found. Run training and export first.")
        return 1

    # Process images
    image_extensions = {".jpg", ".jpeg", ".png", ".webp"}
    all_results = []
    embeddings = {}

    print(f"\nProcessing images from: {input_dir}")

    for img_path in sorted(input_dir.iterdir()):
        if img_path.suffix.lower() not in image_extensions:
            continue

        try:
            img = load_image(img_path)
            result = {"image": img_path.name}

            if reid_model:
                embedding = reid_model.extract_embedding(img)
                embeddings[img_path.name] = embedding
                result["embedding_norm"] = float(np.linalg.norm(embedding))

            if classify_model:
                predictions = classify_model.predict(img, top_k=1)
                result["make"] = predictions["make"][0]["label"]
                result["make_conf"] = predictions["make"][0]["confidence"]
                result["model"] = predictions["model"][0]["label"]
                result["model_conf"] = predictions["model"][0]["confidence"]
                if predictions["year"]:
                    result["year"] = predictions["year"][0]["label"]

            all_results.append(result)
            print(f"  Processed: {img_path.name}")

        except Exception as e:
            print(f"  ERROR: {img_path.name}: {e}")

    # Compute pairwise similarities if ReID available
    if reid_model and len(embeddings) > 1:
        print("\nComputing pairwise similarities...")

        similarity_matrix = {}
        names = list(embeddings.keys())

        for i, name1 in enumerate(names):
            for name2 in names[i+1:]:
                sim = reid_model.compute_similarity(embeddings[name1], embeddings[name2])
                similarity_matrix[f"{name1}|{name2}"] = sim

        # Find potential matches
        matches = [(k, v) for k, v in similarity_matrix.items() if v > 0.6]
        matches.sort(key=lambda x: x[1], reverse=True)

        if matches:
            print("\nPotential matches found:")
            for pair, sim in matches[:20]:
                img1, img2 = pair.split("|")
                print(f"  {img1} <-> {img2}: {sim:.4f}")

        # Save similarity matrix
        with open(output_dir / "similarities.json", "w") as f:
            json.dump(similarity_matrix, f, indent=2)

    # Save results
    with open(output_dir / "results.json", "w") as f:
        json.dump(all_results, f, indent=2)

    print(f"\nResults saved to: {output_dir}")
    print(f"  - results.json: {len(all_results)} images")
    if reid_model:
        print(f"  - similarities.json: {len(similarity_matrix)} pairs")

    return 0


def cmd_info(args):
    """Show model information."""
    models_dir = Path(__file__).parent.parent / "models"

    print(f"\n{'='*60}")
    print("VEHICLE-API MODEL INFO")
    print(f"{'='*60}")
    print(f"Models directory: {models_dir}")

    # Check available models
    reid_path = models_dir / "vehicle_reid.onnx"
    classify_path = models_dir / "vehicle_makemodel.onnx"
    info_path = models_dir / "model_info.json"

    print(f"\nAvailable models:")
    print(f"  ReID:      {'OK' if reid_path.exists() else 'NOT FOUND'}")
    print(f"  Make/Model: {'OK' if classify_path.exists() else 'NOT FOUND'}")

    if info_path.exists():
        with open(info_path) as f:
            info = json.load(f)
        print(f"\nModel details:")
        print(json.dumps(info, indent=2))

    if reid_path.exists():
        size_mb = reid_path.stat().st_size / (1024 * 1024)
        print(f"\nReID model size: {size_mb:.2f} MB")

    if classify_path.exists():
        size_mb = classify_path.stat().st_size / (1024 * 1024)
        print(f"Make/Model model size: {size_mb:.2f} MB")

    return 0


# ============================================
# Main
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description="Vehicle-API CLI Demo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Compare two vehicle images
    python demo/cli.py reid --img1 car1.jpg --img2 car2.jpg

    # Find similar vehicles in a gallery
    python demo/cli.py reid --query car.jpg --gallery ./gallery/

    # Classify vehicle make/model/year
    python demo/cli.py classify --image car.jpg

    # Batch process a folder
    python demo/cli.py batch --input ./images/ --output ./results/

    # Show model info
    python demo/cli.py info
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # ReID command
    reid_parser = subparsers.add_parser("reid", help="Vehicle re-identification")
    reid_parser.add_argument("--img1", type=str, help="First image for comparison")
    reid_parser.add_argument("--img2", type=str, help="Second image for comparison")
    reid_parser.add_argument("--query", type=str, help="Query image for gallery search")
    reid_parser.add_argument("--gallery", type=str, help="Gallery directory")
    reid_parser.add_argument("--threshold", type=float, default=0.65, help="Similarity threshold")

    # Classify command
    classify_parser = subparsers.add_parser("classify", help="Classify make/model/year")
    classify_parser.add_argument("--image", type=str, required=True, help="Image to classify")
    classify_parser.add_argument("--top-k", type=int, default=5, help="Number of top predictions")

    # Batch command
    batch_parser = subparsers.add_parser("batch", help="Batch process images")
    batch_parser.add_argument("--input", type=str, required=True, help="Input directory")
    batch_parser.add_argument("--output", type=str, required=True, help="Output directory")

    # Info command
    info_parser = subparsers.add_parser("info", help="Show model information")

    args = parser.parse_args()

    if args.command == "reid":
        return cmd_reid(args)
    elif args.command == "classify":
        return cmd_classify(args)
    elif args.command == "batch":
        return cmd_batch(args)
    elif args.command == "info":
        return cmd_info(args)
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
