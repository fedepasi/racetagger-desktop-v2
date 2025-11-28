# 🚀 Quick Start - Google Colab Training

## Passo 1: Upload Dataset su Drive ⬆️

**Stai già caricando la cartella su Drive? Perfetto!**

Il notebook troverà automaticamente il dataset in:
- ✅ `/MyDrive/f1_scenes_dataset` ← **Posizione principale**
- ✅ `/MyDrive/RaceTagger/f1_scenes_dataset`
- ✅ `/MyDrive/ml-training/f1_scenes_dataset`

**Struttura richiesta:**
```
MyDrive/
└── f1_scenes_dataset/
    └── processed/
        ├── train/     (5 categorie, ~1481 immagini)
        ├── val/       (5 categorie, ~422 immagini)
        └── test/      (5 categorie, ~216 immagini)
```

---

## Passo 2: Apri Notebook su Colab 📓

1. Vai su https://colab.research.google.com/
2. **File → Upload notebook**
3. Seleziona: `ml-training/notebooks/scene_classifier_training_colab.ipynb`

**Oppure:**
- Carica il notebook su Drive
- Click destro → **Open with → Google Colaboratory**

---

## Passo 3: Configura GPU 🎮

**IMPORTANTE**: Devi usare GPU per velocità!

1. **Runtime → Change runtime type**
2. **Hardware accelerator: GPU**
3. **GPU type: T4** (free tier)
4. **Save**

Verifica GPU attiva:
```python
!nvidia-smi  # Deve mostrare Tesla T4
```

---

## Passo 4: Esegui Celle Sequenzialmente ▶️

### Cella 1: Check GPU
```python
!nvidia-smi
!pip install -q tensorflow pillow tensorflowjs matplotlib seaborn
```
✅ Output atteso: TensorFlow version + GPU detected

### Cella 2: Mount Drive + Find Dataset
```python
from google.colab import drive
drive.mount('/content/drive')
```
✅ Output atteso: "Dataset found: /content/drive/MyDrive/f1_scenes_dataset"

**Se dice "Dataset not found":**
- Controlla che upload sia completato
- Verifica struttura cartella: `f1_scenes_dataset/processed/train/`
- Lista folders: `!ls -la /content/drive/MyDrive/`

### Cella 3-7: Setup + Model Building
Esegui tutte le celle fino a "Training utilities ready"

---

## Passo 5: Scegli Quale Modello Trainare 🤖

### Opzione A: Tutti e 3 (RACCOMANDATO per confronto)
Esegui in sequenza:
1. **Cella 8**: Train MobileNetV3 (~45 min)
2. **Cella 10**: Train ResNet50 (~60 min)
3. **Cella 12**: Train EfficientNet (~55 min)
4. **Cella 14**: Confronta risultati

**Tempo totale: ~2.5-3 ore**

### Opzione B: Solo il Migliore (più veloce)
Esegui solo:
1. **Cella 10**: Train ResNet50 (~60 min)
   - Target: 85-92% accuracy
   - Best balance accuracy/size

---

## Passo 6: Export TensorFlow.js 📦

### Cella 16: Export Models

**Prima di eseguire, modifica best_model:**
```python
# Se hai trainato ResNet e ha accuracy migliore:
best_model_file = '/content/resnet_scene_classifier_final.keras'
best_model_name = 'resnet'

# Se hai trainato MobileNetV3:
best_model_file = '/content/mobilenet_scene_classifier_final.keras'
best_model_name = 'mobilenet'

# Se hai trainato EfficientNet:
best_model_file = '/content/efficientnet_scene_classifier_final.keras'
best_model_name = 'efficientnet'
```

Poi esegui la cella → export automatico in 2 formati:
- Standard (full precision)
- Quantized int8 (più piccolo)

---

## Passo 7: Test + Download 📥

### Cella 18: Test su sample images
Valida accuracy su test set

### Cella 20: Download risultati
Scarica automaticamente:
- ✅ `scene_classifier_tfjs.zip` - Tutti i modelli TF.js
- ✅ `*_scene_classifier_final.keras` - Best model Keras
- ✅ `training_results.json` - Metriche complete
- ✅ `model_comparison.png` - Grafico comparativo

---

## 🎯 Metriche di Successo

### Accuracy Targets:
- **MobileNetV3**: 75-80% ✅ (se ≥75%)
- **ResNet50**: 85-92% ✅ (se ≥85%)
- **EfficientNet**: 80-88% ✅ (se ≥80%)

### Inference Speed (dopo deployment):
- **Target**: <50ms per predizione
- **ResNet**: ~80-120ms (accettabile)
- **MobileNetV3**: ~30-50ms (ottimo)

---

## ⚠️ Troubleshooting Comuni

### "Dataset not found"
```bash
# In Colab, controlla cartelle su Drive:
!ls -la /content/drive/MyDrive/

# Verifica struttura dataset:
!ls -la /content/drive/MyDrive/f1_scenes_dataset/
!ls -la /content/drive/MyDrive/f1_scenes_dataset/processed/
```

**Fix**: Sposta manualmente la cartella in `/MyDrive/f1_scenes_dataset`

### "No GPU available"
```
Runtime → Change runtime type → GPU (T4) → Save
Runtime → Restart runtime
```

### "Out of memory"
Riduci batch size in Cella 3:
```python
BATCH_SIZE = 16  # Invece di 32
```

### Training troppo lento (>4 ore)
Verifica GPU attiva:
```python
import tensorflow as tf
print(tf.config.list_physical_devices('GPU'))
# Deve mostrare GPU, non []
```

---

## 📊 Cosa Aspettarsi Durante Training

### Phase 1 (Freeze base)
```
Epoch 1/20
Train accuracy: ~20-30%
Val accuracy: ~25-35%
Time: ~2-3 min/epoch
```

### Phase 2 (Fine-tuning)
```
Epoch 1/30
Train accuracy: ~40-60%
Val accuracy: ~50-70%
Time: ~2-4 min/epoch

Final (best epoch):
Val accuracy: 75-92% (dipende da modello)
```

### Se Accuracy Finale < 75%:
- ⚠️ Dataset troppo difficile (96% Pexels stock photos)
- ⚠️ Serve più dati reali di gara
- ✅ Ma modello ancora utilizzabile per MVP!

---

## 📋 Dopo il Training

1. **Estrai ZIP**: `unzip scene_classifier_tfjs.zip`

2. **Testa locale**:
   ```bash
   cd ml-training
   python scripts/04-validate-tfjs-model.py --model-path tfjs_models/resnet_quantized/
   ```

3. **Integra in RaceTagger**:
   ```bash
   cp -r tfjs_models/resnet_quantized/ ../../racetagger-desktop-app/models/scene-classifier/
   ```

4. **Test inference** in Electron app

---

## 🆘 Serve Aiuto?

**Upload bloccato?**
- Verifica connessione internet
- Prova browser diverso
- Usa Google Drive desktop app

**Training fallito?**
- Controlla log errori nella cella
- Verifica GPU attiva
- Riavvia runtime e riprova

**Accuracy troppo bassa?**
- Normale con dataset 96% Pexels
- Serve raccogliere più foto reali
- Usa modello comunque per testing

---

**Tempo totale stimato**: 3-4 ore (upload + training + download)

**Buon training! 🚀**
