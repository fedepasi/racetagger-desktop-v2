#!/usr/bin/env python3
"""
Export YOLOv8n-seg model to ONNX format for RaceTagger Generic Segmenter.

This script downloads the YOLOv8n-seg model from Ultralytics and exports it
to ONNX format suitable for inference with ONNX Runtime in Node.js.

Requirements:
    pip install ultralytics onnx onnxruntime

Output:
    - yolov8n-seg.onnx: Model file (~14MB)
    - Input: [1, 3, 640, 640] (NCHW, float32, normalized 0-1)
    - Output 0: Detection boxes [1, 116, 8400] (x,y,w,h,conf,cls,mask_coeffs)
    - Output 1: Proto masks [1, 32, 160, 160]
"""

import os
from pathlib import Path

def export_yolov8_seg():
    """Export YOLOv8n-seg to ONNX format."""

    print("=" * 60)
    print("YOLOv8n-seg ONNX Export for RaceTagger")
    print("=" * 60)

    try:
        from ultralytics import YOLO
    except ImportError:
        print("\nERROR: ultralytics package not found.")
        print("Please install it with: pip install ultralytics")
        return False

    # Output directory
    output_dir = Path(__file__).parent.parent / "models" / "generic"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / "yolov8n-seg.onnx"

    print(f"\nOutput directory: {output_dir}")
    print(f"Output file: {output_path}")

    # Download and load model
    print("\n[1/3] Loading YOLOv8n-seg model from Ultralytics...")
    model = YOLO("yolov8n-seg.pt")

    # Export to ONNX
    print("\n[2/3] Exporting to ONNX format...")
    model.export(
        format="onnx",
        imgsz=640,
        simplify=True,
        opset=12,  # Compatible with ONNX Runtime
        dynamic=False,  # Fixed batch size of 1
        half=False,  # Use FP32 for best compatibility
    )

    # Move the generated ONNX file to our target location
    # Ultralytics puts it next to the .pt file by default
    generated_onnx = Path("yolov8n-seg.onnx")
    if generated_onnx.exists():
        import shutil
        shutil.move(str(generated_onnx), str(output_path))
        print(f"\n[3/3] Model saved to: {output_path}")
    else:
        # Try to find it in the model's directory
        pt_dir = Path(model.ckpt_path).parent if model.ckpt_path else Path(".")
        alt_path = pt_dir / "yolov8n-seg.onnx"
        if alt_path.exists():
            import shutil
            shutil.move(str(alt_path), str(output_path))
            print(f"\n[3/3] Model saved to: {output_path}")
        else:
            print(f"\nWARNING: ONNX file not found. Check for it in current directory or Ultralytics cache.")

    # Verify export
    if output_path.exists():
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"\nExport successful!")
        print(f"  File: {output_path}")
        print(f"  Size: {size_mb:.2f} MB")
        print(f"\nModel specifications:")
        print(f"  Input shape: [1, 3, 640, 640] (NCHW)")
        print(f"  Output 0: [1, 116, 8400] (boxes+scores+mask_coeffs)")
        print(f"  Output 1: [1, 32, 160, 160] (proto masks)")
        print(f"\nCOCO classes relevant for RaceTagger:")
        print(f"  0: person")
        print(f"  2: car")
        print(f"  3: motorcycle")
        print(f"  5: bus")
        print(f"  7: truck")

        # Generate SHA256 for integrity verification
        import hashlib
        with open(output_path, "rb") as f:
            sha256 = hashlib.sha256(f.read()).hexdigest()
        print(f"\nSHA256: {sha256}")

        return True
    else:
        print("\nExport failed - ONNX file not created")
        return False


if __name__ == "__main__":
    success = export_yolov8_seg()
    exit(0 if success else 1)
