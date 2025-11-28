# RF-DETR to ONNX Conversion Guide

Guida per convertire modelli RF-DETR trainati su Roboflow in formato ONNX per inferenza locale.

## Requisiti

```bash
# Attiva il virtual environment
source venv-ml/bin/activate

# Installa le dipendenze necessarie
pip install rfdetr onnx onnxsim onnxruntime torch torchvision
```

## Problema Noto: PyTorch 2.9+

PyTorch 2.9+ usa `torch.export` per la conversione ONNX, che **non è compatibile** con RF-DETR.

### Soluzione: Usare il Legacy Exporter

Bisogna usare `dynamo=False` per forzare il legacy TorchScript-based exporter.

## Script di Conversione

```python
#!/usr/bin/env python3
"""
RF-DETR to ONNX Conversion Script
Usa il legacy exporter per compatibilità con PyTorch 2.9+
"""

import os
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'

import torch
import torch.onnx
import onnx
from onnxsim import simplify
from rfdetr.detr import RFDETRSmall, RFDETRBase, RFDETRMedium, RFDETRLarge
import hashlib

# ============================================
# CONFIGURAZIONE - MODIFICA QUESTI VALORI
# ============================================

WEIGHTS_PATH = 'models/RT-F1-2025/RT-F1-2025-V4_weights.pt'
OUTPUT_PATH = 'models/RT-F1-2025/model.onnx'

# Scegli il model size in base alla risoluzione del training:
# - RFDETRSmall: resolution=512
# - RFDETRBase: resolution=560, hidden_dim=256
# - RFDETRMedium: resolution=576
# - RFDETRLarge: resolution=560, hidden_dim=384
MODEL_CLASS = RFDETRSmall
RESOLUTION = 512

# ============================================
# CONVERSIONE
# ============================================

print(f'Loading model from {WEIGHTS_PATH}...')
model = MODEL_CLASS(pretrain_weights=WEIGHTS_PATH)

# Prepara il modello per export
inner_model = model.model.model
inner_model = inner_model.cpu()
inner_model.eval()
inner_model.export()  # Richiesto per fixare positional embeddings

# Crea dummy input
dummy_input = torch.randn(1, 3, RESOLUTION, RESOLUTION)

print(f'Exporting to {OUTPUT_PATH}...')
torch.onnx.export(
    inner_model,
    dummy_input,
    OUTPUT_PATH,
    export_params=True,
    opset_version=17,
    do_constant_folding=True,
    input_names=['input'],
    output_names=['boxes', 'scores'],
    dynamo=False  # IMPORTANTE: Usa legacy exporter
)

# Verifica e semplifica
print('Verifying and simplifying...')
onnx_model = onnx.load(OUTPUT_PATH)
onnx.checker.check_model(onnx_model)

model_simplified, check = simplify(onnx_model)
if check:
    onnx.save(model_simplified, OUTPUT_PATH)
    print('Model simplified!')

# Calcola checksum
with open(OUTPUT_PATH, 'rb') as f:
    checksum = hashlib.sha256(f.read()).hexdigest()

file_size = os.path.getsize(OUTPUT_PATH)
print(f'\n{"="*60}')
print(f'Conversion Complete!')
print(f'{"="*60}')
print(f'File: {OUTPUT_PATH}')
print(f'Size: {file_size / (1024*1024):.1f} MB')
print(f'SHA256: {checksum}')
print(f'{"="*60}')
```

## Mappatura Model Size → Risoluzione

| Model Class | Resolution | Patch Size | Note |
|-------------|------------|------------|------|
| `RFDETRNano` | 384 | 14 | Più veloce, meno accurato |
| `RFDETRSmall` | 512 | 16 | Buon compromesso |
| `RFDETRMedium` | 576 | 14 | |
| `RFDETRBase` | 560 | 14 | hidden_dim=256 |
| `RFDETRLarge` | 560 | 14 | hidden_dim=384 |

## Come Determinare il Model Size dal Checkpoint

```python
import torch

checkpoint = torch.load('path/to/weights.pt', weights_only=False)
args = checkpoint.get('args', None)

if args:
    print(f"Resolution: {args.resolution}")
    print(f"Hidden dim: {getattr(args, 'hidden_dim', 'N/A')}")
    print(f"Patch size: {getattr(args, 'patch_size', 'N/A')}")
```

## Output del Modello ONNX

- **Input**: `[batch, 3, resolution, resolution]` - Immagine RGB normalizzata
- **Output boxes**: `[batch, 300, 4]` - Bounding boxes (x1, y1, x2, y2) normalizzate 0-1
- **Output scores**: `[batch, 300, num_classes]` - Score per ogni classe

## Post-Processing

Dopo l'inferenza ONNX, applica:

1. **Softmax** sugli scores per ottenere probabilità
2. **Argmax** per trovare la classe predetta
3. **Confidence threshold** (es. 0.5) per filtrare detections
4. **NMS** (Non-Maximum Suppression) se ci sono overlap

```python
import numpy as np

def postprocess(boxes, scores, conf_threshold=0.5, iou_threshold=0.5):
    # Softmax
    probs = np.exp(scores) / np.exp(scores).sum(axis=-1, keepdims=True)

    # Best class per detection
    class_ids = probs.argmax(axis=-1)
    confidences = probs.max(axis=-1)

    # Filter by confidence
    mask = confidences > conf_threshold
    filtered_boxes = boxes[mask]
    filtered_scores = confidences[mask]
    filtered_classes = class_ids[mask]

    # Apply NMS (use cv2.dnn.NMSBoxes or torchvision.ops.nms)
    # ...

    return filtered_boxes, filtered_scores, filtered_classes
```

## Troubleshooting

### Errore: `torch.export` fails

**Causa**: PyTorch 2.9+ usa il nuovo dynamo exporter di default.

**Soluzione**: Aggiungi `dynamo=False` a `torch.onnx.export()`.

### Errore: MPS tensor allocation (Mac M-series)

**Causa**: Metal Performance Shaders ha problemi con torch.export.

**Soluzione**: Forza CPU con `inner_model.cpu()` e imposta `PYTORCH_ENABLE_MPS_FALLBACK=1`.

### Errore: Position embeddings size mismatch

**Causa**: Stai usando il model class sbagliato (risoluzione diversa dal training).

**Soluzione**: Verifica la risoluzione nel checkpoint e usa il model class corretto.

### Errore: `antialias` parameter not supported

**Causa**: Vecchie versioni di rfdetr usano `antialias` in bicubic interpolation.

**Soluzione**: Patch i file `dinov2.py` e `dinov2_with_windowed_attn.py` nel package rfdetr:

```python
# Trova e rimuovi antialias=True da F.interpolate():
patch_pos_embed = F.interpolate(
    patch_pos_embed,
    size=(height, width),
    mode="bicubic",
    align_corners=False,
    # antialias=True,  <-- RIMUOVI QUESTA RIGA
)
```

## Upload su Supabase

Dopo la conversione:

1. Vai al Management Portal → Model Manager
2. Seleziona la categoria sport
3. Inserisci versione e note
4. Upload del file `.onnx`
5. Incolla le classi dal training Roboflow
6. Il checksum viene verificato automaticamente

## Esempio Completo: F1 2025

```bash
# Attiva env
source venv-ml/bin/activate

# Converti
python -c "
import os
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'

import torch
import onnx
from onnxsim import simplify
from rfdetr.detr import RFDETRSmall

model = RFDETRSmall(pretrain_weights='models/RT-F1-2025/RT-F1-2025-V4_weights.pt')
inner = model.model.model.cpu()
inner.eval()
inner.export()

torch.onnx.export(
    inner,
    torch.randn(1, 3, 512, 512),
    'models/RT-F1-2025/model.onnx',
    opset_version=17,
    input_names=['input'],
    output_names=['boxes', 'scores'],
    dynamo=False
)

m = onnx.load('models/RT-F1-2025/model.onnx')
onnx.checker.check_model(m)
ms, _ = simplify(m)
onnx.save(ms, 'models/RT-F1-2025/model.onnx')
print('Done!')
"

# Verifica
shasum -a 256 models/RT-F1-2025/model.onnx
```

---

*Ultimo aggiornamento: 2025-11-26*
*Testato con: PyTorch 2.9.1, ONNX 1.17.0, rfdetr 1.0.0*
