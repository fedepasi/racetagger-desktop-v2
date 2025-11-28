# 🚀 Google Colab Training - Scene Classifier

## 🐛 Bug Fix Critico

Il training locale falliva (12% accuracy) a causa di un **bug nella linea 103** di `03-train-scene-classifier.py`:

```python
# ❌ BUG - Blocca batch normalization durante fine-tuning
x = base_model(inputs, training=False)

# ✅ FIX - Permette aggiornamento batch norm
x = base_model(inputs)
```

### Impatto del Bug:
- **Phase 1** (freeze base): 32% accuracy - OK
- **Phase 2** (fine-tuning): 12% accuracy - CROLLA invece di migliorare!
- **Causa**: `training=False` impedisce aggiornamento batch normalization layers

### Perché Roboflow ha Funzionato:
- AutoML gestisce correttamente batch normalization
- Architetture più potenti (ResNet18: 11.5M params vs MobileNetV3: 2.5M)
- Hyperparameters ottimizzati automaticamente

---

## 📋 Come Usare il Notebook Colab

### 1. Preparazione Dataset

Carica la cartella `f1_scenes_dataset` su Google Drive.

**Opzione A - Carica Cartella Direttamente (RACCOMANDATO):**
1. Apri Google Drive nel browser
2. Trascina la cartella `ml-training/f1_scenes_dataset` nella root di "Il mio Drive"
3. Attendi upload completo

**Struttura attesa su Drive:**
```
MyDrive/
└── f1_scenes_dataset/          ← Carica questa cartella
    └── processed/
        ├── train/
        │   ├── crowd_scene/
        │   ├── garage_pitlane/
        │   ├── podium_celebration/
        │   ├── portrait_paddock/
        │   └── racing_action/
        ├── val/
        └── test/
```

**Opzione B - Carica ZIP:**
1. Comprimi dataset:
   ```bash
   cd ml-training
   zip -r f1_scenes_dataset.zip f1_scenes_dataset/
   ```
2. Carica ZIP su Drive
3. Estrai su Drive:
   - Right click → Extract
   - Oppure estrai in Colab con `!unzip`

**Il notebook troverà automaticamente il dataset** in:
- `/content/drive/MyDrive/f1_scenes_dataset` ← **Posizione principale**
- `/content/drive/MyDrive/RaceTagger/f1_scenes_dataset`
- `/content/drive/MyDrive/ml-training/f1_scenes_dataset`

### 2. Aprire Notebook su Colab

**Opzione A - Da File Locale:**
1. Vai su https://colab.research.google.com/
2. File → Upload notebook
3. Seleziona `scene_classifier_training_colab.ipynb`

**Opzione B - Da Google Drive:**
1. Carica notebook su Drive
2. Click destro → Open with → Google Colaboratory

### 3. Configurare Runtime GPU

⚠️ **IMPORTANTE**: Deve usare GPU per velocità!

1. Runtime → Change runtime type
2. Hardware accelerator: **GPU**
3. GPU type: **T4** (free tier)
4. Save

### 4. Eseguire Training

**Sequenza completa:**
1. ✅ Check GPU availability
2. ✅ Mount Google Drive
3. ✅ Load dataset
4. ✅ Train MobileNetV3-Small (~30-45 min)
5. ✅ Train ResNet50 (~45-60 min)
6. ✅ Train EfficientNet-B0 (~40-55 min)
7. ✅ Compare results
8. ✅ Export TensorFlow.js
9. ✅ Download models

**Tempo totale stimato: 2-3 ore**

### 5. Download Modelli

Al termine del training, il notebook scaricherà automaticamente:
- `scene_classifier_tfjs.zip` - Modelli TF.js (standard + quantized)
- `*_scene_classifier_final.keras` - Best model Keras
- `training_results.json` - Metriche complete
- `model_comparison.png` - Grafico comparativo

---

## 🎯 Risultati Attesi

### MobileNetV3-Small (Fixed)
- **Accuracy target**: 75-80%
- **Size**: 2-3MB (quantized)
- **Inference**: <50ms
- **Pro**: Leggero, veloce, ideale per deployment
- **Contro**: Accuracy più bassa delle altre architetture

### ResNet50 (config ResNet18)
- **Accuracy target**: 85-92%
- **Size**: 10-15MB (quantized)
- **Inference**: 80-120ms
- **Pro**: Alta accuracy (replicare Roboflow 89%)
- **Contro**: Più pesante, inferenza più lenta

### EfficientNet-B0
- **Accuracy target**: 80-88%
- **Size**: 4-6MB (quantized)
- **Inference**: 50-80ms
- **Pro**: Bilanciato size/performance
- **Contro**: Compromesso su tutto

---

## 📦 Deployment in RaceTagger

### 1. Estrai Modelli TensorFlow.js

```bash
unzip scene_classifier_tfjs.zip
cd tfjs_models/
```

Troverai:
- `resnet/` - Standard model
- `resnet_quantized/` - Quantized int8 (consigliato)
- `mobilenet/`
- `mobilenet_quantized/`
- `efficientnet/`
- `efficientnet_quantized/`

### 2. Copia nel Progetto

```bash
# Esempio con ResNet quantized (best performance)
cp -r resnet_quantized/ ../../../racetagger-desktop-app/models/scene-classifier/
```

### 3. Testa Inferenza Locale

Usa lo script di validazione (vedi `04-validate-tfjs-model.py`):

```bash
python scripts/04-validate-tfjs-model.py --model-path models/scene-classifier/resnet_quantized/
```

### 4. Integra in Electron App

Vedi documentazione integrazione TensorFlow.js in Electron:
- Load model: `tf.loadGraphModel()`
- Preprocess images: Resize 224x224, normalize /255
- Run inference: `model.predict()`
- Get predictions: `argMax()` + category mapping

---

## 🔧 Troubleshooting

### Dataset non trovato
```
FileNotFoundError: [Errno 2] No such file or directory: '/content/drive/MyDrive/f1_scenes_dataset'
```

**Fix:**
1. Verifica path montaggio Drive: `!ls /content/drive/MyDrive/`
2. Modifica `DATASET_PATH` nella cella di config
3. Oppure usa upload manuale invece di Drive

### GPU non disponibile
```
No GPU available
```

**Fix:**
1. Runtime → Change runtime type
2. Seleziona GPU T4
3. Save e riavvia runtime

### Out of memory durante training
```
ResourceExhaustedError: OOM when allocating tensor
```

**Fix:**
1. Riduci `BATCH_SIZE` da 32 a 16
2. Modifica in cella "Configuration"
3. Riavvia training

### Training troppo lento (>4 ore)
```
Epoch 1/20 - 15min per epoch
```

**Cause:**
- GPU non attiva (usa CPU)
- Dataset non caricato in memoria
- Troppo augmentation

**Fix:**
1. Verifica GPU: `!nvidia-smi`
2. Usa dataset da Drive (più veloce di upload)
3. Riduci augmentation se necessario

---

## 📊 Confronto Roboflow vs Colab

| Feature | Roboflow | Google Colab |
|---------|----------|--------------|
| **Costo** | $49/mese (Basic) | GRATUITO |
| **GPU** | Automatico | T4 free tier |
| **Training** | AutoML ottimizzato | Manuale (ma controllabile) |
| **Export** | ❌ Solo API (no download) | ✅ TF.js, Keras, ONNX |
| **Customization** | Limitato | Completo |
| **Deployment** | Cloud o self-hosted | Standalone TF.js |
| **Privacy** | Upload al cloud | Locale/Drive |

**Verdict**: Colab meglio per deployment standalone offline.

---

## 🚀 Next Steps

Dopo training su Colab:

1. ✅ **Validare accuracy** su test set
2. ✅ **Confrontare modelli** (standard vs quantized)
3. ✅ **Testare inferenza** in Electron app
4. ✅ **Misurare performance** (<50ms target?)
5. ⚠️ **Considerare dataset reale** se accuracy <88%

### Strategia Long-Term:

**Se accuracy >= 88%:**
→ Deploy in produzione con modello quantized

**Se accuracy 75-87%:**
→ Sufficiente per MVP, ma pianificare:
- Raccolta foto reali eventi (500/categoria)
- Re-training con dataset bilanciato (80% real / 20% Pexels)
- Fine-tuning incrementale

**Se accuracy < 75%:**
→ Dataset troppo difficile, serve:
- Più dati reali di qualità
- Pulizia dataset Pexels (rimuovere foto ambigue)
- Architettura ancora più potente (ResNet50 full, non config 18)

---

## 📚 Risorse

- [TensorFlow.js Documentation](https://www.tensorflow.org/js)
- [Keras Transfer Learning Guide](https://keras.io/guides/transfer_learning/)
- [Google Colab Tips](https://colab.research.google.com/notebooks/intro.ipynb)
- [Model Quantization](https://www.tensorflow.org/model_optimization/guide/quantization/training)

---

## 🐛 Bug Reporting

Se trovi problemi con il notebook:
1. Salva log dell'errore
2. Esporta notebook con output: File → Download → .ipynb
3. Apri issue con notebook e log

---

**Creato**: 2025-11-25
**Ultima modifica**: 2025-11-25
**Versione**: 1.0
