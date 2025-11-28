#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# RaceTagger ML Training - TensorFlow.js Conversion Script
# ═══════════════════════════════════════════════════════════════
#
# Converts trained Keras model to TensorFlow.js format for Node.js usage
#
# Output formats:
# - model.json: Model architecture
# - group1-shard*.bin: Model weights (sharded for efficiency)
# - class_labels.json: Class labels mapping
#
# Usage:
#   ./05-convert-to-tfjs.sh [model_path]
#
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ML_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ML_DIR")"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🔄 TensorFlow.js Model Conversion${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# ───────────────────────────────────────────────────────────────
# Step 1: Check virtual environment
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 1: Checking environment...${NC}"

VENV_PATH="$ML_DIR/venv-ml"

if [ ! -d "$VENV_PATH" ]; then
    echo -e "${RED}❌ Virtual environment not found: $VENV_PATH${NC}"
    echo "   Run setup first: ./scripts/00-setup-environment.sh"
    exit 1
fi

# Activate virtual environment
source "$VENV_PATH/bin/activate"

echo -e "${GREEN}✅ Virtual environment activated${NC}"

# ───────────────────────────────────────────────────────────────
# Step 2: Check tensorflowjs converter
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 2: Checking tensorflowjs installation...${NC}"

if ! python3 -c "import tensorflowjs" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  tensorflowjs not found, installing...${NC}"
    pip install tensorflowjs
fi

echo -e "${GREEN}✅ tensorflowjs available${NC}"

# ───────────────────────────────────────────────────────────────
# Step 3: Locate model
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 3: Locating model...${NC}"

MODELS_DIR="$ML_DIR/models/scene-classifier"

if [ $# -eq 1 ]; then
    MODEL_PATH="$1"
else
    # Use latest model
    MODEL_PATH="$MODELS_DIR/scene_classifier_latest.keras"
fi

if [ ! -f "$MODEL_PATH" ]; then
    echo -e "${RED}❌ Model not found: $MODEL_PATH${NC}"
    echo "   Train a model first: python scripts/03-train-scene-classifier.py"
    exit 1
fi

echo -e "${GREEN}✅ Model found: $MODEL_PATH${NC}"

# Get model info
MODEL_NAME=$(basename "$MODEL_PATH" .keras)
MODEL_SIZE=$(du -h "$MODEL_PATH" | cut -f1)

echo "   Model: $MODEL_NAME"
echo "   Size:  $MODEL_SIZE"

# ───────────────────────────────────────────────────────────────
# Step 4: Convert to TensorFlow.js
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 4: Converting to TensorFlow.js...${NC}"

OUTPUT_DIR="$PROJECT_ROOT/models/scene-classifier-tfjs"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "   Input:  $MODEL_PATH"
echo "   Output: $OUTPUT_DIR"

# Convert model
echo -e "\n${YELLOW}Running tensorflowjs_converter...${NC}"

tensorflowjs_converter \
    --input_format=keras \
    --output_format=tfjs_graph_model \
    "$MODEL_PATH" \
    "$OUTPUT_DIR"

echo -e "\n${GREEN}✅ Conversion complete!${NC}"

# ───────────────────────────────────────────────────────────────
# Step 5: Copy class labels
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 5: Copying class labels...${NC}"

CLASS_LABELS_SRC="$MODELS_DIR/class_labels.json"
CLASS_LABELS_DST="$OUTPUT_DIR/class_labels.json"

if [ -f "$CLASS_LABELS_SRC" ]; then
    cp "$CLASS_LABELS_SRC" "$CLASS_LABELS_DST"
    echo -e "${GREEN}✅ Class labels copied${NC}"
else
    echo -e "${YELLOW}⚠️  Class labels not found, creating from config...${NC}"

    # Create minimal class labels from config
    python3 << 'END'
import json
from pathlib import Path

ml_dir = Path(__file__).parent.parent
config_path = ml_dir / 'ml-training' / 'configs' / 'training_config.json'

with open(config_path) as f:
    config = json.load(f)

class_labels = {
    'categories': list(config['class_labels'].values()),
    'category_to_index': {v: int(k) for k, v in config['class_labels'].items()},
    'index_to_category': config['class_labels']
}

output_path = ml_dir.parent / 'models' / 'scene-classifier-tfjs' / 'class_labels.json'
with open(output_path, 'w') as f:
    json.dump(class_labels, f, indent=2)

print(f"Created class labels: {output_path}")
END

    echo -e "${GREEN}✅ Class labels created${NC}"
fi

# ───────────────────────────────────────────────────────────────
# Step 6: Verify output
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 6: Verifying output...${NC}"

# Check required files
REQUIRED_FILES=("model.json" "class_labels.json")

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$OUTPUT_DIR/$file" ]; then
        echo -e "   ${GREEN}✅ $file${NC}"
    else
        echo -e "   ${RED}❌ $file (missing!)${NC}"
        exit 1
    fi
done

# Check for weight shards
WEIGHT_SHARDS=$(find "$OUTPUT_DIR" -name "*.bin" | wc -l)

if [ "$WEIGHT_SHARDS" -gt 0 ]; then
    echo -e "   ${GREEN}✅ Weight shards: $WEIGHT_SHARDS files${NC}"
else
    echo -e "   ${RED}❌ No weight shards found!${NC}"
    exit 1
fi

# Calculate total size
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
echo -e "\n   Total size: $TOTAL_SIZE"

# ───────────────────────────────────────────────────────────────
# Step 7: Create model metadata
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 7: Creating model metadata...${NC}"

METADATA_FILE="$OUTPUT_DIR/model_metadata.json"

cat > "$METADATA_FILE" << EOL
{
  "format": "tfjs_graph_model",
  "source": "keras",
  "conversion_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "source_model": "$MODEL_NAME",
  "input_shape": [null, 224, 224, 3],
  "output_classes": 5,
  "preprocessing": {
    "rescale": 0.00392156862745098,
    "target_size": [224, 224],
    "color_mode": "rgb"
  },
  "usage": {
    "load": "tf.loadGraphModel('file://path/to/model.json')",
    "predict": "model.predict(tf.tensor4d(imageData, [1, 224, 224, 3]))"
  }
}
EOL

echo -e "${GREEN}✅ Metadata saved: $METADATA_FILE${NC}"

# ───────────────────────────────────────────────────────────────
# Step 8: Test model loading (optional)
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 8: Testing model load...${NC}"

python3 << END
import sys
sys.path.append('$SCRIPT_DIR')

import tensorflowjs as tfjs
import tensorflow as tf
from pathlib import Path

model_path = Path('$OUTPUT_DIR')

try:
    # This verifies the model can be loaded
    print("   Loading model...")

    # Load using TensorFlow
    model = tf.saved_model.load(str(model_path))

    print("   ✅ Model loads successfully!")

    # Try to get input/output info
    if hasattr(model, 'signatures'):
        signature = model.signatures.get('serving_default')
        if signature:
            print(f"   Input shape: {signature.structured_input_signature}")
            print(f"   Output shape: {signature.structured_outputs}")

except Exception as e:
    print(f"   ⚠️  Could not verify model: {e}")
    print("   This is normal - model verification requires Node.js runtime")

END

# ───────────────────────────────────────────────────────────────
# Summary
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Conversion Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo -e "\n${BLUE}📁 Output Directory:${NC}"
echo "   $OUTPUT_DIR"
echo ""
echo "   ├── model.json          (Model architecture)"
echo "   ├── group*.bin          (Weight shards)"
echo "   ├── class_labels.json   (Class mapping)"
echo "   └── model_metadata.json (Conversion info)"

echo -e "\n${BLUE}📊 Model Info:${NC}"
echo "   Original size: $MODEL_SIZE"
echo "   TF.js size:    $TOTAL_SIZE"
echo "   Weight shards: $WEIGHT_SHARDS"

echo -e "\n${BLUE}🚀 Next Steps:${NC}"
echo ""
echo "1. Test in Node.js:"
echo -e "   ${GREEN}node -e \"const tf = require('@tensorflow/tfjs-node'); tf.loadGraphModel('file://$OUTPUT_DIR/model.json').then(m => console.log('✅ Model loaded'))\"${NC}"
echo ""
echo "2. Integrate into RaceTagger Desktop:"
echo -e "   ${GREEN}# Copy to RaceTagger models directory${NC}"
echo -e "   ${GREEN}cp -r $OUTPUT_DIR $PROJECT_ROOT/models/${NC}"
echo ""
echo "3. Implement SmartRoutingProcessor:"
echo -e "   ${GREEN}# See ROADMAP.md - FASE 2${NC}"

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
