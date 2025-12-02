# Vehicle-API: MVP per Riconoscimento Veicoli

Sistema di riconoscimento veicoli simile a face-api.js, basato su embedding vettoriali 512D.

## Funzionalità

### 1. Vehicle ReID (Re-Identificazione)
- Embedding 512D per tracking stesso veicolo
- Same-event tracking (stessa auto in foto diverse)
- Cross-event recognition (auto già catalogate)
- Ottimizzato per veicoli con livree distintive (F1, GT3, MotoGP)

### 2. Make/Model/Anno Classification
- Classificazione marca (Ferrari, Porsche, BMW...)
- Classificazione modello (488 GTB, 911 GT3 RS...)
- Stima anno/generazione (2019-2023, 992...)
- Ideale per track day e foto stradali

## Quick Start

### 1. Setup Ambiente
```bash
cd ml-training/vehicle-api
python -m venv venv
source venv/bin/activate  # Linux/Mac
# oppure: venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

### 2. Download Modelli Pre-trained
```bash
python scripts/01-download-models.py
```

### 3. Test Inference
```bash
# Test singola immagine
python demo/cli.py --image path/to/car.jpg --mode reid

# Test Make/Model
python demo/cli.py --image path/to/car.jpg --mode makemodel
```

### 4. Avvia API Server
```bash
python demo/api_server.py
# API disponibile su http://localhost:8000
```

### 5. Web Demo
Apri `demo/web_demo/index.html` nel browser.

## Struttura Progetto

```
vehicle-api/
├── scripts/                    # Training & inference
│   ├── 01-download-models.py   # Scarica pesi pre-trained
│   ├── 02-prepare-dataset.py   # Prepara dataset
│   ├── 03-train-reid.py        # Training ReID
│   ├── 04-train-makemodel.py   # Training Make/Model
│   ├── 05-export-onnx.py       # Export ONNX
│   └── 06-test-inference.py    # Test standalone
├── demo/
│   ├── cli.py                  # CLI tool
│   ├── api_server.py           # FastAPI server
│   └── web_demo/               # Mini webapp
├── models/                     # Modelli trained
│   ├── vehicle_reid.onnx
│   ├── vehicle_makemodel.onnx
│   └── class_labels.json
├── configs/                    # Configurazioni
│   ├── reid_config.json
│   └── makemodel_config.json
├── datasets/                   # Dataset (gitignored)
└── tests/                      # Test suite
```

## Modelli

### Vehicle ReID
- **Backbone**: ResNet50-IBN (FastReID)
- **Pre-trained**: VeRi-776 dataset
- **Embedding**: 512 dimensioni
- **Input**: 256x128 pixels
- **ONNX size**: ~95MB

### Make/Model Classifier
- **Backbone**: EfficientNet-B4
- **Dataset**: VMMRdb + custom
- **Output**: Multi-head (marca, modello, anno)
- **Input**: 224x224 pixels
- **ONNX size**: ~50-100MB

## API Endpoints

### POST /extract
Estrae embedding da un'immagine.
```json
{
  "image": "base64_encoded_image",
  "mode": "reid"
}
```

### POST /match
Confronta embedding con galleria.
```json
{
  "embedding": [0.1, 0.2, ...],
  "threshold": 0.65
}
```

### POST /classify
Classifica marca/modello/anno.
```json
{
  "image": "base64_encoded_image"
}
```

### POST /enroll
Aggiunge veicolo alla galleria.
```json
{
  "vehicle_id": "ferrari_488_01",
  "images": ["base64_img1", "base64_img2"],
  "metadata": {"team": "AF Corse", "driver": "..."}
}
```

## Accuracy Attesa

| Scenario | Vehicle ReID | Make/Model |
|----------|-------------|------------|
| Out-of-box | 40-60% | 70-80% |
| Fine-tuned | 70-85% | 85-95% |
| Motorsport-optimized | 85%+ | N/A |

## Training Custom

### 1. Prepara Dataset
Organizza le immagini:
```
datasets/
├── motorsport/
│   ├── vehicle_001/
│   │   ├── img1.jpg
│   │   ├── img2.jpg
│   │   └── ...
│   ├── vehicle_002/
│   └── ...
```

### 2. Prepara Dataset
```bash
python scripts/02-prepare-dataset.py --input datasets/motorsport --output datasets/prepared
```

### 3. Training
```bash
# Vehicle ReID
python scripts/03-train-reid.py --config configs/reid_config.json

# Make/Model
python scripts/04-train-makemodel.py --config configs/makemodel_config.json
```

### 4. Export ONNX
```bash
python scripts/05-export-onnx.py --model models/best_reid.pth --output models/vehicle_reid.onnx
```

## Integrazione RaceTagger

Quando il MVP è validato, i modelli ONNX possono essere integrati in RaceTagger:
1. Copia `models/*.onnx` in `src/assets/models/vehicle-api/`
2. Implementa TypeScript wrapper seguendo pattern di `scene-classifier-onnx.ts`
3. Aggiungi IPC handlers in `main.ts`

## Dipendenze

Vedi `requirements.txt` per la lista completa.

Principali:
- PyTorch >= 2.0
- ONNX Runtime >= 1.16
- FastAPI >= 0.100
- OpenCV >= 4.8
- timm >= 0.9

## License

Parte del progetto RaceTagger.
