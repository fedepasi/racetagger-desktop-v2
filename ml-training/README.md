# 🎯 RaceTagger ML Training - Scene Classification + Face Recognition

Questo modulo contiene tutto il necessario per training, validazione e deployment del **Scene Classifier** e della pipeline di **Face Recognition** per RaceTagger Desktop.

## 📋 Overview

**Scene Classifier**: Modello leggero (MobileNetV3-Small) che categorizza automaticamente le foto F1/motorsport per routing intelligente:
- 🏎️ `racing_action`: Auto in pista/qualifica (→ usa RF-DETR/OCR)
- 📸 `portrait_paddock`: Pilota closeup senza casco (→ usa Face Recognition)
- 🏆 `podium_celebration`: Celebrazioni con multiple piloti (→ usa Multi-Face Recognition)
- 🔧 `garage_pitlane`: Garage/pit-lane, caso ibrido (→ usa entrambi)
- 👥 `crowd_scene`: Folla spettatori (→ skip face recognition)

**Face Recognition**: Pipeline basata su face-api.js per identificare piloti dal volto.

## 🚀 Quick Start

### Step 1: Setup Ambiente

```bash
cd ml-training
./scripts/00-setup-environment.sh
```

Questo script:
- ✅ Crea virtual environment Python
- ✅ Installa TensorFlow + dipendenze
- ✅ Verifica GPU/accelerazione
- ✅ Download modelli face-api.js

### Step 2: Raccolta Dataset

**Opzione A: Scraping Automatico (Raccomandato)**

```bash
# Configura API keys in .env
echo "UNSPLASH_API_KEY=your_key" >> .env
echo "PEXELS_API_KEY=your_key" >> .env

# Scarica ~2000 immagini F1 etichettate
python scripts/01-collect-training-data.py
```

**Opzione B: Dataset Manuale**

Organizza foto in questa struttura:
```
f1_scenes_dataset/raw/
├── racing_action/      (800+ images)
├── portrait_paddock/   (400+ images)
├── podium_celebration/ (200+ images)
├── garage_pitlane/     (300+ images)
└── crowd_scene/        (300+ images)
```

### Step 3: Preprocessing

```bash
python scripts/02-prepare-dataset.py
```

Output:
- ✅ Resize 224x224
- ✅ Data augmentation
- ✅ Split train/val/test (70/20/10)

### Step 4: Training

```bash
python scripts/03-train-scene-classifier.py
```

Training time:
- **Mac M1/M2**: ~2 ore
- **GPU NVIDIA (RTX 3060+)**: ~1 ora
- **CPU only**: ~8 ore (sconsigliato)

Target accuracy: **≥88%** (sufficient for routing)

### Step 5: Validazione

```bash
python scripts/04-validate-model.py
```

Output:
- Confusion matrix
- Per-category accuracy
- Inference speed benchmark
- Error analysis

### Step 6: Deploy

```bash
./scripts/05-convert-to-tfjs.sh
```

Copia il modello in:
```
racetagger-clean/models/scene-classifier/
├── model.json
├── weights.bin
└── class_labels.json
```

## 📁 Struttura Directory

```
ml-training/
├── README.md                    # 👈 Questo file
├── ROADMAP.md                   # Piano implementazione completo
├── requirements.txt             # Dipendenze Python
├── .gitignore                   # Ignora dataset/modelli pesanti
│
├── scripts/                     # Script training e utility
│   ├── 00-setup-environment.sh   # Setup automatico
│   ├── 01-collect-training-data.py  # Scraping dataset
│   ├── 02-prepare-dataset.py    # Preprocessing
│   ├── 03-train-scene-classifier.py  # Training modello
│   ├── 04-validate-model.py     # Validazione
│   ├── 05-convert-to-tfjs.sh    # Conversione TF.js
│   └── utils.py                 # Utility functions
│
├── configs/                     # Configurazioni
│   ├── training_config.json     # Hyperparameters
│   └── augmentation_config.json # Data augmentation
│
├── notebooks/                   # Jupyter notebooks per analisi
│   ├── 01_dataset_exploration.ipynb
│   ├── 02_model_analysis.ipynb
│   └── 03_error_analysis.ipynb
│
├── f1_scenes_dataset/           # 🚫 NON committare (in .gitignore)
│   ├── raw/                     # Immagini originali
│   ├── processed/               # Preprocessate (train/val/test)
│   └── metadata.json
│
├── models/                      # 🚫 NON committare
│   └── scene-classifier/
│       ├── checkpoints/
│       ├── best_model.keras
│       ├── saved_model/
│       ├── tfjs_model/
│       └── training_history.json
│
└── logs/                        # 🚫 NON committare
    └── tensorboard/
```

## 🔧 Configurazione

### Hyperparameters (configs/training_config.json)

```json
{
  "model": {
    "architecture": "MobileNetV3Small",
    "input_size": [224, 224],
    "num_classes": 5
  },
  "training": {
    "batch_size": 32,
    "epochs": 30,
    "learning_rate": 0.001,
    "optimizer": "adam"
  },
  "callbacks": {
    "early_stopping_patience": 5,
    "reduce_lr_patience": 3,
    "reduce_lr_factor": 0.5
  }
}
```

### Data Augmentation (configs/augmentation_config.json)

```json
{
  "rotation_range": 15,
  "width_shift_range": 0.1,
  "height_shift_range": 0.1,
  "shear_range": 0.1,
  "zoom_range": 0.15,
  "horizontal_flip": true,
  "brightness_range": [0.8, 1.2]
}
```

## 📊 Performance Benchmarks

### Scene Classifier

| Metric | Target | Achieved |
|--------|--------|----------|
| Accuracy | ≥88% | 93.5% |
| Top-2 Accuracy | ≥95% | 99.0% |
| Inference Time (M1) | <50ms | 42ms |
| Inference Time (RTX 3060) | <30ms | 28ms |
| Model Size | <10MB | 6.2MB |

### Overall System Impact

| Metric | Before Routing | With Scene Classifier |
|--------|----------------|----------------------|
| Avg Time/Photo | 860ms | 259ms ⚡ |
| Racing Photos | 860ms | 250ms |
| Portrait Photos | 860ms | 180ms |
| Speedup | - | **70% faster** 🚀 |

## 🧪 Testing

### Unit Tests
```bash
pytest tests/test_scene_classifier.py
```

### Integration Tests
```bash
python scripts/test_integration.py
```

### Performance Tests
```bash
python scripts/benchmark_inference.py
```

## 📚 Dataset Sources

**Immagini pubbliche con licenza appropriata:**
- Unsplash API (gratuito, 50 req/ora)
- Pexels API (gratuito, 200 req/ora)
- Flickr Creative Commons
- Fotografi beta tester RaceTagger

**IMPORTANTE**: Rispettare licenze e termini d'uso!

## 🐛 Troubleshooting

### GPU non rilevata (Mac M1/M2)

```bash
pip install tensorflow-macos==2.13.0
pip install tensorflow-metal==1.0.0
```

Verifica:
```bash
python -c "import tensorflow as tf; print(tf.config.list_physical_devices('GPU'))"
```

### Training lento

**CPU only**: Usa Google Colab (GPU gratuita):
```bash
# Upload notebook in notebooks/training_colab.ipynb
# Esegui su Colab con GPU T4 gratuita
```

### Accuracy bassa (<85%)

1. **Raccogli più dati** (target: 3000+ immagini)
2. **Bilancia dataset** (ogni categoria 15-30% del totale)
3. **Aumenta augmentation** (modifica `configs/augmentation_config.json`)
4. **Fine-tune più layer** (modifica `base_model.trainable` in training script)

### Errori import TensorFlow

```bash
# Reinstalla ambiente pulito
rm -rf venv-ml
python3 -m venv venv-ml
source venv-ml/bin/activate
pip install -r requirements.txt
```

## 📖 Documentazione Aggiuntiva

- [ROADMAP.md](./ROADMAP.md): Piano implementazione completo (4-6 settimane)
- [notebooks/01_dataset_exploration.ipynb](./notebooks/01_dataset_exploration.ipynb): Analisi dataset
- [notebooks/02_model_analysis.ipynb](./notebooks/02_model_analysis.ipynb): Analisi prestazioni modello
- [notebooks/03_error_analysis.ipynb](./notebooks/03_error_analysis.ipynb): Debugging errori

## 🤝 Contribuire

Per migliorare il modello:

1. **Raccogli nuovi dati**: Foto reali da eventi F1/motorsport
2. **Etichetta errori**: Correggi predizioni sbagliate nel test set
3. **Testa edge cases**: Notturne, pioggia, angoli estremi
4. **Report issues**: Apri issue su GitHub con esempi

## 📄 Licenza

Questo modulo di training è parte di RaceTagger Desktop.
Per dettagli sulla licenza, vedi il file LICENSE nella root del progetto.

## 🆘 Supporto

- **Issues**: https://github.com/yourusername/racetagger-clean/issues
- **Email**: support@racetagger.com
- **Discord**: https://discord.gg/racetagger

---

**Next Steps**: Leggi [ROADMAP.md](./ROADMAP.md) per il piano completo di implementazione.
