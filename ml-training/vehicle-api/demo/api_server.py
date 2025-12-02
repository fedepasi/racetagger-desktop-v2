#!/usr/bin/env python3
"""
Vehicle-API FastAPI Server

REST API for Vehicle ReID and Make/Model classification.

Usage:
    python demo/api_server.py
    python demo/api_server.py --port 8080 --reload

Endpoints:
    POST /api/v1/reid/embedding     - Extract vehicle embedding
    POST /api/v1/reid/compare       - Compare two vehicles
    POST /api/v1/reid/search        - Search in gallery
    POST /api/v1/classify           - Classify make/model/year
    POST /api/v1/batch              - Batch process images
    GET  /api/v1/health             - Health check
    GET  /api/v1/models             - Available models info
"""

import os
import sys
import json
import time
import uuid
import base64
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Union
from io import BytesIO

import numpy as np
from PIL import Image

# FastAPI
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import uvicorn

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Configuration
# ============================================

MODELS_DIR = Path(__file__).parent.parent / "models"
DEFAULT_SIMILARITY_THRESHOLD = 0.65


# ============================================
# Pydantic Models
# ============================================

class EmbeddingResponse(BaseModel):
    embedding: List[float]
    embedding_dim: int
    processing_time_ms: float


class CompareRequest(BaseModel):
    embedding1: List[float]
    embedding2: List[float]


class CompareResponse(BaseModel):
    similarity: float
    is_same_vehicle: bool
    confidence: str  # high, medium, low
    processing_time_ms: float


class ClassifyResponse(BaseModel):
    make: List[Dict]
    model: List[Dict]
    year: List[Dict]
    processing_time_ms: float


class SearchResult(BaseModel):
    filename: str
    similarity: float
    is_match: bool


class SearchResponse(BaseModel):
    query_embedding_dim: int
    gallery_size: int
    matches: List[SearchResult]
    processing_time_ms: float


class BatchResult(BaseModel):
    filename: str
    make: Optional[str]
    make_confidence: Optional[float]
    model: Optional[str]
    model_confidence: Optional[float]
    year: Optional[str]
    embedding_extracted: bool
    error: Optional[str]


class BatchResponse(BaseModel):
    total: int
    successful: int
    failed: int
    results: List[BatchResult]
    processing_time_ms: float


class HealthResponse(BaseModel):
    status: str
    models_loaded: Dict[str, bool]
    version: str


class ModelsResponse(BaseModel):
    reid: Optional[Dict]
    makemodel: Optional[Dict]


# ============================================
# Global Model Instances
# ============================================

reid_model = None
makemodel_model = None


def load_models():
    """Load models on startup."""
    global reid_model, makemodel_model

    try:
        import onnxruntime as ort
    except ImportError:
        print("ERROR: onnxruntime not installed. Run: pip install onnxruntime")
        return

    # Load ReID model
    reid_path = MODELS_DIR / "vehicle_reid.onnx"
    if reid_path.exists():
        try:
            reid_model = {
                "session": ort.InferenceSession(str(reid_path)),
                "input_size": (256, 128),
                "mean": np.array([0.485, 0.456, 0.406]),
                "std": np.array([0.229, 0.224, 0.225])
            }
            print(f"Loaded ReID model: {reid_path}")
        except Exception as e:
            print(f"Failed to load ReID model: {e}")
    else:
        print(f"ReID model not found: {reid_path}")

    # Load Make/Model classifier
    classify_path = MODELS_DIR / "vehicle_makemodel.onnx"
    labels_path = MODELS_DIR / "class_labels.json"

    if classify_path.exists():
        try:
            labels = {}
            if labels_path.exists():
                with open(labels_path) as f:
                    labels = json.load(f)

            makemodel_model = {
                "session": ort.InferenceSession(str(classify_path)),
                "input_size": (224, 224),
                "mean": np.array([0.485, 0.456, 0.406]),
                "std": np.array([0.229, 0.224, 0.225]),
                "idx_to_make": {int(k): v for k, v in labels.get("makes", {}).items()},
                "idx_to_model": {int(k): v for k, v in labels.get("models", {}).items()},
                "idx_to_year": {int(k): v for k, v in labels.get("years", {}).items()}
            }
            print(f"Loaded Make/Model classifier: {classify_path}")
        except Exception as e:
            print(f"Failed to load Make/Model model: {e}")
    else:
        print(f"Make/Model model not found: {classify_path}")


# ============================================
# Image Processing Utils
# ============================================

def load_image_from_upload(file: UploadFile) -> Image.Image:
    """Load image from uploaded file."""
    contents = file.file.read()
    return Image.open(BytesIO(contents)).convert("RGB")


def load_image_from_base64(b64_string: str) -> Image.Image:
    """Load image from base64 string."""
    # Remove data URI prefix if present
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]

    img_data = base64.b64decode(b64_string)
    return Image.open(BytesIO(img_data)).convert("RGB")


def preprocess_image(img: Image.Image, model_config: dict) -> np.ndarray:
    """Preprocess image for model inference."""
    h, w = model_config["input_size"]
    mean = model_config["mean"]
    std = model_config["std"]

    img = img.resize((w, h), Image.BILINEAR)
    arr = np.array(img).astype(np.float32) / 255.0
    arr = (arr - mean) / std
    arr = arr.transpose(2, 0, 1)
    arr = np.expand_dims(arr, 0)

    return arr.astype(np.float32)


def extract_reid_embedding(img: Image.Image) -> np.ndarray:
    """Extract ReID embedding from image."""
    if reid_model is None:
        raise HTTPException(status_code=503, detail="ReID model not loaded")

    input_tensor = preprocess_image(img, reid_model)
    outputs = reid_model["session"].run(None, {"input": input_tensor})
    return outputs[0][0]


def classify_vehicle(img: Image.Image, top_k: int = 5) -> dict:
    """Classify vehicle make/model/year."""
    if makemodel_model is None:
        raise HTTPException(status_code=503, detail="Make/Model model not loaded")

    input_tensor = preprocess_image(img, makemodel_model)
    outputs = makemodel_model["session"].run(None, {"input": input_tensor})

    make_probs = outputs[0][0]
    model_probs = outputs[1][0]
    year_probs = outputs[2][0] if len(outputs) > 2 else None

    def get_top_k(probs, idx_to_label, k):
        top_indices = np.argsort(probs)[-k:][::-1]
        return [
            {"label": idx_to_label.get(int(idx), f"class_{idx}"), "confidence": float(probs[idx])}
            for idx in top_indices
        ]

    return {
        "make": get_top_k(make_probs, makemodel_model["idx_to_make"], top_k),
        "model": get_top_k(model_probs, makemodel_model["idx_to_model"], top_k),
        "year": get_top_k(year_probs, makemodel_model.get("idx_to_year", {}), top_k) if year_probs is not None else []
    }


def compute_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
    """Compute cosine similarity."""
    return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))


# ============================================
# FastAPI App
# ============================================

app = FastAPI(
    title="Vehicle-API",
    description="Vehicle Re-Identification and Make/Model Classification API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Load models on startup."""
    load_models()


# ============================================
# Endpoints
# ============================================

@app.get("/api/v1/health", response_model=HealthResponse)
async def health_check():
    """Check API health and model status."""
    return HealthResponse(
        status="healthy",
        models_loaded={
            "reid": reid_model is not None,
            "makemodel": makemodel_model is not None
        },
        version="1.0.0"
    )


@app.get("/api/v1/models", response_model=ModelsResponse)
async def get_models_info():
    """Get information about loaded models."""
    reid_info = None
    makemodel_info = None

    if reid_model:
        reid_info = {
            "input_size": list(reid_model["input_size"]),
            "embedding_dim": 512,
            "similarity_threshold": DEFAULT_SIMILARITY_THRESHOLD
        }

    if makemodel_model:
        makemodel_info = {
            "input_size": list(makemodel_model["input_size"]),
            "num_makes": len(makemodel_model["idx_to_make"]),
            "num_models": len(makemodel_model["idx_to_model"]),
            "num_years": len(makemodel_model.get("idx_to_year", {}))
        }

    return ModelsResponse(reid=reid_info, makemodel=makemodel_info)


@app.post("/api/v1/reid/embedding", response_model=EmbeddingResponse)
async def extract_embedding(image: UploadFile = File(...)):
    """Extract vehicle embedding from image."""
    start_time = time.time()

    try:
        img = load_image_from_upload(image)
        embedding = extract_reid_embedding(img)

        return EmbeddingResponse(
            embedding=embedding.tolist(),
            embedding_dim=len(embedding),
            processing_time_ms=(time.time() - start_time) * 1000
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/reid/compare", response_model=CompareResponse)
async def compare_vehicles(
    image1: UploadFile = File(...),
    image2: UploadFile = File(...),
    threshold: float = Query(DEFAULT_SIMILARITY_THRESHOLD)
):
    """Compare two vehicle images."""
    start_time = time.time()

    try:
        img1 = load_image_from_upload(image1)
        img2 = load_image_from_upload(image2)

        emb1 = extract_reid_embedding(img1)
        emb2 = extract_reid_embedding(img2)

        similarity = compute_similarity(emb1, emb2)

        if similarity > 0.75:
            confidence = "high"
        elif similarity > 0.65:
            confidence = "medium"
        elif similarity > 0.55:
            confidence = "low"
        else:
            confidence = "none"

        return CompareResponse(
            similarity=similarity,
            is_same_vehicle=similarity >= threshold,
            confidence=confidence,
            processing_time_ms=(time.time() - start_time) * 1000
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/reid/compare-embeddings", response_model=CompareResponse)
async def compare_embeddings(request: CompareRequest):
    """Compare two embeddings directly."""
    start_time = time.time()

    emb1 = np.array(request.embedding1)
    emb2 = np.array(request.embedding2)

    similarity = compute_similarity(emb1, emb2)

    if similarity > 0.75:
        confidence = "high"
    elif similarity > 0.65:
        confidence = "medium"
    elif similarity > 0.55:
        confidence = "low"
    else:
        confidence = "none"

    return CompareResponse(
        similarity=similarity,
        is_same_vehicle=similarity >= DEFAULT_SIMILARITY_THRESHOLD,
        confidence=confidence,
        processing_time_ms=(time.time() - start_time) * 1000
    )


@app.post("/api/v1/reid/search", response_model=SearchResponse)
async def search_gallery(
    query: UploadFile = File(...),
    gallery: List[UploadFile] = File(...),
    threshold: float = Query(DEFAULT_SIMILARITY_THRESHOLD),
    top_k: int = Query(10)
):
    """Search for matching vehicles in a gallery."""
    start_time = time.time()

    try:
        query_img = load_image_from_upload(query)
        query_emb = extract_reid_embedding(query_img)

        results = []
        for gallery_file in gallery:
            try:
                gallery_img = load_image_from_upload(gallery_file)
                gallery_emb = extract_reid_embedding(gallery_img)
                similarity = compute_similarity(query_emb, gallery_emb)

                results.append(SearchResult(
                    filename=gallery_file.filename,
                    similarity=similarity,
                    is_match=similarity >= threshold
                ))
            except Exception as e:
                results.append(SearchResult(
                    filename=gallery_file.filename,
                    similarity=0.0,
                    is_match=False
                ))

        # Sort by similarity
        results.sort(key=lambda x: x.similarity, reverse=True)

        return SearchResponse(
            query_embedding_dim=len(query_emb),
            gallery_size=len(gallery),
            matches=results[:top_k],
            processing_time_ms=(time.time() - start_time) * 1000
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/classify", response_model=ClassifyResponse)
async def classify_image(
    image: UploadFile = File(...),
    top_k: int = Query(5)
):
    """Classify vehicle make/model/year."""
    start_time = time.time()

    try:
        img = load_image_from_upload(image)
        results = classify_vehicle(img, top_k)

        return ClassifyResponse(
            make=results["make"],
            model=results["model"],
            year=results["year"],
            processing_time_ms=(time.time() - start_time) * 1000
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/batch", response_model=BatchResponse)
async def batch_process(
    images: List[UploadFile] = File(...),
    extract_embedding: bool = Query(True),
    classify: bool = Query(True)
):
    """Batch process multiple images."""
    start_time = time.time()

    results = []
    successful = 0
    failed = 0

    for image_file in images:
        try:
            img = load_image_from_upload(image_file)

            result = BatchResult(
                filename=image_file.filename,
                make=None,
                make_confidence=None,
                model=None,
                model_confidence=None,
                year=None,
                embedding_extracted=False,
                error=None
            )

            if classify and makemodel_model:
                predictions = classify_vehicle(img, top_k=1)
                result.make = predictions["make"][0]["label"]
                result.make_confidence = predictions["make"][0]["confidence"]
                result.model = predictions["model"][0]["label"]
                result.model_confidence = predictions["model"][0]["confidence"]
                if predictions["year"]:
                    result.year = predictions["year"][0]["label"]

            if extract_embedding and reid_model:
                _ = extract_reid_embedding(img)
                result.embedding_extracted = True

            results.append(result)
            successful += 1

        except Exception as e:
            results.append(BatchResult(
                filename=image_file.filename,
                make=None,
                make_confidence=None,
                model=None,
                model_confidence=None,
                year=None,
                embedding_extracted=False,
                error=str(e)
            ))
            failed += 1

    return BatchResponse(
        total=len(images),
        successful=successful,
        failed=failed,
        results=results,
        processing_time_ms=(time.time() - start_time) * 1000
    )


# ============================================
# Main
# ============================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Vehicle-API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")

    args = parser.parse_args()

    print(f"\n{'='*60}")
    print("VEHICLE-API SERVER")
    print(f"{'='*60}")
    print(f"Host: {args.host}")
    print(f"Port: {args.port}")
    print(f"Docs: http://localhost:{args.port}/docs")
    print(f"{'='*60}\n")

    uvicorn.run(
        "api_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )


if __name__ == "__main__":
    main()
