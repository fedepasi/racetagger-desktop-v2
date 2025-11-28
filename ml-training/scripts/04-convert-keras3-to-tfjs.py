#!/usr/bin/env python3
"""
Converti modello Keras 3 in formato TensorFlow.js compatibile.

Il problema: Keras 3.x usa un formato di serializzazione diverso che TF.js non supporta.
La soluzione: Caricare il modello con Keras 3, salvarlo in formato SavedModel,
poi convertire usando tensorflowjs_converter.

Esegui con: python ml-training/scripts/04-convert-keras3-to-tfjs.py
"""

import os
import sys
import json
import shutil
import tempfile

def convert_model():
    # Setup paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(script_dir))
    ml_training_dir = os.path.join(project_root, 'ml-training')
    models_dir = os.path.join(ml_training_dir, 'models', 'scene-classifier')

    # Input model path
    keras_model_path = os.path.join(models_dir, 'resnet18_scene_classifier_final.keras')
    if not os.path.exists(keras_model_path):
        keras_model_path = os.path.join(models_dir, 'scene_classifier_latest.keras')

    # Output paths
    output_dir = os.path.join(project_root, 'src', 'assets', 'models', 'scene-classifier')
    temp_dir = tempfile.mkdtemp(prefix='tfjs_convert_')

    print("=" * 60)
    print("Scene Classifier Model Conversion")
    print("Keras 3 -> TensorFlow.js")
    print("=" * 60)
    print(f"\nKeras model: {keras_model_path}")
    print(f"Output dir: {output_dir}")
    print(f"Temp dir: {temp_dir}")

    try:
        # Import TensorFlow
        print("\n[1/5] Importing TensorFlow...")
        import tensorflow as tf
        print(f"TensorFlow version: {tf.__version__}")

        # Load model with Keras
        print(f"\n[2/5] Loading Keras model...")
        model = tf.keras.models.load_model(keras_model_path)
        print(f"Model loaded: {model.name}")
        print(f"Input shape: {model.input_shape}")
        print(f"Output shape: {model.output_shape}")

        # Save as SavedModel format
        saved_model_path = os.path.join(temp_dir, 'saved_model')
        print(f"\n[3/5] Saving as SavedModel format...")
        tf.saved_model.save(model, saved_model_path)
        print(f"SavedModel saved to: {saved_model_path}")

        # Convert to TensorFlow.js using subprocess
        print(f"\n[4/5] Converting to TensorFlow.js...")
        tfjs_output_dir = os.path.join(temp_dir, 'tfjs_model')
        os.makedirs(tfjs_output_dir, exist_ok=True)

        # Try using tensorflowjs_converter
        import subprocess
        cmd = [
            sys.executable, '-m', 'tensorflowjs.converters.converter',
            '--input_format=tf_saved_model',
            '--output_format=tfjs_graph_model',  # Use graph model for better compatibility
            '--signature_name=serving_default',
            '--saved_model_tags=serve',
            saved_model_path,
            tfjs_output_dir
        ]

        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"Error: {result.stderr}")
            # Try alternative conversion
            print("\nTrying alternative conversion (layers model)...")
            cmd = [
                sys.executable, '-m', 'tensorflowjs.converters.converter',
                '--input_format=keras',
                '--output_format=tfjs_layers_model',
                keras_model_path,
                tfjs_output_dir
            ]
            print(f"Running: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                raise Exception(f"Conversion failed: {result.stderr}")

        print("Conversion successful!")

        # Copy to output directory
        print(f"\n[5/5] Copying to output directory...")
        os.makedirs(output_dir, exist_ok=True)

        # Clear existing files
        for f in os.listdir(output_dir):
            if f.endswith('.json') or f.endswith('.bin'):
                os.remove(os.path.join(output_dir, f))

        # Copy new files
        for f in os.listdir(tfjs_output_dir):
            src = os.path.join(tfjs_output_dir, f)
            dst = os.path.join(output_dir, f)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
                print(f"  Copied: {f}")

        # Copy model_info.json if exists
        model_info_src = os.path.join(models_dir, 'resnet18_quantized', 'model_info.json')
        if os.path.exists(model_info_src):
            shutil.copy2(model_info_src, os.path.join(output_dir, 'model_info.json'))
            print(f"  Copied: model_info.json")

        print("\n" + "=" * 60)
        print("CONVERSION COMPLETE!")
        print("=" * 60)
        print(f"\nOutput files in: {output_dir}")
        for f in os.listdir(output_dir):
            size = os.path.getsize(os.path.join(output_dir, f))
            print(f"  - {f} ({size / 1024:.1f} KB)")

    finally:
        # Cleanup temp directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

if __name__ == '__main__':
    convert_model()
