"""Fase 0 — Build the ReID dataset from the production DB (READ-ONLY).

Selects auto-labeled identities (event + recognized number) that have >= N photos, downloads
the source images from Supabase Storage, crops the matching vehicle, and writes a manifest
parquet with a leak-free split-by-event.

Usage:
    python export_dataset.py --max-events 50 --min-per-identity 3 --out data/

Start small (`--max-events`) — downloading the full 211k-image corpus is heavy egress.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

import pandas as pd
import psycopg
import requests
from PIL import Image, ImageFile
from tqdm import tqdm

from bbox import extract_box, pad_and_pixelize
from config import Settings, TRUSTED_CONFIDENCE, identity_id, normalize_number

ImageFile.LOAD_TRUNCATED_IMAGES = True  # be forgiving with slightly broken JPEGs

QUERY = """
WITH labeled AS (
    SELECT ar.id AS analysis_id, ar.image_id, i.execution_id, i.storage_path,
           ar.recognized_number, ar.raw_response, ar.crop_analysis,
           ar.raw_response->'vehicles'->0->>'team' AS team,
           ar.raw_response->'visualTags'->'visualStyle' AS visual_style
    FROM analysis_results ar
    JOIN images i ON i.id = ar.image_id
    WHERE ar.recognized_number IS NOT NULL AND ar.recognized_number <> ''
      AND i.execution_id IS NOT NULL
      AND i.storage_deleted_at IS NULL AND i.storage_purged_at IS NULL
      AND i.storage_path IS NOT NULL
      AND upper(ar.confidence_level) = ANY(%(conf)s)
),
ident AS (
    SELECT execution_id, recognized_number
    FROM labeled
    GROUP BY execution_id, recognized_number
    HAVING count(*) >= %(min_per)s
),
events AS (
    SELECT DISTINCT execution_id FROM ident ORDER BY execution_id LIMIT %(max_events)s
)
SELECT l.analysis_id, l.image_id, l.execution_id, l.storage_path,
       l.recognized_number, l.raw_response, l.crop_analysis, l.team, l.visual_style
FROM labeled l
JOIN ident d  ON d.execution_id = l.execution_id AND d.recognized_number = l.recognized_number
JOIN events e ON e.execution_id = l.execution_id
"""


def split_by_event(execution_id: str) -> str:
    """Deterministic 70/15/15 train/val/test, keyed by event so an event never spans splits."""
    h = int(hashlib.md5(execution_id.encode()).hexdigest(), 16) % 100
    if h < 70:
        return "train"
    if h < 85:
        return "val"
    return "test"


def fetch_rows(s: Settings, min_per: int, max_events: int) -> list[dict]:
    with psycopg.connect(s.db_url, row_factory=psycopg.rows.dict_row) as conn:
        # Belt-and-suspenders: keep the session read-only.
        conn.execute("SET default_transaction_read_only = on;")
        with conn.cursor() as cur:
            cur.execute(QUERY, {
                "conf": list(TRUSTED_CONFIDENCE),
                "min_per": min_per,
                "max_events": max_events,
            })
            return cur.fetchall()


def download_image(s: Settings, storage_path: str, session: requests.Session) -> Image.Image | None:
    url = s.storage_object_url(storage_path)
    headers = {"Authorization": f"Bearer {s.service_key}", "apikey": s.service_key}
    try:
        r = session.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content)).convert("RGB")
    except (requests.RequestException, OSError) as e:
        tqdm.write(f"  ! download/open failed for {storage_path}: {e}")
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--min-per-identity", type=int, default=3,
                    help="min photos per (event, number) identity to include")
    ap.add_argument("--max-events", type=int, default=50)
    ap.add_argument("--max-per-identity", type=int, default=40,
                    help="cap crops per identity to avoid over-weighting big stints")
    ap.add_argument("--padding", type=float, default=0.12, help="fractional pad around the bbox")
    ap.add_argument("--crop-longest", type=int, default=512, help="resize crop longest side to N px")
    args = ap.parse_args()

    s = Settings.from_env()
    crops_dir = args.out / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    print(f"Querying DB: min_per_identity={args.min_per_identity}, max_events={args.max_events} ...")
    rows = fetch_rows(s, args.min_per_identity, args.max_events)
    print(f"  {len(rows)} candidate image rows across the selected events.")

    session = requests.Session()
    per_identity_count: dict[str, int] = {}
    records: list[dict] = []
    skipped_box = skipped_dl = capped = 0

    for row in tqdm(rows, desc="crops"):
        num = normalize_number(row["recognized_number"])
        if not num:
            continue
        ident = identity_id(row["execution_id"], num)
        if per_identity_count.get(ident, 0) >= args.max_per_identity:
            capped += 1
            continue

        box = extract_box(row["raw_response"], row["crop_analysis"], row["recognized_number"])
        if box is None:
            skipped_box += 1
            continue

        img = download_image(s, row["storage_path"], session)
        if img is None:
            skipped_dl += 1
            continue

        left, top, right, bottom = pad_and_pixelize(box, img.width, img.height, args.padding)
        if right - left < 8 or bottom - top < 8:
            skipped_box += 1
            continue
        crop = img.crop((left, top, right, bottom))
        if args.crop_longest:
            crop.thumbnail((args.crop_longest, args.crop_longest), Image.LANCZOS)

        ident_dir = crops_dir / ident.replace(":", "__").replace("/", "_")
        ident_dir.mkdir(parents=True, exist_ok=True)
        crop_path = ident_dir / f"{row['image_id']}.jpg"
        crop.save(crop_path, "JPEG", quality=92)
        per_identity_count[ident] = per_identity_count.get(ident, 0) + 1

        vstyle = row["visual_style"]
        records.append({
            "analysis_id": str(row["analysis_id"]),
            "image_id": str(row["image_id"]),
            "execution_id": str(row["execution_id"]),
            "recognized_number": row["recognized_number"],
            "number_norm": num,
            "identity_id": ident,
            "crop_path": str(crop_path.relative_to(args.out)),
            "split": split_by_event(row["execution_id"]),
            "team": row["team"],
            "visual_style": json.dumps(vstyle) if vstyle is not None else None,
        })

    if not records:
        raise SystemExit("No crops produced. Check connectivity / filters.")

    df = pd.DataFrame(records)
    # Drop identities that ended up with a single usable crop (no positive possible).
    counts = df["identity_id"].value_counts()
    df["n_in_identity"] = df["identity_id"].map(counts)
    df = df[df["n_in_identity"] >= 2].reset_index(drop=True)

    manifest_path = args.out / "manifest.parquet"
    df.to_parquet(manifest_path, index=False)

    print("\n=== Fase 0 summary ===")
    print(f"crops written      : {len(df)}")
    print(f"identities         : {df['identity_id'].nunique()}")
    print(f"events             : {df['execution_id'].nunique()}")
    print(f"split (rows)       : {df['split'].value_counts().to_dict()}")
    print(f"skipped (no box)   : {skipped_box}")
    print(f"skipped (download) : {skipped_dl}")
    print(f"capped per-identity: {capped}")
    print(f"manifest           : {manifest_path}")
    print(f"crops dir          : {crops_dir}")


if __name__ == "__main__":
    main()
