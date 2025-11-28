# Sistema di Vehicle Recognition: architettura tecnica completa

Un sistema di riconoscimento veicoli basato su embedding vettoriali è tecnicamente fattibile e può raggiungere **93% mAP** utilizzando approcci moderni. L'architettura face-api.js è direttamente trasferibile ai veicoli, con modifiche al backbone e all'addestramento. Per un'implementazione JavaScript/Electron, **ONNX Runtime Web con WebGPU** offre prestazioni fino all'80% del codice nativo, rendendo possibile l'inference client-side per modelli fino a ~20MB.

La sfida principale non è la detection (risolta con YOLO/SSD), ma la **re-identification**: generare embedding discriminativi da 1-3 immagini che distinguano veicoli identici per modello ma diversi per livrea, danni, o dettagli. Il paradigma face-api.js (detect → align → embed → match) funziona, ma i veicoli richiedono embedding di **512 dimensioni** (vs 128 per i volti) e loss functions specifiche come **ArcFace + Triplet Loss** per gestire l'alta similarità inter-classe.

---

## Come funziona face-api.js: il modello da replicare

Face-api.js implementa un pipeline di riconoscimento che rappresenta il gold standard per sistemi few-shot. L'architettura si compone di tre moduli separati: detection, landmark extraction (opzionale per veicoli), ed embedding generation.

Il **modello di detection** utilizza SSD MobileNetV1 (~5.4MB quantizzato) addestrato su WIDERFACE, con un'alternativa leggera TinyFaceDetector (~190KB) basata su Tiny YOLO V2 con convoluzioni depthwise separabili. Per i veicoli, questa componente è direttamente sostituibile con **YOLOv8-nano** (~6MB) o EfficientDet-Lite0.

Il cuore del sistema è il **FaceRecognitionNet**, un ResNet-34 modificato con 29 layer convoluzionali che produce embedding a **128 dimensioni**. Il modello raggiunge 99.38% di accuracy su LFW (Labeled Faces in the Wild) ed è stato addestrato su ~3 milioni di immagini usando metric learning. I pesi originali provengono dalla libreria dlib di Davis King.

Il **matching** avviene tramite distanza euclidea con threshold di **0.6** di default. La classe `FaceMatcher` memorizza `LabeledFaceDescriptors` (array di embedding per ogni identità) e calcola la media delle distanze quando sono disponibili multiple immagini di riferimento:

```javascript
// Pattern face-api.js per few-shot recognition
const labeledDescriptors = [
  new faceapi.LabeledFaceDescriptors('vehicle_001', [embedding1, embedding2]),
  new faceapi.LabeledFaceDescriptors('vehicle_002', [embedding3])
];
const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
const match = matcher.findBestMatch(queryEmbedding);
```

---

## State-of-the-art nel Vehicle Re-Identification

Il campo VeRi ha visto progressi significativi dal 2020, con i modelli basati su **Vision Transformer** che dominano le benchmark. Il dataset di riferimento è **VeRi-776** (50,000 immagini, 776 veicoli, 20 telecamere), ma per scenari reali **VERI-Wild** (416,314 immagini, 40,671 veicoli, condizioni non controllate) rappresenta il test più rigoroso.

I risultati SOTA attuali su VeRi-776:

| Metodo | mAP | Rank-1 | Note |
|--------|-----|--------|------|
| **CLIP-SENet** (2024) | 92.9% | 98.7% | Sfrutta CLIP per feature semantiche |
| TransReID (ICCV 2021) | ~84% | ~96.8% | Pure ViT con Side Information Embedding |
| FastReID baseline | ~80% | ~96% | ResNet-50 + triplet loss |

**TransReID** introduce due innovazioni chiave: il **Jigsaw Patch Module (JPM)** che ricostruisce patch mescolate per imparare feature strutturali, e il **Side Information Embedding (SIE)** che codifica viewpoint e posizione della camera. Per veicoli da competizione con livree distintive, questo approccio è particolarmente efficace.

Le sfide specifiche dei veicoli rispetto ai volti includono la **variazione drastica di viewpoint** (frontale vs laterale vs posteriore), l'**alta similarità inter-classe** (due Ferrari 488 rosse sono quasi identiche senza livrea), e la **variabilità intra-classe** per veicoli da competizione (stessa auto con sponsor diversi tra gare).

Le implementazioni open-source più mature sono **FastReID** (JDAI-CV, supporta VeRi-776 con pre-trained weights) e **torchreid** (per transfer learning da person ReID). Repository chiave: `github.com/JDAI-CV/fast-reid`.

---

## Architettura embedding per veicoli: dalla teoria all'implementazione

La generazione di embedding discriminativi richiede una combinazione di **backbone potente** e **loss function appropriata**. Per veicoli, la configurazione ottimale usa embedding a **512 dimensioni** (non 128 come face-api.js) per catturare la maggiore complessità visiva.

### Backbone recommendations

Per inference JavaScript: **EfficientNet-B0/B4** offre il miglior rapporto accuracy/dimensione. Per massima accuratezza con backend Python: **ResNet-50 con IBN** (Instance-Batch Normalization) o **Swin Transformer**.

Il pooling finale è critico: **Generalized Mean Pooling (GeM)** con parametro trainable p≈3 supera Global Average Pooling di 2-3 punti mAP nei retrieval task:

```python
class GeM(nn.Module):
    def __init__(self, p=3, eps=1e-6):
        self.p = nn.Parameter(torch.ones(1) * p)
    def forward(self, x):
        return F.avg_pool2d(x.clamp(min=1e-6).pow(self.p), 
                           (x.size(-2), x.size(-1))).pow(1./self.p)
```

### Loss function strategy

La combinazione **50% Triplet Loss + 50% ArcFace** produce i migliori risultati per few-shot scenarios:

- **Triplet Loss** (margin 0.3) impara relazioni relative: "questo veicolo è più simile a X che a Y"
- **ArcFace** (scale s=30, margin m=0.5) impone separazione angolare nello spazio embedding

ArcFace è particolarmente efficace per veicoli perché penalizza la cosine similarity piuttosto che la distanza euclidea, rendendo gli embedding più robusti a variazioni di illuminazione:

```python
class ArcFaceLoss(nn.Module):
    def forward(self, embeddings, labels):
        embeddings = F.normalize(embeddings)
        cos_theta = embeddings @ F.normalize(self.W, dim=0)
        theta = torch.acos(cos_theta.clamp(-1+1e-7, 1-1e-7))
        target_logits = torch.cos(theta + self.margin)
        return F.cross_entropy(self.scale * target_logits, labels)
```

---

## Few-shot learning: lavorare con 1-3 immagini di riferimento

Con solo 1-3 immagini per veicolo, ogni singolo embedding deve essere massimamente informativo. Le strategie chiave sono:

**Test-Time Augmentation (TTA)**: per ogni immagine di riferimento, genera embedding multipli applicando augmentation deterministiche (horizontal flip, crop centrale), poi media. Questo simula multiple viste senza richiedere immagini aggiuntive:

```javascript
function ttaEmbedding(model, image) {
  const embeddings = [
    model.predict(image),                    // originale
    model.predict(horizontalFlip(image)),   // flip
    model.predict(centerCrop(image, 0.9))   // crop
  ];
  return normalize(mean(embeddings));
}
```

**Aggregazione multi-immagine**: con 2-3 riferimenti, la media L2-normalizzata degli embedding crea un "prototipo" robusto. Se le immagini mostrano viewpoint diversi (frontale + laterale), questo cattura feature complementari.

**Matching strategy**: per 1 immagine usa cosine similarity diretta; per 2-3 immagini, il **max-similarity** (match con l'embedding più simile) funziona meglio del prototype averaging quando i viewpoint sono molto diversi.

Le **Siamese Networks** rimangono rilevanti per enrollment di nuovi veicoli: invece di retraining, una siamese pre-trained può validare se due immagini appartengono allo stesso veicolo con una semplice forward pass.

---

## Librerie JavaScript: TensorFlow.js vs ONNX Runtime Web

Per un'applicazione Electron, due opzioni dominano il panorama 2025:

**ONNX Runtime Web** (raccomandato) offre il backend **WebGPU** con speedup **20x vs WASM multi-thread** e raggiunge ~80% delle performance native. Supporta tutti gli operatori ONNX, semplifica il porting da PyTorch (export diretto), e permette fallback WASM per browser più vecchi:

```javascript
import * as ort from 'onnxruntime-web/webgpu';
const session = await ort.InferenceSession.create('vehicle_reid.onnx', {
  executionProviders: ['webgpu', 'wasm'] // fallback automatico
});
```

**TensorFlow.js** ha un ecosistema più maturo con più esempi per Electron (official tfjs-examples/electron repo). In Node.js main process, `@tensorflow/tfjs-node-gpu` usa binding nativi CUDA raggiungendo performance quasi-native. Il converter supporta Keras/TF SavedModel → tfjs con quantizzazione integrata.

**Performance comparison** (ResNet-50 inference):

| Backend | Tempo inference | Note |
|---------|-----------------|------|
| Python GPU (TensorRT) | 5-10ms | Gold standard |
| Node.js tfjs-node-gpu | 15-25ms | ~2x slower |
| Browser WebGPU | 40-80ms | ~5-10x slower |
| Browser WebGL | 50-100ms | Fallback maturo |
| Browser WASM | 200-400ms | Ultimo resort |

**Transformers.js** (Hugging Face) è un'opzione emergente che wrappa ONNX Runtime con API ad alto livello, ideale per prototipazione rapida.

---

## Architettura raccomandata per Electron

Per un'applicazione desktop, l'architettura ottimale separa detection veloce (renderer process) da embedding pesante (main process), con storage locale degli embedding:

```
┌─────────────────────────────────────────────────────────────┐
│                     ELECTRON APP                            │
├─────────────────────────────────────────────────────────────┤
│  RENDERER PROCESS          │    MAIN PROCESS               │
│  ┌─────────────────────┐   │    ┌─────────────────────────┐│
│  │ Video/Image Input   │   │    │ Vehicle Recognition     ││
│  │ + Quick Detection   │◄─IPC──►│ ┌─────────┐ ┌─────────┐ ││
│  │ (TinyYOLO ~6ms)     │   │    │ │YOLOv8-n │→│ResNet50 │ ││
│  └─────────────────────┘   │    │ │Detector │ │Embedder │ ││
│           │                │    │ └─────────┘ └─────────┘ ││
│  ┌─────────────────────┐   │    └─────────────────────────┘│
│  │ Results UI          │   │    ┌─────────────────────────┐│
│  │ + Gallery Browser   │   │    │ Vehicle Gallery         ││
│  └─────────────────────┘   │    │ IndexedDB (vectors)     ││
│                            │    │ + JSON metadata         ││
└─────────────────────────────────────────────────────────────┘
```

**Storage**: IndexedDB con librerie come `idb-vector` permette ricerca per similarità coseno direttamente nel browser. Per gallery fino a ~10,000 veicoli, la ricerca brute-force è sufficientemente veloce (<10ms).

**API design** per enrollment e recognition:

```javascript
// Enrollment: 1-3 immagini → embedding aggregato
async function enrollVehicle(vehicleId, images) {
  const embeddings = await Promise.all(
    images.map(img => extractEmbedding(img))
  );
  const aggregated = normalizeL2(mean(embeddings));
  await vehicleDB.insert({ id: vehicleId, embedding: aggregated });
}

// Recognition: immagine → best match
async function recognizeVehicle(image, threshold = 0.7) {
  const queryEmb = await extractEmbedding(image);
  const matches = await vehicleDB.query(queryEmb, { limit: 5 });
  return matches.filter(m => m.similarity > threshold);
}
```

---

## Quando serve un backend Python

Il backend diventa necessario per: **training/fine-tuning** (sempre), **batch processing** di migliaia di immagini, **modelli Transformer pesanti** (TransReID, CLIP-based), o quando serve **TensorRT** per massime performance.

**FastAPI** è la scelta standard per inference serving:

```python
@app.post("/recognize")
async def recognize(image: UploadFile):
    detection = detector(image)
    embedding = embedder(detection.crop)
    match = gallery.search(embedding, top_k=1)
    return {"vehicle_id": match.id, "confidence": match.score}
```

Per produzione ad alto throughput, **NVIDIA Triton Inference Server** supporta batching dinamico, model versioning, e instance groups (multiple model copies su GPU). **TorchServe** è più semplice per deployment PyTorch-only.

---

## Pipeline di fine-tuning per veicoli da competizione

Per adattare un modello pre-trained VeRi a veicoli specifici (es. motorsport con livree):

1. **Partire da FastReID** pre-trained su VeRi-776 (ResNet-50 backbone)
2. **Raccogliere 50-200 immagini** dei veicoli target (minimo 5 per veicolo)
3. **Applicare augmentation aggressiva**: color jitter forte (le livree cambiano colore), random erasing (simula occlusioni), multiple scale crops
4. **Fine-tune con ArcFace loss** per 10-20 epochs, learning rate 1e-4 con warmup
5. **Export ONNX** → convertire a TensorFlow.js o usare ONNX Runtime Web

Per veicoli da competizione, l'augmentation deve includere variazioni che simulano cambi di sponsor/livrea tra eventi, altrimenti il modello overfitta sui colori specifici invece che sulla forma strutturale.

---

## Model conversion pipeline

Il flusso completo da PyTorch a browser:

```bash
# 1. PyTorch → ONNX
torch.onnx.export(model, dummy_input, "model.onnx", opset_version=17)

# 2. ONNX optimization (opzionale)
python -m onnxruntime.transformers.optimizer --input model.onnx --output model_opt.onnx

# 3. Per TensorFlow.js: ONNX → TF SavedModel → TFJS
pip install onnx-tf tensorflowjs
onnx-tf convert -i model.onnx -o saved_model/
tensorflowjs_converter --input_format=tf_saved_model \
  --quantize_float16 --weight_shard_size_bytes=4194304 \
  saved_model/ tfjs_model/
```

La **quantizzazione FP16** riduce le dimensioni del 50% con perdita di accuracy trascurabile (<0.5%). Lo sharding a 4MB ottimizza il caching del browser.

---

## Risorse essenziali

**Repository GitHub**:
- `JDAI-CV/fast-reid` — Toolbox SOTA per vehicle ReID con model zoo
- `damo-cv/TransReID` — Implementazione Vision Transformer per ReID
- `justadudewhohacks/face-api.js` — Pattern architetturale di riferimento
- `layumi/Vehicle_reID-Collection` — Collezione curata di paper e codice

**Dataset per training/evaluation**:
- VeRi-776 (standard benchmark)
- VERI-Wild (condizioni reali, 416K immagini)
- CompCars (fine-grained make/model classification)

**Paper fondamentali**:
- TransReID (ICCV 2021) — architettura Transformer per ReID
- ArcFace (CVPR 2019) — loss function per discriminative embeddings
- Deep-Learning Vehicle ReID Survey (arXiv 2401.10643, 2024) — panoramica completa

---

## Conclusione: roadmap implementativa

Per un MVP funzionante in Electron:

1. **Fase 1 (1-2 settimane)**: Integrare YOLOv8-nano per detection + ResNet-50 pre-trained da FastReID per embedding, usando ONNX Runtime Web. Testare con gallery statica di 20-50 veicoli.

2. **Fase 2 (2-3 settimane)**: Implementare enrollment UI, IndexedDB per gallery, e matching con threshold adattivo. Aggiungere TTA per migliorare accuracy few-shot.

3. **Fase 3 (3-4 settimane)**: Fine-tuning su veicoli da competizione specifici. Se le performance JS non sono sufficienti, aggiungere backend FastAPI per inference pesante.

L'accuracy attesa con questo approccio è **85-90% Rank-1** su veicoli con caratteristiche distintive (livree, numeri), scendendo a **70-80%** per veicoli generici senza customizzazione. Per raggiungere il 90%+ su veicoli generici serve training su dataset specifici del dominio.