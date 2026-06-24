"""Unit tests for the pure (CPU-only, no-model, no-DB) logic of the vehicle-ReID harness.

These cover the parts where a bug would silently corrupt the dataset or the decision-gate
metrics: race-number normalization, identity keys, bounding-box extraction across the three
DB shapes, padding/pixelization, and the within-event retrieval metrics.

Runs with no third-party test runner:
    python test_logic.py            # built-in runner (only numpy required)
    python -m pytest test_logic.py  # also works if pytest is installed
"""
from __future__ import annotations

import numpy as np

from config import identity_id, normalize_number
from bbox import extract_box, pad_and_pixelize
from eval_retrieval import average_precision, evaluate


# --- config.normalize_number / identity_id ---------------------------------------------

def test_normalize_number_drops_leading_zeros_on_digits():
    assert normalize_number("034") == "34"
    assert normalize_number("7") == "7"
    assert normalize_number("0") == "0"
    assert normalize_number(34) == "34"  # non-str input


def test_normalize_number_trims_and_uppercases_alphanumerics():
    assert normalize_number("  7 ") == "7"
    assert normalize_number("ab12") == "AB12"
    assert normalize_number("46x") == "46X"


def test_normalize_number_empty_is_none():
    assert normalize_number(None) is None
    assert normalize_number("") is None
    assert normalize_number("   ") is None


def test_identity_id_is_stable_event_number_key():
    assert identity_id("evt-1", "46") == "evt-1:46"


# --- bbox.extract_box ------------------------------------------------------------------

def test_extract_box_prefers_crop_analysis_normalized():
    crop_analysis = [{"raceNumber": "46", "originalBbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}}]
    box = extract_box(raw_response=None, crop_analysis=crop_analysis, target_number="46")
    assert box == (0.1, 0.2, 0.3, 0.4)


def test_extract_box_crop_analysis_picks_matching_number_when_multiple():
    crop_analysis = [
        {"raceNumber": "11", "originalBbox": {"x": 0.0, "y": 0.0, "width": 0.2, "height": 0.2}},
        {"raceNumber": "46", "originalBbox": {"x": 0.5, "y": 0.5, "width": 0.3, "height": 0.3}},
    ]
    box = extract_box(None, crop_analysis, target_number="046")  # normalizes to "46"
    assert box == (0.5, 0.5, 0.3, 0.3)


def test_extract_box_vehicles_boundingbox_is_percent_scaled():
    raw = {"vehicles": [{"raceNumber": "46", "boundingBox": {"x": 10, "y": 20, "width": 30, "height": 40}}]}
    box = extract_box(raw, crop_analysis=None, target_number="46")
    assert box is not None
    np.testing.assert_allclose(box, (0.1, 0.2, 0.3, 0.4), atol=1e-9)


def test_extract_box_falls_back_to_single_segmentation_detection():
    raw = {"segmentationPreprocessing": {"detections": [{"bbox": {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}}]}}
    box = extract_box(raw, crop_analysis=None, target_number=None)
    assert box == (0.25, 0.25, 0.5, 0.5)


def test_extract_box_ambiguous_segmentation_returns_none():
    # two detections, no number link -> cannot disambiguate
    raw = {"segmentationPreprocessing": {"detections": [
        {"bbox": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}},
        {"bbox": {"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.2}},
    ]}}
    assert extract_box(raw, None, target_number="46") is None


def test_extract_box_rejects_out_of_range_box():
    crop_analysis = [{"raceNumber": "46", "originalBbox": {"x": 5, "y": 0.2, "width": 0.3, "height": 0.4}}]
    # x=5 is implausible for a normalized box -> rejected, nothing else available
    assert extract_box(None, crop_analysis, target_number="46") is None


def test_extract_box_none_when_no_signal():
    assert extract_box(None, None, target_number="46") is None
    assert extract_box({}, [], target_number="46") is None


# --- bbox.pad_and_pixelize -------------------------------------------------------------

def test_pad_and_pixelize_applies_padding_and_returns_ints():
    # box centred, 12% padding, 1000x500 image
    left, top, right, bottom = pad_and_pixelize((0.4, 0.4, 0.2, 0.2), img_w=1000, img_h=500, padding=0.5)
    # px = 0.2*0.5 = 0.1 -> left = (0.4-0.1)*1000 = 300 ; right = (0.4+0.2+0.1)*1000 = 700
    assert (left, right) == (300, 700)
    # py = 0.1 -> top = (0.4-0.1)*500 = 150 ; bottom = (0.4+0.2+0.1)*500 = 350
    assert (top, bottom) == (150, 350)
    assert all(isinstance(v, int) for v in (left, top, right, bottom))


def test_pad_and_pixelize_clamps_to_image_bounds():
    left, top, right, bottom = pad_and_pixelize((0.0, 0.0, 1.0, 1.0), img_w=800, img_h=600, padding=0.5)
    assert (left, top, right, bottom) == (0, 0, 800, 600)


# --- eval_retrieval.average_precision --------------------------------------------------

def test_average_precision_all_relevant_first_is_one():
    assert average_precision(np.array([True, True, False, False])) == 1.0


def test_average_precision_no_relevant_is_zero():
    assert average_precision(np.array([False, False, False])) == 0.0


def test_average_precision_interleaved_matches_known_value():
    # relevant at ranks 1 and 3: AP = (1/1 + 2/3) / 2 = 0.8333...
    ap = average_precision(np.array([True, False, True]))
    assert abs(ap - (1.0 + 2.0 / 3.0) / 2.0) < 1e-9


# --- eval_retrieval.evaluate -----------------------------------------------------------

def _unit(v):
    v = np.asarray(v, np.float32)
    return v / np.linalg.norm(v)


def test_evaluate_clean_within_event_is_perfect():
    # event A: identity X has two near-identical vectors, identity Y is a singleton (skipped).
    emb = np.stack([_unit([1, 0, 0]), _unit([0.99, 0.01, 0]), _unit([0, 1, 0])])
    ident = np.array(["A:46", "A:46", "A:11"])
    event = np.array(["A", "A", "A"])
    mask = np.ones(3, bool)
    res = evaluate(emb, ident, event, mask)
    assert res["queries"] == 2  # the two X members; Y is skipped (no same-identity gallery)
    assert res["Rank-1"] == 1.0
    assert res["Rank-5"] == 1.0
    assert res["mAP"] == 1.0


def test_evaluate_isolates_galleries_per_event():
    # same identity string split across two events -> each side is a singleton -> no queries.
    emb = np.stack([_unit([1, 0, 0]), _unit([1, 0, 0])])
    ident = np.array(["46", "46"])
    event = np.array(["A", "B"])
    res = evaluate(emb, ident, event, np.ones(2, bool))
    assert res == {"queries": 0}


def test_evaluate_empty_mask_returns_zero_queries():
    emb = np.stack([_unit([1, 0, 0]), _unit([0, 1, 0])])
    ident = np.array(["A:1", "A:2"])
    event = np.array(["A", "A"])
    res = evaluate(emb, ident, event, np.zeros(2, bool))
    assert res == {"queries": 0}


# --- built-in runner (no pytest needed) ------------------------------------------------

if __name__ == "__main__":
    import sys
    import traceback

    tests = sorted(name for name, obj in globals().items() if name.startswith("test_") and callable(obj))
    failures = 0
    for name in tests:
        try:
            globals()[name]()
            print(f"PASS  {name}")
        except Exception:  # noqa: BLE001 — report every failure, keep going
            failures += 1
            print(f"FAIL  {name}")
            traceback.print_exc()
    total = len(tests)
    print(f"\n{total - failures}/{total} passed")
    sys.exit(1 if failures else 0)
