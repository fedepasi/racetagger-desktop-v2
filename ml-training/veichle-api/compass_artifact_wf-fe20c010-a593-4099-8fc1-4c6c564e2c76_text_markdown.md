# Building a Vehicle ReID System for Motorsport Photography

No JavaScript equivalent to face-api.js exists for vehicles, but a **production-ready solution is achievable** using ONNX Runtime with pre-trained FastReID or OSNet models, integrated into Electron via a local Python microservice. With 2-3 reference images per vehicle using embedding averaging, expect **70-85% accuracy** on motorsport images after domain adaptation—sufficient for the RaceTagger use case.

The critical insight: vehicle re-identification fundamentally differs from face recognition because vehicles lack stable biometric landmarks and change appearance dramatically with viewpoint. However, racing liveries, numbers, and sponsor decals actually make motorsport vehicles **easier** to re-identify than generic traffic vehicles, provided your model learns to focus on these distinctive elements.

## Vehicle ReID differs fundamentally from face recognition

Face recognition benefits from consistent biological landmarks—eyes, nose, mouth—at predictable locations regardless of viewing angle. Vehicles have no such universal anchor points. A Ferrari 488 GT3 from the front, side, and rear presents three nearly unrelated visual signatures, making viewpoint-invariant matching significantly harder.

The core challenge is **high intra-class variability with low inter-class variability**: the same car looks different from every angle, while different cars of the same model look nearly identical. Standard vehicle ReID benchmarks like VeRi-776 achieve **85% mAP** using sophisticated multi-branch architectures combining global features with local part-based features (lights, grille, wheels). State-of-the-art models like TransReID use Vision Transformers with side-information embedding to encode camera viewpoint, achieving **97%+ Rank-1 accuracy** on urban surveillance data.

For motorsport, you have advantages most vehicle ReID systems don't: distinctive liveries, large sponsor decals, and highly visible racing numbers. These provide strong visual anchors that general vehicle ReID models aren't optimized for, but can learn through fine-tuning.

## The recommended architecture: ONNX Runtime with FastReID

The most practical path for a solo developer building an Electron app combines:

- **Detection**: YOLOv8 via ONNX to crop vehicles from photos
- **Embedding extraction**: FastReID or OSNet model exported to ONNX
- **Similarity search**: FAISS-node for efficient vector matching
- **Integration**: Local FastAPI server bundled with PyInstaller

**FastReID** (4.4k+ GitHub stars) explicitly supports vehicle re-identification with pre-trained models on VeRi-776. It includes ONNX/TensorRT export tools in `/tools/deploy` and achieves state-of-the-art results. The simpler **OSNet** from torchreid offers lightweight models (~17MB) suitable for real-time inference at ~50-100ms per image.

The embedding pipeline produces **512-2048 dimensional vectors** (compared to face-api.js's 128 dimensions). For your few-shot scenario, extract embeddings from your 2-3 reference images, compute their mean, normalize it, and use cosine similarity with a threshold of **0.6-0.7** for matching:

```python
# Few-shot matching with embedding averaging
prototype = np.mean([model.extract(ref1), model.extract(ref2), model.extract(ref3)], axis=0)
prototype = prototype / np.linalg.norm(prototype)

# Query matching
query_emb = model.extract(query_image) / np.linalg.norm(model.extract(query_image))
similarity = np.dot(query_emb, prototype)  # Cosine similarity
is_match = similarity > 0.65
```

This approach mirrors exactly how face-api.js works—research confirms that embedding averaging is "unreasonably effective" for prototype-based matching.

## JavaScript options exist but require custom integration

No "vehicle-api.js" library exists, but you can build equivalent functionality using **onnxruntime-node** (npm package) which works excellently with Electron v15+ and supports CUDA acceleration on Linux. The conversion path:

1. Train or download FastReID/OSNet PyTorch model
2. Export to ONNX using `torch.onnx.export()` with opset version 11-12
3. Optionally quantize to INT8 for 2-4x speedup
4. Load in Node.js via onnxruntime-node

```javascript
const ort = require('onnxruntime-node');
const session = await ort.InferenceSession.create('vehicle_reid.onnx');

async function extractEmbedding(imageTensor) {
  const feeds = { input: new ort.Tensor('float32', imageTensor, [1, 3, 256, 128]) };
  const results = await session.run(feeds);
  return results.output.data;  // 512-dim embedding
}
```

**Transformers.js** (`@xenova/transformers`) provides another option using ONNX Runtime as its backend, with pre-built feature extraction pipelines. However, no vehicle-specific models are available—you'd need to host your own converted model.

For Electron integration, run inference in the **main process** with `tfjs-node-gpu` or `onnxruntime-node` for best performance, communicating with the renderer via IPC. Use **sharp** (npm) for fast image preprocessing (resize to 256×128, normalize).

## Python backend via local server is the pragmatic choice

The most reliable integration path uses a **local FastAPI server bundled with PyInstaller**:

```
electron-app/
├── main.js           # Spawns Python server on startup
├── renderer.js       # Calls localhost:5000 endpoints
└── backend/
    ├── server.py     # FastAPI with /extract and /match endpoints
    ├── inference.py  # ONNX Runtime model loading
    └── model/
        └── vehicle_reid.onnx
```

The Python server handles all ML inference while Electron manages the UI. Bundle with PyInstaller (`pyinstaller --onefile server.py`) and include in electron-builder's `extraResources`. This approach avoids complex native Node.js addon compilation issues and leverages the mature PyTorch ecosystem.

Key Python dependencies: `fastapi`, `uvicorn`, `onnxruntime` (or `onnxruntime-gpu`), `numpy`, `opencv-python-headless`, `pillow`. Expected inference time: **50-200ms per image on CPU**, **<50ms with GPU**.

## Datasets and fine-tuning for motorsport accuracy

Pre-trained models on standard benchmarks will underperform on motorsport images—expect **40-60% Rank-1 accuracy** out-of-box due to domain shift (urban surveillance → trackside photography). To reach your 85% target, you need domain adaptation.

Available datasets for initial training:

| Dataset | Images | Vehicles | Notes |
|---------|--------|----------|-------|
| **VeRi-776** | 50,000 | 776 | Best starting point; email xinchenliu@bupt.cn |
| **VERI-Wild** | 416,314 | 40,671 | Largest dataset; challenging conditions |
| **CityFlow** | 313,931 boxes | 880 | Multi-camera tracking; AI City Challenge |
| **VehicleX** | Synthetic | 1,209 | Unity-based; customizable liveries |

**No dedicated motorsport dataset exists.** Your path to 85%+ accuracy:

1. Start with VeRi-776 pre-trained weights
2. Collect **100-500 unlabeled motorsport images** from your target events
3. Apply **pseudo-label clustering**: cluster unlabeled images, assign pseudo-IDs, fine-tune
4. Optionally use **CycleGAN** to transfer VeRi-776 images to motorsport visual style

For few-shot fine-tuning, **triplet loss works with as few as 2 images per identity**. Racing numbers visible in images could be detected via OCR as an auxiliary signal to bootstrap training labels.

## Implementation roadmap for solo developer

**Phase 1: MVP Detection + Cloud Fallback (3-5 days)**
- Integrate YOLOv8 (ONNX) for vehicle detection
- Use Sighthound API ($49/month) for make/model/color as baseline
- Implement basic bounding box cropping pipeline

**Phase 2: Local ReID Embeddings (5-7 days)**
- Download FastReID VeRi-776 pre-trained model
- Export to ONNX, verify inference works
- Build FastAPI server with `/extract_embedding` endpoint
- Implement embedding averaging for reference images

**Phase 3: Similarity Search + Matching (3-4 days)**
- Integrate `faiss-node` for vector storage
- Implement threshold-based matching (start at 0.65 cosine similarity)
- Add k-reciprocal re-ranking for **10-15% mAP improvement**

**Phase 4: Domain Adaptation (5-7 days, optional for 85%+)**
- Collect unlabeled motorsport images
- Implement pseudo-label clustering workflow
- Fine-tune model on motorsport domain

**Total estimated time: 2-4 weeks for production-ready MVP**

## Cloud API alternatives as fallback

If local inference proves too complex or slow:

- **Sighthound Cloud** ($49/month): 95%+ accuracy on make/model/color for vehicles since 1990; returns bounding boxes and attributes; best commercial option
- **Plate Recognizer** ($50-75/month): License plate + make/model/color; useful if plates visible
- **AWS Rekognition Custom Labels**: Train your own vehicle classifier; $4/hour training + inference
- **Roboflow**: Host custom YOLO models with API access; free tier available

For motorsport where you're distinguishing between identical chassis (multiple Ferrari 488s), commercial APIs focusing on make/model won't help—you need the embedding-based approach for same-model differentiation.

## Key technical decisions summarized

| Component | Recommendation | Alternative |
|-----------|---------------|-------------|
| Embedding model | FastReID (ResNet50-IBN) | OSNet-AIN-x1.0 (lighter) |
| Runtime | ONNX Runtime (onnxruntime-node) | TensorFlow.js (tfjs-node-gpu) |
| Embedding dimension | 512 | 2048 (higher accuracy, slower) |
| Input size | 256×128 pixels | 384×128 (wider vehicles) |
| Similarity metric | Cosine similarity | Euclidean on normalized embeddings |
| Match threshold | 0.65 (tune on validation) | 0.6-0.8 range |
| Vector storage | FAISS-node | LanceDB, SQLite with vec extension |
| Electron integration | Local FastAPI + PyInstaller | Direct ONNX Runtime Node |

The face-api.js pattern—pre-trained embedding extractor + few-shot prototype matching—transfers directly to vehicles with adjusted thresholds and larger embeddings. Your motorsport use case with distinctive liveries is actually more tractable than general vehicle ReID; the main work is bridging the domain gap from urban surveillance training data to trackside racing photography.