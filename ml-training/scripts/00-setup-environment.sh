#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# RaceTagger ML Training - Environment Setup Script
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on error

# Colors for output
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
echo -e "${BLUE}🚀 RaceTagger ML Training - Environment Setup${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# ───────────────────────────────────────────────────────────────
# Step 1: Check Python version
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 1: Checking Python version...${NC}"

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

echo "Python version: $PYTHON_VERSION"

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 9 ]); then
    echo -e "${RED}❌ Python 3.9+ required (found $PYTHON_VERSION)${NC}"
    echo "Please upgrade Python: https://www.python.org/downloads/"
    exit 1
fi

echo -e "${GREEN}✅ Python version OK${NC}"

# ───────────────────────────────────────────────────────────────
# Step 2: Create virtual environment
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 2: Creating virtual environment...${NC}"

VENV_PATH="$ML_DIR/venv-ml"

if [ -d "$VENV_PATH" ]; then
    echo -e "${YELLOW}⚠️  Virtual environment already exists${NC}"
    read -p "Recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$VENV_PATH"
        echo "Deleted old environment"
    else
        echo "Using existing environment"
    fi
fi

if [ ! -d "$VENV_PATH" ]; then
    python3 -m venv "$VENV_PATH"
    echo -e "${GREEN}✅ Virtual environment created: $VENV_PATH${NC}"
fi

# Activate virtual environment
source "$VENV_PATH/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip setuptools wheel > /dev/null 2>&1

# ───────────────────────────────────────────────────────────────
# Step 3: Detect platform and install TensorFlow
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 3: Installing TensorFlow...${NC}"

PLATFORM=$(uname -s)
ARCH=$(uname -m)

echo "Platform: $PLATFORM $ARCH"

if [[ "$PLATFORM" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
    # Mac M1/M2
    echo "Installing TensorFlow for Mac M1/M2 (with Metal acceleration)..."
    pip install tensorflow-macos tensorflow-metal
    echo -e "${GREEN}✅ TensorFlow installed with Metal GPU acceleration${NC}"

elif command -v nvidia-smi &> /dev/null; then
    # Linux/Windows with NVIDIA GPU
    echo "NVIDIA GPU detected. Installing TensorFlow with CUDA..."
    pip install tensorflow[and-cuda]
    echo -e "${GREEN}✅ TensorFlow installed with CUDA GPU acceleration${NC}"

else
    # CPU only
    echo "No GPU detected. Installing CPU-only TensorFlow..."
    echo -e "${YELLOW}⚠️  Training will be slow without GPU${NC}"
    echo -e "${YELLOW}   Consider using Google Colab for free GPU${NC}"
    pip install tensorflow
fi

# ───────────────────────────────────────────────────────────────
# Step 4: Install other dependencies
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 4: Installing dependencies...${NC}"

cd "$ML_DIR"

if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${RED}❌ requirements.txt not found${NC}"
    exit 1
fi

# ───────────────────────────────────────────────────────────────
# Step 5: Verify TensorFlow GPU
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 5: Verifying GPU acceleration...${NC}"

python3 << END
import tensorflow as tf
import sys

gpus = tf.config.list_physical_devices('GPU')

if gpus:
    print(f"\n✅ GPU Available: {len(gpus)} device(s)")
    for i, gpu in enumerate(gpus):
        print(f"   GPU {i}: {gpu.name}")
else:
    print("\n⚠️  No GPU detected. Training will use CPU.")
    print("   Expected training time: ~8 hours")
    print("   Consider using Google Colab (free T4 GPU)")

print(f"\nTensorFlow version: {tf.__version__}")
END

# ───────────────────────────────────────────────────────────────
# Step 6: Create directory structure
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 6: Creating directory structure...${NC}"

mkdir -p "$ML_DIR/f1_scenes_dataset/raw"
mkdir -p "$ML_DIR/f1_scenes_dataset/processed/train"
mkdir -p "$ML_DIR/f1_scenes_dataset/processed/val"
mkdir -p "$ML_DIR/f1_scenes_dataset/processed/test"
mkdir -p "$ML_DIR/models/scene-classifier/checkpoints"
mkdir -p "$ML_DIR/logs/tensorboard"

echo -e "${GREEN}✅ Directory structure created${NC}"

# ───────────────────────────────────────────────────────────────
# Step 7: Download face-api.js models
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 7: Downloading face-api.js models...${NC}"

MODELS_DIR="$PROJECT_ROOT/models/face-api"
mkdir -p "$MODELS_DIR"

BASE_URL="https://github.com/justadudewhohacks/face-api.js/raw/master/weights"

MODELS=(
    "ssd_mobilenetv1_model-weights_manifest.json"
    "ssd_mobilenetv1_model-shard1"
    "ssd_mobilenetv1_model-shard2"
    "face_landmark_68_model-weights_manifest.json"
    "face_landmark_68_model-shard1"
    "face_recognition_model-weights_manifest.json"
    "face_recognition_model-shard1"
    "face_recognition_model-shard2"
)

cd "$MODELS_DIR"

for model in "${MODELS[@]}"; do
    if [ ! -f "$model" ]; then
        echo "Downloading $model..."
        curl -sL "$BASE_URL/$model" -o "$model"
    else
        echo "✓ $model (already exists)"
    fi
done

echo -e "${GREEN}✅ face-api.js models downloaded${NC}"

# ───────────────────────────────────────────────────────────────
# Step 8: Check disk space
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 8: Checking disk space...${NC}"

FREE_SPACE=$(df -h "$ML_DIR" | awk 'NR==2 {print $4}')
echo "Free space: $FREE_SPACE"

FREE_GB=$(df -g "$ML_DIR" | awk 'NR==2 {print $4}')

if [ "$FREE_GB" -lt 10 ]; then
    echo -e "${YELLOW}⚠️  Warning: Low disk space (${FREE_GB}GB free)${NC}"
    echo "   Dataset + models require ~5-10 GB"
else
    echo -e "${GREEN}✅ Disk space OK${NC}"
fi

# ───────────────────────────────────────────────────────────────
# Step 9: Create .env template
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}Step 9: Creating .env template...${NC}"

ENV_FILE="$ML_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'EOL'
# ═══════════════════════════════════════════════════════════════
# RaceTagger ML Training - Environment Variables
# ═══════════════════════════════════════════════════════════════

# Data Collection API Keys
# Get free keys from:
# - Unsplash: https://unsplash.com/developers
# - Pexels: https://www.pexels.com/api/

UNSPLASH_API_KEY=your_unsplash_key_here
PEXELS_API_KEY=your_pexels_key_here

# Optional: Weights & Biases (experiment tracking)
# WANDB_API_KEY=your_wandb_key_here

# Training Configuration
TRAINING_BATCH_SIZE=32
TRAINING_EPOCHS=30
TRAINING_LEARNING_RATE=0.001
EOL

    echo -e "${GREEN}✅ Created .env template: $ENV_FILE${NC}"
    echo -e "${YELLOW}⚠️  Configure your API keys in .env before data collection${NC}"
else
    echo "✓ .env already exists"
fi

# ───────────────────────────────────────────────────────────────
# Step 10: Summary
# ───────────────────────────────────────────────────────────────

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo -e "\n${BLUE}📁 Project Structure:${NC}"
echo "   $ML_DIR"
echo "   ├── scripts/          (Training scripts)"
echo "   ├── configs/          (Configuration files)"
echo "   ├── f1_scenes_dataset/ (Dataset - to be populated)"
echo "   ├── models/           (Trained models)"
echo "   └── venv-ml/          (Virtual environment)"

echo -e "\n${BLUE}🚀 Next Steps:${NC}"
echo "1. Activate environment:"
echo -e "   ${GREEN}source $VENV_PATH/bin/activate${NC}"
echo ""
echo "2. Configure API keys:"
echo -e "   ${GREEN}nano $ENV_FILE${NC}"
echo ""
echo "3. Collect dataset:"
echo -e "   ${GREEN}python scripts/01-collect-training-data.py${NC}"
echo ""
echo "4. Read documentation:"
echo -e "   ${GREEN}cat README.md${NC}"

echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
