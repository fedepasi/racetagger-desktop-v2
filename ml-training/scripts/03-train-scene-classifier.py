#!/usr/bin/env python3
"""
RaceTagger ML Training - Scene Classifier Training Script

Trains MobileNetV3-Small for scene classification using transfer learning.

Features:
- Two-phase transfer learning (freeze → fine-tune)
- Data augmentation for training set
- Multiple callbacks (early stopping, checkpointing, reduce LR)
- TensorBoard logging
- Class weights for imbalanced datasets
- Automatic model versioning

Usage:
    python 03-train-scene-classifier.py [--resume checkpoint.keras] [--wandb]
"""

import os
import sys
import argparse
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Tuple

import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from tensorflow.keras.applications import MobileNetV3Small
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import (
    ModelCheckpoint,
    EarlyStopping,
    ReduceLROnPlateau,
    TensorBoard,
    Callback
)

from utils import (
    get_project_root,
    get_dataset_path,
    ensure_dir,
    compute_class_weights,
    get_category_distribution
)

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

# Load configs
CONFIG_PATH = get_project_root() / 'ml-training' / 'configs' / 'training_config.json'
AUG_CONFIG_PATH = get_project_root() / 'ml-training' / 'configs' / 'augmentation_config.json'

with open(CONFIG_PATH) as f:
    CONFIG = json.load(f)

with open(AUG_CONFIG_PATH) as f:
    AUG_CONFIG = json.load(f)

# Training parameters
BATCH_SIZE = CONFIG['training']['batch_size']
EPOCHS = CONFIG['training']['epochs']
LEARNING_RATE = CONFIG['training']['learning_rate']
INPUT_SIZE = tuple(CONFIG['model']['input_size'][:2])

# Transfer learning phases
PHASE1_EPOCHS = CONFIG['transfer_learning']['phase1']['epochs']
PHASE1_LR = CONFIG['transfer_learning']['phase1']['learning_rate']
PHASE2_EPOCHS = CONFIG['transfer_learning']['phase2']['epochs']
PHASE2_LR = CONFIG['transfer_learning']['phase2']['learning_rate']
UNFREEZE_LAYERS = CONFIG['transfer_learning']['phase2']['unfreeze_last_n_layers']

# Model architecture
DENSE_UNITS = CONFIG['custom_head']['dense_units']
DROPOUT_RATE = CONFIG['custom_head']['dropout_rate']

# ═══════════════════════════════════════════════════════════════
# Model Building
# ═══════════════════════════════════════════════════════════════

def build_model(num_classes: int, freeze_base: bool = True) -> keras.Model:
    """
    Build MobileNetV3-Small with custom classification head.

    Args:
        num_classes: Number of output classes
        freeze_base: Whether to freeze base model layers

    Returns:
        Compiled Keras model
    """

    print("\n🏗️  Building model...")

    # Load pre-trained MobileNetV3-Small
    base_model = MobileNetV3Small(
        input_shape=(*INPUT_SIZE, 3),
        include_top=False,
        weights='imagenet',
        minimalistic=CONFIG['model']['minimalistic']
    )

    # Freeze base model if requested
    base_model.trainable = not freeze_base

    print(f"  Base model: MobileNetV3-Small")
    print(f"  Trainable: {not freeze_base}")
    print(f"  Total base layers: {len(base_model.layers)}")

    # Build custom classification head
    inputs = keras.Input(shape=(*INPUT_SIZE, 3))

    # Base model
    x = base_model(inputs, training=False)

    # Global pooling
    x = layers.GlobalAveragePooling2D(name='global_avg_pool')(x)

    # Dense layer
    x = layers.Dense(DENSE_UNITS, activation='relu', name='dense_classifier')(x)

    # Dropout
    x = layers.Dropout(DROPOUT_RATE, name='dropout')(x)

    # Output layer
    outputs = layers.Dense(num_classes, activation='softmax', name='predictions')(x)

    model = keras.Model(inputs, outputs, name='scene_classifier')

    print(f"\n  Model architecture:")
    print(f"    Input: {INPUT_SIZE[0]}x{INPUT_SIZE[1]}x3")
    print(f"    Base: MobileNetV3-Small (ImageNet)")
    print(f"    Pool: GlobalAveragePooling2D")
    print(f"    Dense: {DENSE_UNITS} units (ReLU)")
    print(f"    Dropout: {DROPOUT_RATE}")
    print(f"    Output: {num_classes} classes (Softmax)")

    return model


def unfreeze_top_layers(model: keras.Model, n_layers: int):
    """
    Unfreeze the top N layers of the base model for fine-tuning.
    """

    base_model = model.layers[1]  # Base model is second layer

    # Freeze all layers first
    base_model.trainable = True

    for layer in base_model.layers[:-n_layers]:
        layer.trainable = False

    trainable_count = sum([1 for layer in base_model.layers if layer.trainable])

    print(f"\n🔓 Unfreezing top {n_layers} layers")
    print(f"  Trainable layers: {trainable_count}/{len(base_model.layers)}")


# ═══════════════════════════════════════════════════════════════
# Data Generators
# ═══════════════════════════════════════════════════════════════

def create_data_generators(
    dataset_path: Path
) -> Tuple[ImageDataGenerator, ImageDataGenerator]:
    """
    Create training and validation data generators.

    Returns:
        (train_generator, val_generator)
    """

    print("\n📊 Creating data generators...")

    # Training augmentation
    train_aug = AUG_CONFIG['training_augmentation']

    train_datagen = ImageDataGenerator(
        rescale=train_aug['rescale']['factor'],
        rotation_range=train_aug['rotation_range']['degrees'],
        width_shift_range=train_aug['width_shift_range']['factor'],
        height_shift_range=train_aug['height_shift_range']['factor'],
        shear_range=train_aug['shear_range']['factor'],
        zoom_range=train_aug['zoom_range']['factor'],
        horizontal_flip=train_aug['horizontal_flip']['enabled'],
        brightness_range=[
            train_aug['brightness_range']['min'],
            train_aug['brightness_range']['max']
        ],
        fill_mode=train_aug['fill_mode']['mode']
    )

    # Validation (only rescaling)
    val_aug = AUG_CONFIG['validation_augmentation']

    val_datagen = ImageDataGenerator(
        rescale=val_aug['rescale']['factor']
    )

    print("  ✅ Training: augmentation enabled")
    print("  ✅ Validation: rescaling only")

    return train_datagen, val_datagen


def load_datasets(
    train_datagen: ImageDataGenerator,
    val_datagen: ImageDataGenerator,
    dataset_path: Path
) -> Tuple:
    """
    Load train and validation datasets.

    Returns:
        (train_generator, val_generator, class_names)
    """

    print("\n📁 Loading datasets...")

    train_path = dataset_path / 'train'
    val_path = dataset_path / 'val'

    # Training set
    train_generator = train_datagen.flow_from_directory(
        str(train_path),
        target_size=INPUT_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=True,
        seed=CONFIG['dataset']['seed']
    )

    # Validation set
    val_generator = val_datagen.flow_from_directory(
        str(val_path),
        target_size=INPUT_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=False
    )

    class_names = list(train_generator.class_indices.keys())

    print(f"\n  Training samples: {train_generator.samples}")
    print(f"  Validation samples: {val_generator.samples}")
    print(f"  Classes: {class_names}")
    print(f"  Batch size: {BATCH_SIZE}")

    return train_generator, val_generator, class_names


# ═══════════════════════════════════════════════════════════════
# Callbacks
# ═══════════════════════════════════════════════════════════════

def create_callbacks(phase: str) -> list:
    """
    Create training callbacks for the given phase.

    Args:
        phase: 'phase1' or 'phase2'

    Returns:
        List of Keras callbacks
    """

    print(f"\n⚙️  Setting up callbacks for {phase}...")

    callbacks = []

    # Model checkpoint
    checkpoint_config = CONFIG['callbacks']['model_checkpoint']
    if checkpoint_config['enabled']:
        checkpoint_dir = get_project_root() / 'ml-training' / 'models' / 'scene-classifier' / 'checkpoints'
        ensure_dir(checkpoint_dir)

        checkpoint_path = checkpoint_dir / f'{phase}_best.keras'

        checkpoint_cb = ModelCheckpoint(
            str(checkpoint_path),
            monitor=checkpoint_config['monitor'],
            save_best_only=checkpoint_config['save_best_only'],
            save_weights_only=checkpoint_config['save_weights_only'],
            verbose=checkpoint_config['verbose']
        )

        callbacks.append(checkpoint_cb)
        print(f"  ✅ ModelCheckpoint: {checkpoint_path}")

    # Early stopping
    early_stop_config = CONFIG['callbacks']['early_stopping']
    if early_stop_config['enabled']:
        early_stop_cb = EarlyStopping(
            monitor=early_stop_config['monitor'],
            patience=early_stop_config['patience'],
            restore_best_weights=early_stop_config['restore_best_weights'],
            verbose=early_stop_config['verbose']
        )

        callbacks.append(early_stop_cb)
        print(f"  ✅ EarlyStopping: patience={early_stop_config['patience']}")

    # Reduce learning rate
    reduce_lr_config = CONFIG['callbacks']['reduce_lr']
    if reduce_lr_config['enabled']:
        reduce_lr_cb = ReduceLROnPlateau(
            monitor=reduce_lr_config['monitor'],
            factor=reduce_lr_config['factor'],
            patience=reduce_lr_config['patience'],
            min_lr=reduce_lr_config['min_lr'],
            verbose=reduce_lr_config['verbose']
        )

        callbacks.append(reduce_lr_cb)
        print(f"  ✅ ReduceLROnPlateau: factor={reduce_lr_config['factor']}")

    # TensorBoard
    tensorboard_config = CONFIG['callbacks']['tensorboard']
    if tensorboard_config['enabled']:
        log_dir = get_project_root() / 'ml-training' / 'logs' / 'tensorboard' / phase / datetime.now().strftime('%Y%m%d-%H%M%S')
        ensure_dir(log_dir)

        tensorboard_cb = TensorBoard(
            log_dir=str(log_dir),
            histogram_freq=tensorboard_config['histogram_freq'],
            write_graph=tensorboard_config['write_graph'],
            write_images=tensorboard_config['write_images']
        )

        callbacks.append(tensorboard_cb)
        print(f"  ✅ TensorBoard: {log_dir}")

    return callbacks


class TrainingProgressCallback(Callback):
    """Custom callback to display training progress."""

    def __init__(self, phase: str):
        super().__init__()
        self.phase = phase

    def on_epoch_begin(self, epoch, logs=None):
        print(f"\n{'='*60}")
        print(f"{self.phase} - Epoch {epoch + 1}")
        print('='*60)

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}
        print(f"\n  Results:")
        print(f"    Loss: {logs.get('loss', 0):.4f} | Val Loss: {logs.get('val_loss', 0):.4f}")
        print(f"    Acc:  {logs.get('accuracy', 0):.4f} | Val Acc:  {logs.get('val_accuracy', 0):.4f}")

        if 'lr' in logs:
            print(f"    Learning Rate: {logs['lr']:.6f}")


# ═══════════════════════════════════════════════════════════════
# Training
# ═══════════════════════════════════════════════════════════════

def train_model(
    resume_from: Optional[str] = None,
    use_wandb: bool = False
):
    """
    Main training pipeline with two-phase transfer learning.

    Args:
        resume_from: Path to checkpoint to resume from
        use_wandb: Enable Weights & Biases logging
    """

    print("\n" + "="*60)
    print("🚀 RaceTagger Scene Classifier Training")
    print("="*60)

    # Optional: W&B integration
    if use_wandb:
        try:
            import wandb
            wandb.init(
                project="racetagger-scene-classifier",
                config=CONFIG
            )
            print("  ✅ Weights & Biases enabled")
        except ImportError:
            print("  ⚠️  wandb not installed, skipping")
            use_wandb = False

    # Load dataset
    dataset_path = get_dataset_path('processed')

    # Load metadata
    metadata_path = dataset_path / 'dataset_metadata.json'
    with open(metadata_path) as f:
        metadata = json.load(f)

    num_classes = len(metadata['categories'])
    class_names = sorted(metadata['categories'])

    print(f"\n📊 Dataset Info:")
    print(f"  Classes: {num_classes}")
    print(f"  Names: {class_names}")

    # Create data generators
    train_datagen, val_datagen = create_data_generators(dataset_path)

    train_gen, val_gen, _ = load_datasets(train_datagen, val_datagen, dataset_path)

    # Compute class weights (for imbalanced datasets)
    class_weights = compute_class_weights(dataset_path / 'train')

    print(f"\n⚖️  Class weights:")
    for cls_name, weight in zip(class_names, class_weights.values()):
        print(f"    {cls_name}: {weight:.2f}")

    # ───────────────────────────────────────────────────────────
    # Phase 1: Train classification head (freeze base)
    # ───────────────────────────────────────────────────────────

    print("\n" + "="*60)
    print("🔒 PHASE 1: Train Classification Head")
    print("="*60)

    if resume_from:
        print(f"\n  Loading model from: {resume_from}")
        model = keras.models.load_model(resume_from)
    else:
        model = build_model(num_classes, freeze_base=True)

    # Compile
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=PHASE1_LR),
        loss=CONFIG['training']['loss'],
        metrics=CONFIG['training']['metrics']
    )

    print(f"\n  Optimizer: Adam (lr={PHASE1_LR})")
    print(f"  Loss: {CONFIG['training']['loss']}")
    print(f"  Metrics: {CONFIG['training']['metrics']}")

    # Callbacks
    phase1_callbacks = create_callbacks('phase1')
    phase1_callbacks.append(TrainingProgressCallback('PHASE 1'))

    # Train
    print(f"\n  Training for {PHASE1_EPOCHS} epochs...")

    history_phase1 = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=PHASE1_EPOCHS,
        callbacks=phase1_callbacks,
        class_weight=class_weights,
        verbose=0
    )

    print("\n✅ Phase 1 complete!")

    # ───────────────────────────────────────────────────────────
    # Phase 2: Fine-tune top layers (unfreeze)
    # ───────────────────────────────────────────────────────────

    print("\n" + "="*60)
    print("🔓 PHASE 2: Fine-tune Top Layers")
    print("="*60)

    # Unfreeze top layers
    unfreeze_top_layers(model, UNFREEZE_LAYERS)

    # Recompile with lower learning rate
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=PHASE2_LR),
        loss=CONFIG['training']['loss'],
        metrics=CONFIG['training']['metrics']
    )

    print(f"\n  Optimizer: Adam (lr={PHASE2_LR})")
    print(f"  Lower LR for fine-tuning")

    # Callbacks
    phase2_callbacks = create_callbacks('phase2')
    phase2_callbacks.append(TrainingProgressCallback('PHASE 2'))

    # Train
    print(f"\n  Training for {PHASE2_EPOCHS} epochs...")

    history_phase2 = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=PHASE2_EPOCHS,
        callbacks=phase2_callbacks,
        class_weight=class_weights,
        verbose=0
    )

    print("\n✅ Phase 2 complete!")

    # ───────────────────────────────────────────────────────────
    # Save final model
    # ───────────────────────────────────────────────────────────

    print("\n" + "="*60)
    print("💾 Saving Final Model")
    print("="*60)

    models_dir = get_project_root() / 'ml-training' / 'models' / 'scene-classifier'
    ensure_dir(models_dir)

    # Save with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    model_path = models_dir / f'scene_classifier_{timestamp}.keras'
    model.save(str(model_path))

    print(f"  ✅ Model saved: {model_path}")

    # Save as "latest"
    latest_path = models_dir / 'scene_classifier_latest.keras'
    model.save(str(latest_path))

    print(f"  ✅ Latest model: {latest_path}")

    # Save class labels
    class_labels = {
        'categories': class_names,
        'category_to_index': {cat: i for i, cat in enumerate(class_names)},
        'index_to_category': {i: cat for i, cat in enumerate(class_names)},
        'training_date': timestamp,
        'model_config': CONFIG
    }

    labels_path = models_dir / 'class_labels.json'
    with open(labels_path, 'w') as f:
        json.dump(class_labels, f, indent=2)

    print(f"  ✅ Labels saved: {labels_path}")

    # ───────────────────────────────────────────────────────────
    # Training summary
    # ───────────────────────────────────────────────────────────

    print("\n" + "="*60)
    print("📈 Training Summary")
    print("="*60)

    # Combine histories
    final_val_loss = history_phase2.history['val_loss'][-1]
    final_val_acc = history_phase2.history['val_accuracy'][-1]

    print(f"\n  Final Metrics:")
    print(f"    Validation Loss: {final_val_loss:.4f}")
    print(f"    Validation Accuracy: {final_val_acc:.4f}")

    # Check if target achieved
    target_acc = CONFIG['notes']['target_accuracy']
    if final_val_acc >= target_acc:
        print(f"\n  🎉 Target accuracy achieved! ({final_val_acc:.4f} >= {target_acc})")
    else:
        print(f"\n  ⚠️  Target accuracy not reached ({final_val_acc:.4f} < {target_acc})")
        print("     Consider:")
        print("     - Collecting more training data")
        print("     - Adjusting augmentation parameters")
        print("     - Training for more epochs")

    print("\n🚀 Next Steps:")
    print("1. Run validation: python scripts/04-validate-model.py")
    print(f"2. View TensorBoard: tensorboard --logdir {get_project_root()}/ml-training/logs/tensorboard")
    print("3. Convert to TF.js: ./scripts/05-convert-to-tfjs.sh")

    if use_wandb:
        wandb.finish()


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Train scene classifier with transfer learning'
    )

    parser.add_argument(
        '--resume',
        type=str,
        default=None,
        help='Path to checkpoint to resume training from'
    )

    parser.add_argument(
        '--wandb',
        action='store_true',
        help='Enable Weights & Biases logging'
    )

    args = parser.parse_args()

    # Check GPU availability
    gpus = tf.config.list_physical_devices('GPU')

    if gpus:
        print(f"\n🚀 GPU Detected: {len(gpus)} device(s)")
        for i, gpu in enumerate(gpus):
            print(f"   GPU {i}: {gpu.name}")
    else:
        print("\n⚠️  No GPU detected. Training will be slow.")
        print("   Expected time: ~8 hours (CPU)")

    try:
        train_model(resume_from=args.resume, use_wandb=args.wandb)
    except KeyboardInterrupt:
        print("\n\n⚠️  Training interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
