"""Extract the vehicle crop box for a given recognized number out of an analysis_results row.

The DB carries the box in several shapes (V6 pipeline):
  - crop_analysis[].originalBbox                          -> normalized 0..1   (preferred)
  - raw_response.vehicles[].boundingBox                   -> PERCENT 0..100
  - raw_response.segmentationPreprocessing.detections[]   -> normalized 0..1   (no number link)

We pick the box belonging to the vehicle whose raceNumber matches the row's recognized_number;
if there is exactly one vehicle/detection we take it regardless. Returns a normalized
(x, y, w, h) tuple in 0..1, or None.
"""
from __future__ import annotations

from typing import Any

from config import normalize_number

Box = tuple[float, float, float, float]


def _norm_box(b: dict, scale: float) -> Box | None:
    try:
        x = float(b["x"]) / scale
        y = float(b["y"]) / scale
        w = float(b["width"]) / scale
        h = float(b["height"]) / scale
    except (KeyError, TypeError, ValueError):
        return None
    # sanity: must be a plausible normalized box
    if w <= 0 or h <= 0 or x < -0.05 or y < -0.05 or x > 1.05 or y > 1.05:
        return None
    return (max(0.0, x), max(0.0, y), min(1.0, w), min(1.0, h))


def extract_box(raw_response: Any, crop_analysis: Any, target_number: str | None) -> Box | None:
    target = normalize_number(target_number)

    # 1) crop_analysis[].originalBbox (normalized) — most reliable, already per-detection
    if isinstance(crop_analysis, list):
        single = len(crop_analysis) == 1
        for c in crop_analysis:
            if not isinstance(c, dict):
                continue
            if single or normalize_number(c.get("raceNumber")) == target:
                box = _norm_box(c.get("originalBbox") or {}, scale=1.0)
                if box:
                    return box

    # 2) raw_response.vehicles[].boundingBox (PERCENT)
    vehicles = (raw_response or {}).get("vehicles") if isinstance(raw_response, dict) else None
    if isinstance(vehicles, list):
        single = len(vehicles) == 1
        for v in vehicles:
            if not isinstance(v, dict):
                continue
            if single or normalize_number(v.get("raceNumber")) == target:
                box = _norm_box(v.get("boundingBox") or {}, scale=100.0)
                if box:
                    return box

    # 3) segmentationPreprocessing.detections[] (normalized) — only if unambiguous
    seg = (raw_response or {}).get("segmentationPreprocessing") if isinstance(raw_response, dict) else None
    dets = (seg or {}).get("detections") if isinstance(seg, dict) else None
    if isinstance(dets, list) and len(dets) == 1 and isinstance(dets[0], dict):
        box = _norm_box(dets[0].get("bbox") or {}, scale=1.0)
        if box:
            return box

    return None


def pad_and_pixelize(box: Box, img_w: int, img_h: int, padding: float = 0.12) -> tuple[int, int, int, int]:
    """Apply fractional padding around a normalized box and convert to integer pixel
    (left, top, right, bottom), clamped to the image."""
    x, y, w, h = box
    px, py = w * padding, h * padding
    left = (x - px) * img_w
    top = (y - py) * img_h
    right = (x + w + px) * img_w
    bottom = (y + h + py) * img_h
    left = max(0, int(round(left)))
    top = max(0, int(round(top)))
    right = min(img_w, int(round(right)))
    bottom = min(img_h, int(round(bottom)))
    return left, top, right, bottom
