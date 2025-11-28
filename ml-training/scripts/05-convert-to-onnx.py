#!/usr/bin/env python3
"""
Convert Keras Scene Classifier to ONNX format.

This script converts the trained Keras model to ONNX format for faster
inference using ONNX Runtime in the Electron app.
"""

import os
import sys
import json
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def convert_keras_to_onnx():
    """Convert the Keras scene classifier model to ONNX format."""

    print("=" * 60)
    print("KERAS TO ONNX CONVERSION")
    print("=" * 60)

    # Paths
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    model_dir = os.path.join(base_dir, "models", "scene-classifier")
    keras_model_path = os.path.join(model_dir, "resnet18_scene_classifier_final.keras")
    onnx_output_path = os.path.join(model_dir, "scene_classifier.onnx")

    # Also save to app assets directory
    app_assets_dir = os.path.join(base_dir, "..", "src", "assets", "models", "scene-classifier")
    onnx_app_path = os.path.join(app_assets_dir, "scene_classifier.onnx")

    print(f"\nKeras model: {keras_model_path}")
    print(f"ONNX output: {onnx_output_path}")
    print(f"App assets output: {onnx_app_path}")

    # Check if model exists
    if not os.path.exists(keras_model_path):
        print(f"\nERROR: Keras model not found at {keras_model_path}")
        print("Available models:")
        for f in os.listdir(model_dir):
            if f.endswith('.keras'):
                print(f"  - {f}")
        return False

    # Import TensorFlow and tf2onnx
    print("\nLoading libraries...")
    try:
        import tensorflow as tf
        print(f"  TensorFlow version: {tf.__version__}")
    except ImportError:
        print("ERROR: TensorFlow not installed. Run: pip install tensorflow")
        return False

    try:
        import tf2onnx
        print(f"  tf2onnx version: {tf2onnx.__version__}")
    except ImportError:
        print("ERROR: tf2onnx not installed. Run: pip install tf2onnx")
        return False

    try:
        import onnx
        print(f"  onnx version: {onnx.__version__}")
    except ImportError:
        print("ERROR: onnx not installed. Run: pip install onnx")
        return False

    # Load Keras model
    print(f"\nLoading Keras model...")
    try:
        model = tf.keras.models.load_model(keras_model_path)
        print(f"  Model loaded successfully")
        print(f"  Input shape: {model.input_shape}")
        print(f"  Output shape: {model.output_shape}")
    except Exception as e:
        print(f"ERROR loading model: {e}")
        return False

    # Model summary
    print("\nModel architecture:")
    model.summary()

    # Define input signature for conversion
    # Input: [batch, height, width, channels] = [1, 224, 224, 3]
    input_signature = [tf.TensorSpec([1, 224, 224, 3], tf.float32, name='input')]

    # Convert to ONNX
    print("\nConverting to ONNX format...")
    try:
        # Use tf2onnx to convert
        model_proto, _ = tf2onnx.convert.from_keras(
            model,
            input_signature=input_signature,
            opset=13,  # ONNX opset version
            output_path=onnx_output_path
        )
        print(f"  Conversion successful!")
        print(f"  Saved to: {onnx_output_path}")
    except Exception as e:
        print(f"ERROR during conversion: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Verify ONNX model
    print("\nVerifying ONNX model...")
    try:
        onnx_model = onnx.load(onnx_output_path)
        onnx.checker.check_model(onnx_model)
        print("  ONNX model is valid!")

        # Print model info
        print(f"\n  Graph inputs:")
        for inp in onnx_model.graph.input:
            print(f"    - {inp.name}: {[d.dim_value for d in inp.type.tensor_type.shape.dim]}")

        print(f"\n  Graph outputs:")
        for out in onnx_model.graph.output:
            print(f"    - {out.name}: {[d.dim_value for d in out.type.tensor_type.shape.dim]}")

    except Exception as e:
        print(f"WARNING: ONNX verification failed: {e}")

    # Copy to app assets directory
    print(f"\nCopying to app assets directory...")
    try:
        os.makedirs(app_assets_dir, exist_ok=True)
        import shutil
        shutil.copy2(onnx_output_path, onnx_app_path)
        print(f"  Copied to: {onnx_app_path}")
    except Exception as e:
        print(f"WARNING: Could not copy to app assets: {e}")

    # Test inference with ONNX Runtime
    print("\nTesting ONNX Runtime inference...")
    try:
        import onnxruntime as ort
        print(f"  ONNX Runtime version: {ort.__version__}")

        # Create session
        session = ort.InferenceSession(onnx_output_path)

        # Get input/output names
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name

        print(f"  Input name: {input_name}")
        print(f"  Output name: {output_name}")

        # Create dummy input
        dummy_input = np.random.rand(1, 224, 224, 3).astype(np.float32)

        # Run inference
        import time
        start_time = time.time()
        result = session.run([output_name], {input_name: dummy_input})
        inference_time = (time.time() - start_time) * 1000

        print(f"\n  Inference successful!")
        print(f"  Output shape: {result[0].shape}")
        print(f"  Inference time: {inference_time:.2f}ms")

        # Show sample output
        print(f"  Sample output (softmax probabilities): {result[0][0][:5]}...")

    except ImportError:
        print("  ONNX Runtime not installed. Run: pip install onnxruntime")
    except Exception as e:
        print(f"  ERROR testing inference: {e}")

    # Get file sizes
    keras_size = os.path.getsize(keras_model_path) / (1024 * 1024)
    onnx_size = os.path.getsize(onnx_output_path) / (1024 * 1024)

    print("\n" + "=" * 60)
    print("CONVERSION COMPLETE")
    print("=" * 60)
    print(f"  Keras model size: {keras_size:.2f} MB")
    print(f"  ONNX model size:  {onnx_size:.2f} MB")
    print(f"  Size ratio: {onnx_size/keras_size:.2%}")
    print(f"\n  Output files:")
    print(f"    - {onnx_output_path}")
    print(f"    - {onnx_app_path}")

    return True


if __name__ == "__main__":
    success = convert_keras_to_onnx()
    sys.exit(0 if success else 1)
