#!/usr/bin/env python3
"""
RaceTagger ML Training - TensorFlow.js Model Validation
Validates exported TF.js models for accuracy and performance.
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image

# Categories
CATEGORIES = [
    'crowd_scene',
    'garage_pitlane',
    'podium_celebration',
    'portrait_paddock',
    'racing_action'
]

INPUT_SIZE = (224, 224)

def get_project_root() -> Path:
    """Get the project root directory"""
    return Path(__file__).parent.parent

def install_tfjs_node():
    """Install TensorFlow.js Node.js bindings if not present"""
    try:
        result = subprocess.run(
            ['npm', 'list', '@tensorflow/tfjs-node'],
            cwd=get_project_root(),
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print("\n📦 Installing @tensorflow/tfjs-node...")
            subprocess.run(
                ['npm', 'install', '@tensorflow/tfjs-node'],
                cwd=get_project_root(),
                check=True
            )
            print("✅ Installation complete!")
        else:
            print("✅ @tensorflow/tfjs-node already installed")

    except Exception as e:
        print(f"⚠️  Could not install tfjs-node: {e}")
        print("   Manual install: npm install @tensorflow/tfjs-node")
        sys.exit(1)

def create_inference_script(model_path: Path) -> Path:
    """Create Node.js script for TF.js inference"""
    script_path = get_project_root() / 'scripts' / 'tfjs_inference.js'

    script_content = f"""
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const {{ createCanvas, loadImage }} = require('canvas');

async function loadModel() {{
    const modelPath = 'file://{model_path.absolute()}/model.json';
    console.log('Loading model from:', modelPath);
    const model = await tf.loadGraphModel(modelPath);
    return model;
}}

async function preprocessImage(imagePath) {{
    const image = await loadImage(imagePath);
    const canvas = createCanvas({INPUT_SIZE[0]}, {INPUT_SIZE[1]});
    const ctx = canvas.getContext('2d');

    // Resize and draw
    ctx.drawImage(image, 0, 0, {INPUT_SIZE[0]}, {INPUT_SIZE[1]});

    // Get image data and normalize
    const imageData = ctx.getImageData(0, 0, {INPUT_SIZE[0]}, {INPUT_SIZE[1]});
    const pixels = imageData.data;

    // Convert to tensor [1, 224, 224, 3]
    const data = new Float32Array({INPUT_SIZE[0]} * {INPUT_SIZE[1]} * 3);
    for (let i = 0; i < pixels.length / 4; i++) {{
        data[i * 3] = pixels[i * 4] / 255.0;       // R
        data[i * 3 + 1] = pixels[i * 4 + 1] / 255.0;  // G
        data[i * 3 + 2] = pixels[i * 4 + 2] / 255.0;  // B
    }}

    return tf.tensor4d(data, [1, {INPUT_SIZE[0]}, {INPUT_SIZE[1]}, 3]);
}}

async function predict(model, imagePath) {{
    const inputTensor = await preprocessImage(imagePath);

    const startTime = Date.now();
    const predictions = model.predict(inputTensor);
    const inferenceTime = Date.now() - startTime;

    const probabilities = await predictions.data();
    const predictedClass = predictions.argMax(-1).dataSync()[0];

    // Cleanup
    inputTensor.dispose();
    predictions.dispose();

    return {{
        predictedClass,
        probabilities: Array.from(probabilities),
        inferenceTime
    }};
}}

async function main() {{
    const args = process.argv.slice(2);

    if (args.length < 1) {{
        console.error('Usage: node tfjs_inference.js <image_path>');
        process.exit(1);
    }}

    const imagePath = args[0];

    try {{
        const model = await loadModel();
        const result = await predict(model, imagePath);
        console.log(JSON.stringify(result));
    }} catch (error) {{
        console.error('Error:', error.message);
        process.exit(1);
    }}
}}

main();
"""

    script_path.write_text(script_content)
    return script_path

def predict_image(inference_script: Path, image_path: Path) -> Dict:
    """Run inference on single image using Node.js script"""
    try:
        result = subprocess.run(
            ['node', str(inference_script), str(image_path)],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            raise Exception(f"Inference failed: {result.stderr}")

        return json.loads(result.stdout)

    except subprocess.TimeoutExpired:
        raise Exception("Inference timeout (>30s)")
    except json.JSONDecodeError as e:
        raise Exception(f"Invalid JSON response: {result.stdout}")

def validate_model(model_path: Path, test_dir: Path) -> Dict:
    """Validate model on test set"""
    print(f"\n🧪 Validating model: {model_path.name}")
    print("="*60)

    # Check model exists
    model_json = model_path / 'model.json'
    if not model_json.exists():
        raise FileNotFoundError(f"Model not found: {model_json}")

    # Load class labels
    labels_path = model_path / 'class_labels.json'
    if labels_path.exists():
        with open(labels_path) as f:
            labels = json.load(f)
        categories = labels['categories']
    else:
        categories = CATEGORIES

    # Install dependencies
    install_tfjs_node()

    # Create inference script
    inference_script = create_inference_script(model_path)

    # Collect test images
    test_images = []
    for category in categories:
        category_dir = test_dir / category
        if not category_dir.exists():
            print(f"⚠️  Test directory not found: {category}")
            continue

        images = list(category_dir.glob('*.jpg'))
        test_images.extend([(img, category) for img in images])

    if not test_images:
        raise Exception(f"No test images found in {test_dir}")

    print(f"\n📊 Test set: {len(test_images)} images across {len(categories)} categories")
    print(f"   Categories: {categories}")

    # Run predictions
    results = {
        'correct': 0,
        'total': len(test_images),
        'predictions': [],
        'inference_times': [],
        'per_category': {cat: {'correct': 0, 'total': 0} for cat in categories}
    }

    print(f"\n🔄 Running inference...\n")

    for i, (img_path, true_category) in enumerate(test_images):
        try:
            # Predict
            prediction = predict_image(inference_script, img_path)

            predicted_class = prediction['predictedClass']
            predicted_category = categories[predicted_class]
            confidence = prediction['probabilities'][predicted_class]
            inference_time = prediction['inferenceTime']

            # Check correctness
            is_correct = predicted_category == true_category

            results['predictions'].append({
                'image': img_path.name,
                'true_category': true_category,
                'predicted_category': predicted_category,
                'confidence': confidence,
                'correct': is_correct,
                'inference_time': inference_time
            })

            results['inference_times'].append(inference_time)

            if is_correct:
                results['correct'] += 1
                results['per_category'][true_category]['correct'] += 1

            results['per_category'][true_category]['total'] += 1

            # Progress
            if (i + 1) % 10 == 0:
                accuracy = results['correct'] / (i + 1)
                avg_time = np.mean(results['inference_times'])
                print(f"  Progress: {i+1}/{len(test_images)} | "
                      f"Accuracy: {accuracy:.2%} | "
                      f"Avg time: {avg_time:.0f}ms")

        except Exception as e:
            print(f"  ⚠️  Error on {img_path.name}: {e}")
            continue

    # Calculate metrics
    accuracy = results['correct'] / results['total']
    avg_inference_time = np.mean(results['inference_times'])
    std_inference_time = np.std(results['inference_times'])
    min_inference_time = np.min(results['inference_times'])
    max_inference_time = np.max(results['inference_times'])

    # Per-category accuracy
    category_accuracies = {}
    for cat in categories:
        cat_stats = results['per_category'][cat]
        if cat_stats['total'] > 0:
            cat_acc = cat_stats['correct'] / cat_stats['total']
            category_accuracies[cat] = cat_acc

    # Print results
    print("\n" + "="*60)
    print("📊 VALIDATION RESULTS")
    print("="*60)
    print(f"\n✅ Overall Accuracy: {accuracy:.4f} ({results['correct']}/{results['total']})")
    print(f"\n⏱️  Inference Performance:")
    print(f"   Average: {avg_inference_time:.2f}ms")
    print(f"   Std Dev: {std_inference_time:.2f}ms")
    print(f"   Min: {min_inference_time:.2f}ms")
    print(f"   Max: {max_inference_time:.2f}ms")

    print(f"\n📈 Per-Category Accuracy:")
    for cat, acc in sorted(category_accuracies.items(), key=lambda x: x[1], reverse=True):
        cat_stats = results['per_category'][cat]
        print(f"   {cat:25s}: {acc:.2%} ({cat_stats['correct']}/{cat_stats['total']})")

    # Check targets
    target_accuracy = 0.88
    target_inference_time = 50  # ms

    print(f"\n🎯 Target Comparison:")
    acc_status = "✅" if accuracy >= target_accuracy else "❌"
    time_status = "✅" if avg_inference_time <= target_inference_time else "❌"

    print(f"   {acc_status} Accuracy: {accuracy:.2%} (target: {target_accuracy:.0%})")
    print(f"   {time_status} Inference: {avg_inference_time:.0f}ms (target: <{target_inference_time}ms)")

    # Save results
    results_file = model_path / 'validation_results.json'
    with open(results_file, 'w') as f:
        json.dump({
            'accuracy': accuracy,
            'total_images': results['total'],
            'correct_predictions': results['correct'],
            'inference_time_ms': {
                'mean': avg_inference_time,
                'std': std_inference_time,
                'min': min_inference_time,
                'max': max_inference_time
            },
            'per_category_accuracy': category_accuracies,
            'predictions': results['predictions']
        }, f, indent=2)

    print(f"\n💾 Results saved: {results_file}")

    return results

def compare_models(model_paths: List[Path], test_dir: Path):
    """Compare multiple models"""
    print("\n" + "="*60)
    print("🔍 MODEL COMPARISON")
    print("="*60)

    comparisons = []

    for model_path in model_paths:
        try:
            results = validate_model(model_path, test_dir)

            comparisons.append({
                'model': model_path.name,
                'accuracy': results['correct'] / results['total'],
                'avg_inference_time': np.mean(results['inference_times'])
            })

        except Exception as e:
            print(f"\n❌ Error validating {model_path.name}: {e}")

    if not comparisons:
        print("\n⚠️  No models successfully validated")
        return

    # Sort by accuracy
    comparisons.sort(key=lambda x: x['accuracy'], reverse=True)

    print("\n" + "="*60)
    print("📊 COMPARISON SUMMARY")
    print("="*60)
    print(f"\n{'Model':30s} | {'Accuracy':>10s} | {'Inference':>12s}")
    print("-" * 60)

    for comp in comparisons:
        print(f"{comp['model']:30s} | {comp['accuracy']:>9.2%} | {comp['avg_inference_time']:>9.0f}ms")

    best_model = comparisons[0]
    print(f"\n🏆 BEST MODEL: {best_model['model']}")
    print(f"   Accuracy: {best_model['accuracy']:.2%}")
    print(f"   Speed: {best_model['avg_inference_time']:.0f}ms")

def main():
    parser = argparse.ArgumentParser(
        description='Validate TensorFlow.js scene classifier models'
    )
    parser.add_argument(
        '--model-path',
        type=str,
        help='Path to TF.js model directory (model.json)'
    )
    parser.add_argument(
        '--compare',
        action='store_true',
        help='Compare all models in tfjs_models directory'
    )
    parser.add_argument(
        '--test-dir',
        type=str,
        default='f1_scenes_dataset/processed/test',
        help='Path to test images directory'
    )

    args = parser.parse_args()

    project_root = get_project_root()
    test_dir = project_root / args.test_dir

    if not test_dir.exists():
        print(f"❌ Test directory not found: {test_dir}")
        sys.exit(1)

    try:
        if args.compare:
            # Compare all models
            tfjs_dir = project_root / 'tfjs_models'
            if not tfjs_dir.exists():
                print(f"❌ TF.js models directory not found: {tfjs_dir}")
                sys.exit(1)

            model_dirs = [d for d in tfjs_dir.iterdir() if d.is_dir()]
            if not model_dirs:
                print(f"❌ No model directories found in {tfjs_dir}")
                sys.exit(1)

            compare_models(model_dirs, test_dir)

        elif args.model_path:
            # Validate single model
            model_path = Path(args.model_path)
            if not model_path.exists():
                print(f"❌ Model path not found: {model_path}")
                sys.exit(1)

            validate_model(model_path, test_dir)

        else:
            parser.print_help()
            sys.exit(1)

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
