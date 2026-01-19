# 📑 RF-DETR → ONNX Conversion - Index Completo

Questa pagina elenca tutte le risorse disponibili per convertire modelli RF-DETR in formato ONNX.

## 🎯 Per Chi Inizia: Dove Andare

### ❓ Ho un modello .pt trainato su Roboflow, cosa faccio?

**Opzione 1: Script Bash Automatico** (più veloce) ⚡
```bash
cd rf-detr-onnx-converter
./convert.sh your_model.pt
```
➡️ Leggi: [`rf-detr-onnx-converter/README.md`](./rf-detr-onnx-converter/README.md)

---

**Opzione 2: Google Colab** (no setup locale) ☁️
1. Apri [`notebooks/RF_DETR_to_ONNX_Conversion_Colab.ipynb`](./notebooks/RF_DETR_to_ONNX_Conversion_Colab.ipynb)
2. Upload su [Google Colab](https://colab.research.google.com/)
3. Segui le celle passo-passo

---

**Opzione 3: Script Python Manuale** (massimo controllo) 🔧
```bash
cd rf-detr-onnx-converter
python export.py --checkpoint your_model.pt
```
➡️ Leggi: [`CONVERSION_GUIDE.md`](./CONVERSION_GUIDE.md)

---

### ❓ Il metodo semplice non funziona

**Usa il metodo avanzato con parametri custom:**
```bash
cd rf-detr-onnx-converter
python convert_advanced.py \
    --checkpoint your_model.pt \
    --method advanced \
    --num-classes 60 \
    --resolution 640
```
➡️ Leggi: Sezione "Metodo Avanzato" in [`CONVERSION_GUIDE.md`](./CONVERSION_GUIDE.md#metodo-2-avanzato-jit--double-wrapper)

---

### ❓ Voglio capire tutto nel dettaglio

Leggi la guida completa: **[`CONVERSION_GUIDE.md`](./CONVERSION_GUIDE.md)**

Contiene:
- ✅ Quando usare quale metodo
- ✅ Troubleshooting esaustivo
- ✅ Codice post-processing completo
- ✅ Esempi inference ONNX Runtime
- ✅ Visualizzazione detections

---

## 📁 File Disponibili

### Guide & Documentazione

| File | Descrizione | Quando Usare |
|------|-------------|--------------|
| **[CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md)** | 📚 Guida completa master (12k+ parole) | Vuoi capire tutto o hai problemi |
| **[RFDETR_ONNX_CONVERSION_GUIDE.md](./RFDETR_ONNX_CONVERSION_GUIDE.md)** | 📄 Guida legacy (metodo semplice base) | Quick reference metodo base |
| **[README.md](./README.md)** | 📖 README principale ml-training | Panoramica generale del modulo |
| **[rf-detr-onnx-converter/README.md](./rf-detr-onnx-converter/README.md)** | 🔧 README converter directory | Quick start converter tools |

### Script Eseguibili

| File | Tipo | Descrizione |
|------|------|-------------|
| **[convert.sh](./rf-detr-onnx-converter/convert.sh)** | Bash | Script automatico con UI colorata |
| **[export.py](./rf-detr-onnx-converter/export.py)** | Python | Conversione semplice auto-detect |
| **[convert_advanced.py](./rf-detr-onnx-converter/convert_advanced.py)** | Python | Dual-method (simple/advanced) |
| **[rfdetr_onnx.py](./rf-detr-onnx-converter/rfdetr_onnx.py)** | Python | Inference ONNX Runtime |

### Notebook Interattivi

| File | Piattaforma | Descrizione |
|------|-------------|-------------|
| **[RF_DETR_to_ONNX_Conversion_Colab.ipynb](./notebooks/RF_DETR_to_ONNX_Conversion_Colab.ipynb)** | Google Colab | Conversione step-by-step con test |

---

## 🚀 Quick Reference: Comandi Comuni

### Conversione Base (Auto-detect)

```bash
# Bash script (raccomandato)
cd rf-detr-onnx-converter
./convert.sh model.pt

# Python equivalente
python export.py --checkpoint model.pt
```

### Conversione Avanzata (Custom Parameters)

```bash
python convert_advanced.py \
    --checkpoint model.pt \
    --method advanced \
    --num-classes 60 \
    --resolution 640 \
    --output custom_name.onnx
```

### Test del Modello ONNX

```python
import onnxruntime as ort
import numpy as np

# Carica modello
session = ort.InferenceSession('model.onnx')

# Dummy input
dummy = np.random.randn(1, 3, 512, 512).astype(np.float32)

# Inference
outputs = session.run(None, {'input': dummy})
print(f"Boxes: {outputs[0].shape}")   # [1, 300, 4]
print(f"Scores: {outputs[1].shape}")  # [1, 300, num_classes]
```

### Verifica Modello

```bash
# Checksum
shasum -a 256 model.onnx

# ONNX checker
python -c "import onnx; onnx.checker.check_model(onnx.load('model.onnx'))"

# Semplificazione (se non già fatto)
python -m onnxsim model.onnx model_simplified.onnx
```

---

## 🔍 Troubleshooting Index

Problema riscontrato? Cerca qui:

| Errore | File da Consultare | Sezione |
|--------|-------------------|---------|
| `torch.export` fails | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → torch.export fails" |
| Position embeddings mismatch | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → Position embeddings" |
| MPS allocation (Mac M-series) | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → MPS tensor allocation" |
| `antialias` parameter | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → antialias parameter" |
| No signature found | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → No signature found" |
| Modello troppo grande | [CONVERSION_GUIDE.md](./CONVERSION_GUIDE.md) | "Troubleshooting → Modello troppo grande" |

Per tutti gli altri problemi, consulta la sezione **Troubleshooting** completa in [`CONVERSION_GUIDE.md`](./CONVERSION_GUIDE.md#troubleshooting).

---

## 📊 Tabella di Decisione: Quale Metodo Usare?

```
Hai trainato con resolution standard (512/560/576)?
│
├─ SÌ  → USA METODO SEMPLICE
│        ./convert.sh model.pt
│
└─ NO  → Hai trainato con custom resolution (640/800)?
         │
         ├─ SÌ  → USA METODO AVANZATO
         │        python convert_advanced.py --method advanced \
         │            --num-classes X --resolution Y
         │
         └─ Non sai → ISPEZIONA CHECKPOINT
                      python -c "import torch; ckpt=torch.load('model.pt', weights_only=False); print(ckpt['args'].resolution)"
```

---

## 🎓 Tutorial Completo: From Zero to ONNX

### Step 1: Preparazione

```bash
# Clone repository (se non hai già)
cd ml-training/rf-detr-onnx-converter

# Setup virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Installa dipendenze
pip install rfdetr==1.3.0 onnx==1.19.0 onnxsim==0.4.36 torch==2.8.0
```

### Step 2: Conversione

```bash
# Metodo automatico
./convert.sh your_model.pt
```

O manuale:
```bash
python export.py --checkpoint your_model.pt
```

### Step 3: Verifica

```bash
# Checksum (salva questo per upload)
shasum -a 256 your_model.onnx

# Test rapido
python -c "
import onnxruntime as ort
import numpy as np

session = ort.InferenceSession('your_model.onnx')
dummy = np.random.randn(1, 3, 512, 512).astype(np.float32)
outputs = session.run(None, {session.get_inputs()[0].name: dummy})
print(f'✅ Output shapes: boxes={outputs[0].shape}, scores={outputs[1].shape}')
"
```

### Step 4: Upload al Management Portal

1. Vai a **Management Portal** → **Model Manager**
2. Seleziona **sport category** (es. F1, MotoGP)
3. Compila:
   - Version: `v1`, `v2`, etc.
   - Notes: Descrizione modello
   - Classes: Copia da Roboflow training
4. Upload file `.onnx`
5. Incolla SHA256 checksum
6. Save

### Step 5: Test in RaceTagger Desktop

1. Management Portal → Sport Categories
2. Edit categoria
3. Set `edge_function_version` = 4 (RF-DETR)
4. Set `rf_detr_workflow_url` = tuo endpoint
5. Test con immagini reali

---

## 📚 Approfondimenti

### Output Format Explained

**Boxes**: `[batch, 300, 4]`
- 300 = Numero massimo detections
- 4 = (x1, y1, x2, y2) coordinate normalizzate 0-1
- Per convertire in pixel: `x1_pixel = x1 * image_width`

**Scores**: `[batch, 300, num_classes]`
- Logits RAW (NON probabilità)
- Applica softmax: `probs = exp(scores) / sum(exp(scores))`
- Best class: `argmax(probs, axis=-1)`

### Post-Processing Pipeline

1. **Softmax** → Converti logits in probabilità
2. **Argmax** → Trova classe con score massimo
3. **Threshold** → Filtra detections con confidence < 0.5
4. **NMS** → Rimuovi overlap (IoU > 0.5)
5. **Denormalize** → Converti coordinate 0-1 in pixel

Codice completo: [`CONVERSION_GUIDE.md#post-processing`](./CONVERSION_GUIDE.md#post-processing)

---

## 🔗 Link Utili

### Repository

- **RF-DETR Originale**: https://github.com/roboflow/rf-detr
- **ONNX Converter (Base)**: https://github.com/PierreMarieCurie/rf-detr-onnx

### Documentazione

- **PyTorch ONNX**: https://pytorch.org/docs/stable/onnx.html
- **ONNX Runtime**: https://onnxruntime.ai/docs/
- **ONNX Simplifier**: https://github.com/daquexian/onnx-simplifier

### Training & Datasets

- **Roboflow**: https://roboflow.com/
- **RF-DETR Training Docs**: https://docs.roboflow.com/

---

## ⚙️ Versioni Testate

- **PyTorch**: 2.8.0
- **ONNX**: 1.19.0
- **onnxsim**: 0.4.36
- **rfdetr**: 1.3.0
- **Python**: 3.9+

---

## 📝 Note Finali

- ✅ Tutti gli script includono error handling
- ✅ Legacy exporter (`dynamo=False`) già configurato
- ✅ MPS fallback per Mac M-series già abilitato
- ✅ Semplificazione automatica dove possibile
- ✅ Checksum SHA256 calcolato automaticamente

**Per qualsiasi dubbio, consulta prima [`CONVERSION_GUIDE.md`](./CONVERSION_GUIDE.md)** - contiene tutte le risposte!

---

**Autore**: RaceTagger Team
**Ultimo aggiornamento**: 2026-01-18
**Licenza**: MIT (converter tools), Apache 2.0 (RF-DETR weights)
