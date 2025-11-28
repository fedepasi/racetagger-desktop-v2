#!/usr/bin/env python3
"""
RaceTagger ML Training - Model Validation Script

Validates trained scene classifier and generates performance reports.

Features:
- Test set evaluation
- Confusion matrix visualization
- Per-class metrics (precision, recall, F1)
- Misclassification analysis
- Inference speed benchmarking

Usage:
    python 04-validate-model.py [--model path/to/model.keras] [--save-report]
"""

import os
import sys
import argparse
import json
import time
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (
    confusion_matrix,
    classification_report,
    accuracy_score,
    top_k_accuracy_score
)

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras.preprocessing.image import ImageDataGenerator

from utils import (
    get_project_root,
    get_dataset_path,
    load_image
)

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

CONFIG_PATH = get_project_root() / 'ml-training' / 'configs' / 'training_config.json'
with open(CONFIG_PATH) as f:
    CONFIG = json.load(f)

INPUT_SIZE = tuple(CONFIG['model']['input_size'][:2])
BATCH_SIZE = CONFIG['training']['batch_size']

# ═══════════════════════════════════════════════════════════════
# Model Evaluation
# ═══════════════════════════════════════════════════════════════

def load_test_data(dataset_path: Path) -> Tuple:
    """
    Load test dataset.

    Returns:
        (test_generator, class_names)
    """

    print("\n📁 Loading test dataset...")

    test_path = dataset_path / 'test'

    # Load augmentation config for rescaling
    aug_config_path = get_project_root() / 'ml-training' / 'configs' / 'augmentation_config.json'
    with open(aug_config_path) as f:
        rescale_factor = json.load(f)['validation_augmentation']['rescale']['factor']

    test_datagen = ImageDataGenerator(rescale=rescale_factor)

    test_generator = test_datagen.flow_from_directory(
        str(test_path),
        target_size=INPUT_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=False  # Important for confusion matrix
    )

    class_names = list(test_generator.class_indices.keys())

    print(f"  Test samples: {test_generator.samples}")
    print(f"  Classes: {class_names}")

    return test_generator, class_names


def evaluate_model(
    model: keras.Model,
    test_generator,
    class_names: List[str]
) -> Dict:
    """
    Evaluate model on test set.

    Returns:
        Dictionary with evaluation metrics
    """

    print("\n🧪 Evaluating model on test set...")

    # Get predictions
    print("  Generating predictions...")

    y_true = test_generator.classes
    y_pred_probs = model.predict(test_generator, verbose=1)
    y_pred = np.argmax(y_pred_probs, axis=1)

    # Calculate metrics
    print("\n  Calculating metrics...")

    accuracy = accuracy_score(y_true, y_pred)
    top2_accuracy = top_k_accuracy_score(y_true, y_pred_probs, k=2)

    # Per-class metrics
    report = classification_report(
        y_true,
        y_pred,
        target_names=class_names,
        output_dict=True
    )

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred)

    # Compile results
    results = {
        'accuracy': float(accuracy),
        'top2_accuracy': float(top2_accuracy),
        'confusion_matrix': cm.tolist(),
        'classification_report': report,
        'predictions': {
            'y_true': y_true.tolist(),
            'y_pred': y_pred.tolist(),
            'y_pred_probs': y_pred_probs.tolist()
        }
    }

    return results


def plot_confusion_matrix(
    cm: np.ndarray,
    class_names: List[str],
    output_path: Path
):
    """
    Plot and save confusion matrix.
    """

    print("\n📊 Generating confusion matrix plot...")

    plt.figure(figsize=(10, 8))

    # Normalize confusion matrix
    cm_normalized = cm.astype('float') / cm.sum(axis=1)[:, np.newaxis]

    # Plot
    sns.heatmap(
        cm_normalized,
        annot=True,
        fmt='.2f',
        cmap='Blues',
        xticklabels=class_names,
        yticklabels=class_names,
        cbar_kws={'label': 'Normalized Count'}
    )

    plt.title('Confusion Matrix - Scene Classifier', fontsize=14, fontweight='bold')
    plt.ylabel('True Label', fontsize=12)
    plt.xlabel('Predicted Label', fontsize=12)
    plt.tight_layout()

    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"  ✅ Saved: {output_path}")

    plt.close()


def plot_per_class_metrics(
    report: Dict,
    class_names: List[str],
    output_path: Path
):
    """
    Plot per-class precision, recall, F1-score.
    """

    print("\n📊 Generating per-class metrics plot...")

    metrics = ['precision', 'recall', 'f1-score']

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))

    for i, metric in enumerate(metrics):
        values = [report[cls][metric] for cls in class_names]

        axes[i].bar(range(len(class_names)), values, color='skyblue', alpha=0.7)
        axes[i].set_xticks(range(len(class_names)))
        axes[i].set_xticklabels(class_names, rotation=45, ha='right')
        axes[i].set_ylim([0, 1.0])
        axes[i].set_ylabel(metric.capitalize())
        axes[i].set_title(f'{metric.capitalize()} by Class', fontweight='bold')
        axes[i].axhline(y=0.8, color='red', linestyle='--', alpha=0.5, label='Target (0.8)')
        axes[i].legend()

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"  ✅ Saved: {output_path}")

    plt.close()


def analyze_misclassifications(
    test_generator,
    y_true: List[int],
    y_pred: List[int],
    y_pred_probs: List[List[float]],
    class_names: List[str],
    top_n: int = 10
) -> List[Dict]:
    """
    Analyze worst misclassifications.

    Returns:
        List of misclassification details
    """

    print(f"\n🔍 Analyzing top {top_n} misclassifications...")

    misclassifications = []

    for i, (true_label, pred_label) in enumerate(zip(y_true, y_pred)):
        if true_label != pred_label:
            confidence = y_pred_probs[i][pred_label]

            # Get file path
            file_idx = i
            file_path = test_generator.filepaths[file_idx]

            misclassifications.append({
                'index': i,
                'file_path': file_path,
                'true_label': class_names[true_label],
                'pred_label': class_names[pred_label],
                'confidence': float(confidence),
                'true_prob': float(y_pred_probs[i][true_label])
            })

    # Sort by confidence (high confidence mistakes are most interesting)
    misclassifications.sort(key=lambda x: x['confidence'], reverse=True)

    # Print top misclassifications
    print(f"\n  Top {min(top_n, len(misclassifications))} misclassifications:")

    for i, mis in enumerate(misclassifications[:top_n]):
        print(f"\n  {i+1}. {Path(mis['file_path']).name}")
        print(f"     True: {mis['true_label']} (prob: {mis['true_prob']:.3f})")
        print(f"     Pred: {mis['pred_label']} (prob: {mis['confidence']:.3f})")

    return misclassifications


# ═══════════════════════════════════════════════════════════════
# Inference Speed Benchmark
# ═══════════════════════════════════════════════════════════════

def benchmark_inference_speed(
    model: keras.Model,
    test_generator,
    n_samples: int = 100
) -> Dict:
    """
    Benchmark model inference speed.

    Returns:
        Dictionary with timing statistics
    """

    print(f"\n⏱️  Benchmarking inference speed ({n_samples} samples)...")

    # Get sample images
    sample_images = []
    for i in range(min(n_samples, test_generator.samples)):
        batch = test_generator[i % len(test_generator)]
        sample_images.append(batch[0][0])  # First image from batch

    sample_images = np.array(sample_images)

    # Warmup
    _ = model.predict(sample_images[:10], verbose=0)

    # Benchmark single image inference
    single_times = []
    for img in sample_images[:n_samples]:
        img_batch = np.expand_dims(img, axis=0)

        start = time.time()
        _ = model.predict(img_batch, verbose=0)
        elapsed = (time.time() - start) * 1000  # Convert to ms

        single_times.append(elapsed)

    # Benchmark batch inference
    batch_sizes = [1, 8, 16, 32]
    batch_times = {}

    for batch_size in batch_sizes:
        if batch_size > len(sample_images):
            continue

        batch = sample_images[:batch_size]

        start = time.time()
        _ = model.predict(batch, verbose=0)
        elapsed = (time.time() - start) * 1000

        batch_times[batch_size] = {
            'total_ms': elapsed,
            'per_image_ms': elapsed / batch_size
        }

    results = {
        'single_image_ms': {
            'mean': float(np.mean(single_times)),
            'std': float(np.std(single_times)),
            'min': float(np.min(single_times)),
            'max': float(np.max(single_times)),
            'median': float(np.median(single_times))
        },
        'batch_inference': batch_times
    }

    print(f"\n  Single Image Inference:")
    print(f"    Mean: {results['single_image_ms']['mean']:.2f} ms")
    print(f"    Std:  {results['single_image_ms']['std']:.2f} ms")
    print(f"    Min:  {results['single_image_ms']['min']:.2f} ms")
    print(f"    Max:  {results['single_image_ms']['max']:.2f} ms")

    target_time = CONFIG['notes']['target_inference_time_ms']
    if results['single_image_ms']['mean'] <= target_time:
        print(f"\n  ✅ Inference speed target achieved! ({results['single_image_ms']['mean']:.2f}ms <= {target_time}ms)")
    else:
        print(f"\n  ⚠️  Inference slower than target ({results['single_image_ms']['mean']:.2f}ms > {target_time}ms)")

    return results


# ═══════════════════════════════════════════════════════════════
# Report Generation
# ═══════════════════════════════════════════════════════════════

def generate_validation_report(
    model_path: Path,
    results: Dict,
    benchmark_results: Dict,
    misclassifications: List[Dict],
    class_names: List[str],
    output_dir: Path
):
    """
    Generate comprehensive validation report.
    """

    print("\n📝 Generating validation report...")

    report = {
        'model_path': str(model_path),
        'validation_date': time.strftime('%Y-%m-%d %H:%M:%S'),
        'test_set_size': len(results['predictions']['y_true']),
        'performance': {
            'accuracy': results['accuracy'],
            'top2_accuracy': results['top2_accuracy'],
            'target_accuracy': CONFIG['notes']['target_accuracy'],
            'target_top2_accuracy': CONFIG['notes']['target_top2_accuracy'],
            'accuracy_achieved': results['accuracy'] >= CONFIG['notes']['target_accuracy'],
            'top2_accuracy_achieved': results['top2_accuracy'] >= CONFIG['notes']['target_top2_accuracy']
        },
        'per_class_metrics': {},
        'inference_speed': benchmark_results,
        'misclassifications_summary': {
            'total_misclassifications': len(misclassifications),
            'top_10_mistakes': misclassifications[:10]
        }
    }

    # Add per-class metrics
    for cls in class_names:
        if cls in results['classification_report']:
            report['per_class_metrics'][cls] = results['classification_report'][cls]

    # Save report
    report_path = output_dir / 'validation_report.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"  ✅ Report saved: {report_path}")

    # Generate text summary
    summary_path = output_dir / 'validation_summary.txt'

    with open(summary_path, 'w') as f:
        f.write("="*60 + "\n")
        f.write("RACETAGGER SCENE CLASSIFIER - VALIDATION REPORT\n")
        f.write("="*60 + "\n\n")

        f.write(f"Model: {model_path.name}\n")
        f.write(f"Validation Date: {report['validation_date']}\n")
        f.write(f"Test Set Size: {report['test_set_size']} images\n\n")

        f.write("-"*60 + "\n")
        f.write("PERFORMANCE METRICS\n")
        f.write("-"*60 + "\n\n")

        f.write(f"Overall Accuracy: {results['accuracy']:.4f} ")
        if report['performance']['accuracy_achieved']:
            f.write("✅ (Target achieved)\n")
        else:
            f.write(f"⚠️  (Target: {CONFIG['notes']['target_accuracy']})\n")

        f.write(f"Top-2 Accuracy:   {results['top2_accuracy']:.4f} ")
        if report['performance']['top2_accuracy_achieved']:
            f.write("✅ (Target achieved)\n\n")
        else:
            f.write(f"⚠️  (Target: {CONFIG['notes']['target_top2_accuracy']})\n\n")

        f.write("-"*60 + "\n")
        f.write("PER-CLASS METRICS\n")
        f.write("-"*60 + "\n\n")

        for cls in class_names:
            if cls in results['classification_report']:
                metrics = results['classification_report'][cls]
                f.write(f"{cls}:\n")
                f.write(f"  Precision: {metrics['precision']:.4f}\n")
                f.write(f"  Recall:    {metrics['recall']:.4f}\n")
                f.write(f"  F1-Score:  {metrics['f1-score']:.4f}\n")
                f.write(f"  Support:   {metrics['support']} images\n\n")

        f.write("-"*60 + "\n")
        f.write("INFERENCE SPEED\n")
        f.write("-"*60 + "\n\n")

        speed = benchmark_results['single_image_ms']
        f.write(f"Mean Inference Time: {speed['mean']:.2f} ms\n")
        f.write(f"Std Deviation:       {speed['std']:.2f} ms\n")
        f.write(f"Min/Max:             {speed['min']:.2f} / {speed['max']:.2f} ms\n\n")

        target_time = CONFIG['notes']['target_inference_time_ms']
        if speed['mean'] <= target_time:
            f.write(f"✅ Speed target achieved ({target_time}ms)\n\n")
        else:
            f.write(f"⚠️  Slower than target ({target_time}ms)\n\n")

        f.write("-"*60 + "\n")
        f.write("MISCLASSIFICATIONS\n")
        f.write("-"*60 + "\n\n")

        f.write(f"Total Misclassifications: {len(misclassifications)}\n")
        f.write(f"Error Rate: {len(misclassifications) / report['test_set_size'] * 100:.2f}%\n\n")

        if misclassifications:
            f.write("Top 10 High-Confidence Mistakes:\n\n")
            for i, mis in enumerate(misclassifications[:10]):
                f.write(f"{i+1}. {Path(mis['file_path']).name}\n")
                f.write(f"   True: {mis['true_label']} ({mis['true_prob']:.3f})\n")
                f.write(f"   Pred: {mis['pred_label']} ({mis['confidence']:.3f})\n\n")

    print(f"  ✅ Summary saved: {summary_path}")


# ═══════════════════════════════════════════════════════════════
# Main Validation Pipeline
# ═══════════════════════════════════════════════════════════════

def validate_model(
    model_path: Optional[str] = None,
    save_report: bool = True
):
    """
    Main validation pipeline.
    """

    print("\n" + "="*60)
    print("🧪 RaceTagger Scene Classifier Validation")
    print("="*60)

    # Load model
    if model_path is None:
        model_path = get_project_root() / 'ml-training' / 'models' / 'scene-classifier' / 'scene_classifier_latest.keras'
    else:
        model_path = Path(model_path)

    if not model_path.exists():
        print(f"\n❌ Model not found: {model_path}")
        print("   Train a model first: python scripts/03-train-scene-classifier.py")
        sys.exit(1)

    print(f"\n📦 Loading model: {model_path}")
    model = keras.models.load_model(str(model_path))

    print(f"  ✅ Model loaded")
    print(f"  Parameters: {model.count_params():,}")

    # Load test data
    dataset_path = get_dataset_path('processed')
    test_generator, class_names = load_test_data(dataset_path)

    # Evaluate model
    results = evaluate_model(model, test_generator, class_names)

    print("\n" + "="*60)
    print("📊 EVALUATION RESULTS")
    print("="*60)

    print(f"\n  Overall Accuracy: {results['accuracy']:.4f}")
    print(f"  Top-2 Accuracy:   {results['top2_accuracy']:.4f}")

    # Benchmark inference speed
    benchmark_results = benchmark_inference_speed(model, test_generator)

    # Analyze misclassifications
    misclassifications = analyze_misclassifications(
        test_generator,
        results['predictions']['y_true'],
        results['predictions']['y_pred'],
        results['predictions']['y_pred_probs'],
        class_names
    )

    # Generate visualizations
    if save_report:
        print("\n" + "="*60)
        print("📊 Generating Visualizations")
        print("="*60)

        output_dir = get_project_root() / 'ml-training' / 'models' / 'scene-classifier' / 'validation'
        output_dir.mkdir(parents=True, exist_ok=True)

        # Confusion matrix
        cm = np.array(results['confusion_matrix'])
        plot_confusion_matrix(cm, class_names, output_dir / 'confusion_matrix.png')

        # Per-class metrics
        plot_per_class_metrics(
            results['classification_report'],
            class_names,
            output_dir / 'per_class_metrics.png'
        )

        # Generate report
        generate_validation_report(
            model_path,
            results,
            benchmark_results,
            misclassifications,
            class_names,
            output_dir
        )

        print(f"\n  📁 All validation artifacts saved to: {output_dir}")

    # Final summary
    print("\n" + "="*60)
    print("✅ Validation Complete!")
    print("="*60)

    target_acc = CONFIG['notes']['target_accuracy']
    target_speed = CONFIG['notes']['target_inference_time_ms']

    if results['accuracy'] >= target_acc and benchmark_results['single_image_ms']['mean'] <= target_speed:
        print("\n🎉 Model meets all targets!")
        print(f"  ✅ Accuracy: {results['accuracy']:.4f} >= {target_acc}")
        print(f"  ✅ Speed: {benchmark_results['single_image_ms']['mean']:.2f}ms <= {target_speed}ms")
        print("\n🚀 Ready for deployment!")
        print("   Next: ./scripts/05-convert-to-tfjs.sh")
    else:
        print("\n⚠️  Model does not meet all targets:")
        if results['accuracy'] < target_acc:
            print(f"  ❌ Accuracy: {results['accuracy']:.4f} < {target_acc}")
        if benchmark_results['single_image_ms']['mean'] > target_speed:
            print(f"  ❌ Speed: {benchmark_results['single_image_ms']['mean']:.2f}ms > {target_speed}ms")


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Validate trained scene classifier'
    )

    parser.add_argument(
        '--model',
        type=str,
        default=None,
        help='Path to model file (default: latest)'
    )

    parser.add_argument(
        '--save-report',
        action='store_true',
        default=True,
        help='Save validation report and visualizations'
    )

    args = parser.parse_args()

    try:
        validate_model(model_path=args.model, save_report=args.save_report)
    except KeyboardInterrupt:
        print("\n\n⚠️  Validation interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
