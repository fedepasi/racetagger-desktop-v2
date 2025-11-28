#!/usr/bin/env python3
"""
Patch model.json per compatibilità TensorFlow.js
Keras 3 usa formati diversi che TF.js non supporta.
"""

import json
import re
import sys
import os

def patch_layer_config(config):
    """Patch a single layer config."""
    if not isinstance(config, dict):
        return config

    result = {}
    for key, value in config.items():
        # Convert batch_shape to batchInputShape
        if key == 'batch_shape':
            result['batchInputShape'] = value
        # Convert dtype objects to simple strings
        elif key == 'dtype' and isinstance(value, dict):
            if 'config' in value and 'name' in value['config']:
                result['dtype'] = value['config']['name']
            else:
                result['dtype'] = 'float32'
        # Recursively patch nested structures
        elif isinstance(value, dict):
            result[key] = patch_layer_config(value)
        elif isinstance(value, list):
            result[key] = [patch_layer_config(item) if isinstance(item, dict) else item for item in value]
        else:
            result[key] = value

    return result

def patch_model_json(input_path, output_path=None):
    """Patch model.json for TensorFlow.js compatibility."""
    if output_path is None:
        output_path = input_path

    print(f"Reading model from: {input_path}")
    with open(input_path, 'r') as f:
        model_json = json.load(f)

    # Check if it's a Keras 3 model
    generated_by = model_json.get('generatedBy', '')
    if 'keras v3' in generated_by.lower():
        print(f"Detected Keras 3 model: {generated_by}")

    # Patch modelTopology
    if 'modelTopology' in model_json:
        print("Patching modelTopology...")
        model_json['modelTopology'] = patch_layer_config(model_json['modelTopology'])

    # Remove incompatible fields
    if 'modelTopology' in model_json:
        topology = model_json['modelTopology']
        if 'model_config' in topology:
            config = topology['model_config']
            if 'config' in config:
                # Patch layers
                if 'layers' in config['config']:
                    for layer in config['config']['layers']:
                        if 'config' in layer:
                            layer['config'] = patch_layer_config(layer['config'])

    # Write patched model
    print(f"Writing patched model to: {output_path}")
    with open(output_path, 'w') as f:
        json.dump(model_json, f)

    print("Done!")

def main():
    if len(sys.argv) < 2:
        # Default paths
        input_path = 'src/assets/models/scene-classifier/model.json'
        output_path = 'src/assets/models/scene-classifier/model.json'
    else:
        input_path = sys.argv[1]
        output_path = sys.argv[2] if len(sys.argv) > 2 else input_path

    # Make paths absolute
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(script_dir))

    if not os.path.isabs(input_path):
        input_path = os.path.join(project_root, input_path)
    if not os.path.isabs(output_path):
        output_path = os.path.join(project_root, output_path)

    patch_model_json(input_path, output_path)

if __name__ == '__main__':
    main()
