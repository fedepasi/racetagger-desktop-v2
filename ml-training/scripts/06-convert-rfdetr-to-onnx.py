#!/usr/bin/env python3
"""
RF-DETR PyTorch to ONNX Conversion Script

Converts RF-DETR models trained on Roboflow to ONNX format for local inference.
This eliminates API costs (~$0.0045/image) by enabling desktop local inference.

Usage:
    python 06-convert-rfdetr-to-onnx.py --weights models/RT-F1-2025/RT-F1-2025-V4_weights.pt --output models/RT-F1-2025/model.onnx

Requirements:
    pip install rfdetr onnx onnxsim torch torchvision

Reference:
    - RF-DETR GitHub: https://github.com/roboflow/rf-detr
    - ONNX Export: https://deepwiki.com/roboflow/rf-detr/5.1-onnx-export
"""

import argparse
import os
import sys
import hashlib
import json
from pathlib import Path

def calculate_sha256(file_path: str) -> str:
    """Calculate SHA256 checksum of a file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def convert_rfdetr_to_onnx(
    weights_path: str,
    output_path: str,
    model_size: str = "medium",
    batch_size: int = 1,
    opset_version: int = 17,
    simplify: bool = True,
    input_size: int = 640,
) -> dict:
    """
    Convert RF-DETR model to ONNX format.

    Args:
        weights_path: Path to PyTorch weights file (.pt)
        output_path: Path for output ONNX file
        model_size: Model size - "base", "medium", or "large"
        batch_size: Batch size for export (usually 1)
        opset_version: ONNX opset version (17 recommended)
        simplify: Whether to simplify the ONNX model
        input_size: Input image size (640 for RF-DETR)

    Returns:
        dict with model info (size, checksum, etc.)
    """
    try:
        from rfdetr import RFDETRBase, RFDETRMedium, RFDETRLarge
    except ImportError:
        print("Error: rfdetr package not found. Install with: pip install rfdetr")
        sys.exit(1)

    # Select model class based on size
    model_classes = {
        "base": RFDETRBase,
        "medium": RFDETRMedium,
        "large": RFDETRLarge,
    }

    if model_size.lower() not in model_classes:
        print(f"Error: Invalid model size '{model_size}'. Use 'base', 'medium', or 'large'")
        sys.exit(1)

    ModelClass = model_classes[model_size.lower()]

    # Load model with pretrained weights
    print(f"\n{'='*60}")
    print(f"RF-DETR to ONNX Conversion")
    print(f"{'='*60}")
    print(f"Model size: {model_size}")
    print(f"Weights: {weights_path}")
    print(f"Output: {output_path}")
    print(f"Input size: {input_size}x{input_size}")
    print(f"{'='*60}\n")

    print("[1/4] Loading model...")

    try:
        model = ModelClass(pretrain_weights=weights_path)
    except Exception as e:
        print(f"Error loading model with rfdetr: {e}")
        print("\nTrying alternative loading method with torch...")

        # Alternative: Load with torch directly
        import torch
        model = ModelClass()
        # PyTorch 2.6+ requires weights_only=False for Roboflow checkpoints
        state_dict = torch.load(weights_path, map_location='cpu', weights_only=False)
        if 'model' in state_dict:
            state_dict = state_dict['model']
        model.load_state_dict(state_dict, strict=False)

    print("[2/4] Exporting to ONNX...")

    # Create output directory if needed
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Export to ONNX
    try:
        # Try using rfdetr's built-in export
        model.export(
            output_path=output_path,
            simplify=simplify,
            batch_size=batch_size,
            opset_version=opset_version,
        )
    except AttributeError:
        # Fallback: Manual ONNX export
        print("Using fallback export method...")
        import torch
        import torch.onnx

        model.eval()
        dummy_input = torch.randn(batch_size, 3, input_size, input_size)

        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            opset_version=opset_version,
            input_names=['images'],
            output_names=['boxes', 'scores', 'labels'],
            dynamic_axes={
                'images': {0: 'batch_size'},
                'boxes': {0: 'batch_size', 1: 'num_detections'},
                'scores': {0: 'batch_size', 1: 'num_detections'},
                'labels': {0: 'batch_size', 1: 'num_detections'},
            }
        )

    print("[3/4] Verifying ONNX model...")

    import onnx
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)
    print("ONNX model validation: OK")

    # Print model info
    print(f"\n  Graph inputs:")
    for inp in onnx_model.graph.input:
        dims = [d.dim_value if d.dim_value else d.dim_param for d in inp.type.tensor_type.shape.dim]
        print(f"    - {inp.name}: {dims}")

    print(f"\n  Graph outputs:")
    for out in onnx_model.graph.output:
        dims = [d.dim_value if d.dim_value else d.dim_param for d in out.type.tensor_type.shape.dim]
        print(f"    - {out.name}: {dims}")

    # Optionally simplify
    if simplify:
        print("\n[3.5/4] Simplifying ONNX model...")
        try:
            import onnxsim
            simplified_model, check = onnxsim.simplify(onnx_model)
            if check:
                onnx.save(simplified_model, output_path)
                print("Model simplified successfully")
            else:
                print("Warning: Simplification check failed, keeping original")
        except ImportError:
            print("Warning: onnxsim not installed, skipping simplification")
            print("  Install with: pip install onnxsim")
        except Exception as e:
            print(f"Warning: Simplification failed: {e}")

    print("[4/4] Calculating checksum...")

    # Get file info
    file_size = os.path.getsize(output_path)
    checksum = calculate_sha256(output_path)

    # Try to get class info from model
    num_classes = getattr(model, 'num_classes', 'unknown')

    result = {
        'output_path': output_path,
        'size_bytes': file_size,
        'size_mb': round(file_size / (1024 * 1024), 2),
        'checksum_sha256': checksum,
        'input_size': [input_size, input_size],
        'opset_version': opset_version,
        'num_classes': num_classes,
    }

    print(f"\n{'='*60}")
    print(f"Conversion Complete!")
    print(f"{'='*60}")
    print(f"Output file: {output_path}")
    print(f"Size: {result['size_mb']} MB ({file_size:,} bytes)")
    print(f"SHA256: {checksum}")
    print(f"Input size: {input_size}x{input_size}")
    print(f"{'='*60}")
    print(f"\nNext steps - Upload to Management Portal:")
    print(f"  1. Go to /management-portal/model-manager")
    print(f"  2. Select the sport category")
    print(f"  3. Enter the version number")
    print(f"  4. Upload the .onnx file: {output_path}")
    print(f"  5. Paste the classes from your Roboflow training data")
    print(f"  6. The checksum is: {checksum}")
    print(f"{'='*60}\n")

    return result


def test_onnx_inference(onnx_path: str, input_size: int = 640):
    """Test the converted ONNX model with dummy data."""
    print("\nTesting ONNX Runtime inference...")

    try:
        import onnxruntime as ort
        import numpy as np
        import time

        print(f"  ONNX Runtime version: {ort.__version__}")

        # Create session
        session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])

        # Get input/output info
        input_info = session.get_inputs()[0]
        print(f"  Input name: {input_info.name}")
        print(f"  Input shape: {input_info.shape}")
        print(f"  Input type: {input_info.type}")

        print(f"\n  Outputs:")
        for output in session.get_outputs():
            print(f"    - {output.name}: {output.shape} ({output.type})")

        # Create dummy input
        dummy_input = np.random.rand(1, 3, input_size, input_size).astype(np.float32)

        # Warm up
        _ = session.run(None, {input_info.name: dummy_input})

        # Run inference with timing
        start_time = time.time()
        num_runs = 5
        for _ in range(num_runs):
            results = session.run(None, {input_info.name: dummy_input})
        avg_time = (time.time() - start_time) / num_runs * 1000

        print(f"\n  Inference successful!")
        print(f"  Average inference time: {avg_time:.2f}ms ({num_runs} runs)")

        # Show output shapes
        print(f"\n  Output shapes:")
        for i, result in enumerate(results):
            output_name = session.get_outputs()[i].name
            print(f"    - {output_name}: {result.shape}")

        return True

    except ImportError:
        print("  ONNX Runtime not installed. Run: pip install onnxruntime")
        return False
    except Exception as e:
        print(f"  ERROR testing inference: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Convert RF-DETR PyTorch model to ONNX format for local inference'
    )
    parser.add_argument(
        '--weights', '-w',
        type=str,
        required=True,
        help='Path to PyTorch weights file (.pt)'
    )
    parser.add_argument(
        '--output', '-o',
        type=str,
        default=None,
        help='Output path for ONNX file (default: same dir as weights)'
    )
    parser.add_argument(
        '--size', '-s',
        type=str,
        default='medium',
        choices=['base', 'medium', 'large'],
        help='Model size (default: medium)'
    )
    parser.add_argument(
        '--batch-size', '-b',
        type=int,
        default=1,
        help='Batch size for export (default: 1)'
    )
    parser.add_argument(
        '--opset',
        type=int,
        default=17,
        help='ONNX opset version (default: 17)'
    )
    parser.add_argument(
        '--no-simplify',
        action='store_true',
        help='Skip ONNX simplification'
    )
    parser.add_argument(
        '--input-size',
        type=int,
        default=640,
        help='Input image size (default: 640)'
    )
    parser.add_argument(
        '--test',
        action='store_true',
        help='Test inference after conversion'
    )

    args = parser.parse_args()

    # Validate weights file
    if not os.path.exists(args.weights):
        print(f"Error: Weights file not found: {args.weights}")
        sys.exit(1)

    # Set default output path
    if args.output is None:
        weights_dir = os.path.dirname(args.weights)
        weights_name = os.path.splitext(os.path.basename(args.weights))[0]
        args.output = os.path.join(weights_dir, f"{weights_name}.onnx")

    # Run conversion
    result = convert_rfdetr_to_onnx(
        weights_path=args.weights,
        output_path=args.output,
        model_size=args.size,
        batch_size=args.batch_size,
        opset_version=args.opset,
        simplify=not args.no_simplify,
        input_size=args.input_size,
    )

    # Save conversion info
    info_path = args.output.replace('.onnx', '_info.json')
    with open(info_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"Conversion info saved to: {info_path}")

    # Test inference if requested
    if args.test:
        test_onnx_inference(args.output, args.input_size)


if __name__ == '__main__':
    main()
