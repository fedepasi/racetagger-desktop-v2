# Guida Completa: Conversione RF-DETR → ONNX

Documentazione completa per convertire modelli RF-DETR trainati su Roboflow in formato ONNX.

## 📚 Indice

- [Quando Usare Quale Metodo](#quando-usare-quale-metodo)
- [Metodo 1: Semplice (Raccomandato)](#metodo-1-semplice-raccomandato)
- [Metodo 2: Avanzato (JIT + Double Wrapper)](#metodo-2-avanzato-jit--double-wrapper)
- [Google Colab](#google-colab)
- [Troubleshooting](#troubleshooting)
- [Post-Processing](#post-processing)

## 🎯 Quando Usare Quale Metodo

### Metodo SEMPLICE ✅ (Raccomandato)

**Usa questo quando:**
- Hai trainato su Roboflow con risoluzioni standard (384/512/560/576)
- Vuoi il processo più semplice e veloce
- Vuoi rilevamento automatico del model size
- Hai bisogno di massima compatibilità

**Script:**
- `rf-detr-onnx-converter/export.py` (automatico)
- `rf-detr-onnx-converter/convert_advanced.py --method simple`

**Caratteristiche:**
- ✅ Auto-detect model size dal checkpoint
- ✅ Legacy exporter (PyTorch 2.9+ compatible)
- ✅ Semplificazione automatica con onnxsim
- ✅ Verifica del modello integrata

**Output:**
- Input: `input` shape `[1, 3, resolution, resolution]`
- Output: `boxes` `[1, 300, 4]`, `scores` `[1, 300, num_classes]`

---

### Metodo AVANZATO 🔧

**Usa questo quando:**
- Hai trainato con resolution custom (es. 640)
- Il metodo semplice fallisce con errori strani
- Hai bisogno di dynamic batch size
- Hai problemi con position embeddings
- Vuoi controllare manualmente tutti i parametri

**Script:**
- `rf-detr-onnx-converter/convert_advanced.py --method advanced`

**Caratteristiche:**
- ✅ Supporta resolution custom
- ✅ Double wrapper strategy (output + JIT)
- ✅ JIT tracing prima dell'export
- ✅ Dynamic batch axis
- ⚠️ Richiede specificare manualmente num_classes e resolution

**Output:**
- Input: `images` shape `[batch, 3, resolution, resolution]`
- Output: `pred_logits` `[batch, 300, num_classes]`, `pred_boxes` `[batch, 300, 4]`

---

## Metodo 1: Semplice (Raccomandato)

### Setup

```bash
cd ml-training/rf-detr-onnx-converter

# Crea virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Mac/Linux
# .venv\Scripts\activate   # Windows

# Installa dipendenze
pip install rfdetr==1.3.0 onnx==1.19.0 onnxsim==0.4.36 torch==2.8.0
```

### Conversione Automatica

```bash
# Metodo A: Script originale (più semplice)
python export.py --checkpoint path/to/your/model.pt

# Metodo B: Script avanzato in modalità simple
python convert_advanced.py --checkpoint path/to/your/model.pt --method simple
```

### Con Resolution Custom

```bash
python convert_advanced.py \
    --checkpoint model.pt \
    --method simple \
    --resolution 640
```

### Output Personalizzato

```bash
python export.py \
    --checkpoint RT-F1-2025-V4_weights.pt \
    --model-name f1_2025_v4.onnx
```

### Cosa Succede Internamente

1. **Analisi Checkpoint**: Legge `args.resolution` e `args.hidden_dim`
2. **Auto-detect Model**:
   - `resolution=384` → RFDETRNano
   - `resolution=512` → RFDETRSmall
   - `resolution=560 + hidden_dim=256` → RFDETRBase
   - `resolution=560 + hidden_dim=384` → RFDETRLarge
   - `resolution=576` → RFDETRMedium
3. **Carica Modello**: `model = RFDETRSmall(pretrain_weights=...)`
4. **Prepara Export**:
   - Estrae `inner_model = model.model.model`
   - Sposta su CPU: `inner_model.cpu()`
   - Modalità eval: `inner_model.eval()`
   - **Fix embeddings**: `inner_model.export()` ← **CRITICO!**
5. **Export ONNX**:
   - `torch.onnx.export(..., dynamo=False)` ← Legacy exporter
6. **Verifica**: `onnx.checker.check_model()`
7. **Semplifica**: `onnxsim.simplify()`

---

## Metodo 2: Avanzato (JIT + Double Wrapper)

### Quando È Necessario

- Training custom con resolution non standard (640, 800, etc.)
- Errori tipo `position embedding size mismatch`
- Problemi con dynamic shapes
- Errori strani durante l'export standard

### Setup

```bash
cd ml-training/rf-detr-onnx-converter
source .venv/bin/activate

# Stesse dipendenze del metodo semplice
pip install rfdetr==1.3.0 onnx==1.19.0 torch==2.8.0
```

### Conversione

```bash
python convert_advanced.py \
    --checkpoint output/checkpoint_best_ema.pth \
    --method advanced \
    --num-classes 60 \
    --resolution 640 \
    --output rf_detr_custom.onnx
```

### Parametri Richiesti

| Parametro | Descrizione | Esempio |
|-----------|-------------|---------|
| `--checkpoint` | File .pt/.pth | `checkpoint_best_ema.pth` |
| `--num-classes` | Numero classi training | `60` |
| `--resolution` | Resolution training | `640` |
| `--output` | Nome file output | `model.onnx` |

### Cosa Succede Internamente

1. **Setup Environment**:
   ```python
   os.environ['TORCH_ONNX_USE_LEGACY_EXPORTER'] = '1'
   ```

2. **Wrapper 1 - Output Cleaning**:
   ```python
   class DetrOutputWrapper(nn.Module):
       def forward(self, x):
           out = self.model(x)
           return out['pred_logits'], out['pred_boxes']
   ```
   Converte dict → tuple per ONNX

3. **JIT Tracing**:
   ```python
   traced_net = torch.jit.trace(model_clean_output, dummy_input)
   ```
   Pre-traccia il grafo computazionale

4. **Wrapper 2 - JIT Wrapping**:
   ```python
   class JITWrapper(nn.Module):
       def forward(self, x):
           return self.traced_model(x)
   ```
   Fornisce signature Python per ONNX exporter

5. **Export ONNX**:
   ```python
   torch.onnx.export(
       final_model,
       dummy_input,
       output_path,
       dynamic_axes={
           'images': {0: 'batch_size'},
           'pred_logits': {0: 'batch_size'},
           'pred_boxes': {0: 'batch_size'}
       }
   )
   ```
   Batch size dinamico, resolution fissa

### Vantaggi vs Svantaggi

**✅ Vantaggi:**
- Supporta resolution custom
- Risolve problemi con position embeddings
- Dynamic batch size
- Maggiore controllo sul processo

**❌ Svantaggi:**
- Più complesso
- Richiede parametri manuali
- Resolution fissa nell'ONNX (no dynamic H/W)
- Due wrapper aggiungono overhead

---

## Google Colab

Per chi preferisce usare Google Colab:

### Notebook Interattivo

```bash
# File: ml-training/notebooks/RF_DETR_to_ONNX_Conversion_Colab.ipynb
```

**Features:**
- ✅ Upload modello .pt direttamente
- ✅ Rilevamento automatico model size
- ✅ Installazione dipendenze one-click
- ✅ Test ONNX integrato
- ✅ Download automatico risultato

### Quick Start su Colab

1. Apri il notebook su Google Colab
2. Esegui cella installazione dipendenze
3. Upload del file `.pt`
4. Esegui conversione (auto-detect)
5. Download del file `.onnx`

**Link:** [Apri in Colab](https://colab.research.google.com/) (upload il .ipynb file)

---

## Troubleshooting

### ❌ Errore: `torch.export` fails

**Causa**: PyTorch 2.9+ usa nuovo dynamo exporter di default

**Soluzione**:
```python
torch.onnx.export(..., dynamo=False)  # ✅ Usa legacy exporter
```

Già incluso in entrambi i metodi.

---

### ❌ Errore: Position embeddings size mismatch

**Causa**: Model class sbagliato per la resolution del training

**Esempio Errore**:
```
RuntimeError: The size of tensor a (40) must match the size of tensor b (35)
```

**Soluzione**:

1. **Verifica resolution nel checkpoint**:
   ```python
   import torch
   ckpt = torch.load('model.pt', weights_only=False)
   print(ckpt['args'].resolution)  # Es. 640
   ```

2. **Metodo Semplice**: Usa `--resolution` override
   ```bash
   python convert_advanced.py --checkpoint model.pt --method simple --resolution 640
   ```

3. **Metodo Avanzato**: Specifica resolution corretta
   ```bash
   python convert_advanced.py --checkpoint model.pt --method advanced \
       --num-classes 60 --resolution 640
   ```

---

### ❌ Errore: MPS tensor allocation (Mac M-series)

**Causa**: Metal Performance Shaders (GPU Apple Silicon) incompatibile

**Soluzione**:
```python
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'
inner_model = inner_model.cpu()  # Forza CPU
```

Già incluso in entrambi i metodi.

---

### ❌ Errore: `antialias` parameter not supported

**Causa**: Vecchie versioni rfdetr (< 1.0.0)

**Soluzione**: Upgrade a rfdetr 1.3.0
```bash
pip install --upgrade rfdetr==1.3.0
```

Oppure patch manuale in `site-packages/rfdetr/models/dinov2.py`:
```python
# PRIMA:
patch_pos_embed = F.interpolate(
    ...,
    mode="bicubic",
    antialias=True,  # ❌ Rimuovi
)

# DOPO:
patch_pos_embed = F.interpolate(
    ...,
    mode="bicubic",
    # antialias=True,  ✅ Commentato
)
```

---

### ❌ Errore: No signature found (JIT)

**Causa**: ONNX exporter non trova `forward()` signature nel JIT model

**Soluzione**: Usa JITWrapper (metodo avanzato)
```python
class JITWrapper(nn.Module):
    def __init__(self, traced_model):
        super().__init__()
        self.traced_model = traced_model

    def forward(self, x):  # ✅ Signature esplicita
        return self.traced_model(x)
```

Già implementato in `convert_advanced.py --method advanced`.

---

### ❌ Modello ONNX troppo grande

**File > 500 MB**

**Cause possibili**:
- Modello non semplificato
- Costanti duplicate
- Precision inutile

**Soluzioni**:

1. **Semplificazione**:
   ```bash
   # Metodo semplice: già inclusa
   python export.py --checkpoint model.pt

   # Metodo avanzato: aggiungi onnxsim manualmente
   pip install onnxsim
   python -m onnxsim model.onnx model_simplified.onnx
   ```

2. **Quantizzazione** (advanced):
   ```python
   from onnxruntime.quantization import quantize_dynamic

   quantize_dynamic(
       'model.onnx',
       'model_quantized.onnx',
       weight_type=QuantType.QUInt8
   )
   ```
   Riduce dimensione ~4x con perdita minima di accuracy.

---

## Post-Processing

Il modello ONNX produce output RAW che richiede post-processing.

### Output Format

**Metodo Semplice:**
- `boxes`: `[1, 300, 4]` - Coordinate normalizzate (x1, y1, x2, y2)
- `scores`: `[1, 300, num_classes]` - Logits (NON probabilità)

**Metodo Avanzato:**
- `pred_boxes`: `[batch, 300, 4]`
- `pred_logits`: `[batch, 300, num_classes]`

### Pipeline di Post-Processing

```python
import numpy as np
import cv2

def postprocess_rfdetr(boxes, scores, conf_threshold=0.5, iou_threshold=0.5):
    """
    Post-processing per output RF-DETR ONNX

    Args:
        boxes: np.array [batch, 300, 4] - Boxes normalizzate
        scores: np.array [batch, 300, num_classes] - Logits
        conf_threshold: float - Soglia confidence (default 0.5)
        iou_threshold: float - Soglia NMS (default 0.5)

    Returns:
        filtered_boxes: np.array [N, 4] - Boxes filtrate
        filtered_scores: np.array [N] - Confidence scores
        filtered_classes: np.array [N] - Class IDs
    """
    # 1. Softmax per ottenere probabilità
    # scores shape: [1, 300, num_classes]
    exp_scores = np.exp(scores)
    probs = exp_scores / exp_scores.sum(axis=-1, keepdims=True)

    # 2. Best class per ogni detection
    # shape: [1, 300]
    class_ids = probs.argmax(axis=-1)
    confidences = probs.max(axis=-1)

    # 3. Squeeze batch dimension
    boxes = boxes.squeeze(0)  # [300, 4]
    confidences = confidences.squeeze(0)  # [300]
    class_ids = class_ids.squeeze(0)  # [300]

    # 4. Filter by confidence threshold
    mask = confidences > conf_threshold
    filtered_boxes = boxes[mask]
    filtered_scores = confidences[mask]
    filtered_classes = class_ids[mask]

    # 5. Converti coordinate normalizzate → pixel
    # (se necessario, moltiplicare per img_width, img_height)

    # 6. NMS (Non-Maximum Suppression)
    if len(filtered_boxes) > 0:
        # OpenCV NMS richiede formato [x, y, w, h]
        x1, y1, x2, y2 = filtered_boxes.T
        w = x2 - x1
        h = y2 - y1
        boxes_xywh = np.stack([x1, y1, w, h], axis=1)

        # NMS
        indices = cv2.dnn.NMSBoxes(
            boxes_xywh.tolist(),
            filtered_scores.tolist(),
            conf_threshold,
            iou_threshold
        )

        if len(indices) > 0:
            indices = indices.flatten()
            filtered_boxes = filtered_boxes[indices]
            filtered_scores = filtered_scores[indices]
            filtered_classes = filtered_classes[indices]

    return filtered_boxes, filtered_scores, filtered_classes


# ============================================
# ESEMPIO COMPLETO: Inferenza + Post-Processing
# ============================================

import onnxruntime as ort
from PIL import Image

def run_inference(onnx_path, image_path, img_size=512):
    """
    Esegui inferenza completa: preprocessing → ONNX → postprocessing

    Args:
        onnx_path: Path al modello .onnx
        image_path: Path all'immagine
        img_size: Resolution del modello (512, 640, etc.)

    Returns:
        boxes, scores, classes: Detections filtrate
    """
    # 1. Load ONNX model
    session = ort.InferenceSession(onnx_path)
    input_name = session.get_inputs()[0].name

    # 2. Preprocessing
    img = Image.open(image_path).convert('RGB')
    original_size = img.size  # (width, height)

    # Resize preservando aspect ratio
    img = img.resize((img_size, img_size))

    # Converti a numpy e normalizza
    img_array = np.array(img).astype(np.float32) / 255.0

    # Transpose HWC → CHW
    img_array = img_array.transpose(2, 0, 1)

    # Add batch dimension
    img_array = np.expand_dims(img_array, 0)

    # 3. ONNX Inference
    outputs = session.run(None, {input_name: img_array})
    boxes_raw = outputs[0]  # [1, 300, 4]
    scores_raw = outputs[1]  # [1, 300, num_classes]

    # 4. Post-processing
    boxes, scores, classes = postprocess_rfdetr(
        boxes_raw,
        scores_raw,
        conf_threshold=0.5,
        iou_threshold=0.5
    )

    # 5. Denormalizza coordinate (0-1 → pixel)
    boxes[:, [0, 2]] *= original_size[0]  # x1, x2
    boxes[:, [1, 3]] *= original_size[1]  # y1, y2

    return boxes, scores, classes


# Uso:
boxes, scores, classes = run_inference('model.onnx', 'test_image.jpg')
print(f"Trovate {len(boxes)} detections")
```

### Visualizzazione Risultati

```python
import cv2

def draw_detections(image_path, boxes, scores, classes, class_names):
    """
    Disegna bounding boxes sull'immagine

    Args:
        image_path: Path immagine
        boxes: np.array [N, 4] - (x1, y1, x2, y2) in pixel
        scores: np.array [N] - Confidence scores
        classes: np.array [N] - Class IDs
        class_names: list[str] - Nomi delle classi
    """
    img = cv2.imread(image_path)

    for box, score, cls_id in zip(boxes, scores, classes):
        x1, y1, x2, y2 = box.astype(int)

        # Colore random per classe
        color = tuple(np.random.randint(0, 255, 3).tolist())

        # Draw box
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

        # Draw label
        label = f"{class_names[int(cls_id)]}: {score:.2f}"
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(img, (x1, y1 - h - 5), (x1 + w, y1), color, -1)
        cv2.putText(img, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    return img

# Uso:
class_names = ['SF-25', 'MCL39', 'RB21', ...]  # Le tue classi
result_img = draw_detections('test.jpg', boxes, scores, classes, class_names)
cv2.imwrite('result.jpg', result_img)
```

---

## Checklist Finale

Prima di usare il modello in produzione:

- [ ] ✅ Modello ONNX creato senza errori
- [ ] ✅ `onnx.checker.check_model()` passato
- [ ] ✅ Semplificazione applicata (se metodo semplice)
- [ ] ✅ File size ragionevole (< 200 MB tipicamente)
- [ ] ✅ Checksum SHA256 calcolato
- [ ] ✅ Test inferenza con onnxruntime funziona
- [ ] ✅ Post-processing applicato e testato
- [ ] ✅ Visualizzazione detections corretta
- [ ] ✅ Accuracy simile al modello PyTorch originale
- [ ] ✅ Documentata resolution e num_classes usate

---

## Risorse

### Repository

- **RF-DETR Originale**: https://github.com/roboflow/rf-detr
- **ONNX Converter Base**: https://github.com/PierreMarieCurie/rf-detr-onnx

### Documentazione

- **PyTorch ONNX Export**: https://pytorch.org/docs/stable/onnx.html
- **ONNX Runtime**: https://onnxruntime.ai/docs/
- **ONNX Simplifier**: https://github.com/daquexian/onnx-simplifier

### Training

- **Roboflow**: https://roboflow.com/
- **RF-DETR Training**: https://docs.roboflow.com/

---

**Autore**: RaceTagger Team
**Ultimo aggiornamento**: 2026-01-18
**Versioni Testate**:
- PyTorch: 2.8.0
- ONNX: 1.19.0
- onnxsim: 0.4.36
- rfdetr: 1.3.0
