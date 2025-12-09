#!/usr/bin/env python3
"""
13-auto-bbox-generator.py

Genera automaticamente bounding box usando RF-DETR ONNX e li combina
con le label assegnate manualmente per creare dataset YOLO completo.

Workflow:
1. Legge metadata.json per ottenere frame e scene labelate
2. Per ogni frame con label assegnata, esegue inference RF-DETR
3. Seleziona il bbox più grande (area maggiore) - auto principale più vicina
4. Genera file .txt in formato YOLO per ogni immagine

Formato YOLO:
<class_id> <x_center> <y_center> <width> <height>
Coordinate normalizzate 0-1

Utilizzo:
    python scripts/13-auto-bbox-generator.py \\
        --input ./formula_e_dataset \\
        --model ./models/RT-F1-2025/RT-F1-2025-V4.onnx \\
        --confidence 0.1
"""

import argparse
import json
import sys
from pathlib import Path
import numpy as np
from tqdm import tqdm

# Aggiungi rf-detr-onnx-converter al path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "rf-detr-onnx-converter"))

from rfdetr_onnx import RFDETR_ONNX


def load_metadata(input_dir: Path) -> dict:
    """Carica metadata.json"""
    metadata_path = input_dir / "metadata.json"
    if not metadata_path.exists():
        raise FileNotFoundError(f"metadata.json non trovato in {input_dir}")

    with open(metadata_path, 'r') as f:
        return json.load(f)


def get_label_to_class_id(config: dict) -> dict:
    """
    Crea mapping da label (es. "16") a class_id (es. 7)

    In labels_config.json:
    "labels": {
        "0": "1",    -> class_id=0, label="1"
        "7": "16",   -> class_id=7, label="16"
    }
    """
    labels = config.get("labels", {})
    # Inverti: da {"0": "1"} a {"1": 0}
    return {v: int(k) for k, v in labels.items()}


def convert_to_yolo(box: np.ndarray, img_width: int, img_height: int) -> tuple:
    """
    Converte bbox da [xmin, ymin, xmax, ymax] pixel a YOLO format normalizzato.

    YOLO: <x_center> <y_center> <width> <height> (tutti normalizzati 0-1)
    """
    xmin, ymin, xmax, ymax = box

    # Calcola centro e dimensioni
    box_width = xmax - xmin
    box_height = ymax - ymin
    x_center = xmin + box_width / 2
    y_center = ymin + box_height / 2

    # Normalizza
    x_center_n = x_center / img_width
    y_center_n = y_center / img_height
    width_n = box_width / img_width
    height_n = box_height / img_height

    # Clamp a 0-1
    x_center_n = max(0, min(1, x_center_n))
    y_center_n = max(0, min(1, y_center_n))
    width_n = max(0, min(1, width_n))
    height_n = max(0, min(1, height_n))

    return x_center_n, y_center_n, width_n, height_n


def save_yolo_annotation(output_path: Path, class_id: int, yolo_box: tuple):
    """Salva annotazione in formato YOLO .txt"""
    x_center, y_center, width, height = yolo_box
    with open(output_path, 'w') as f:
        f.write(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")


def get_image_dimensions(image_path: Path) -> tuple:
    """Ottiene dimensioni immagine senza caricarla completamente"""
    from PIL import Image
    with Image.open(image_path) as img:
        return img.size  # (width, height)


def generate_auto_bbox(
    input_dir: Path,
    model_path: Path,
    confidence: float = 0.1,
    output_subdir: str = "annotations"
):
    """
    Genera bounding box automatici per tutti i frame con label assegnata.
    """
    print(f"\n{'='*60}")
    print(f"AUTO-BBOX GENERATOR")
    print(f"{'='*60}")
    print(f"Input directory: {input_dir}")
    print(f"Model: {model_path}")
    print(f"Confidence threshold: {confidence}")
    print(f"{'='*60}\n")

    # Verifica esistenza modello
    if not model_path.exists():
        raise FileNotFoundError(f"Modello ONNX non trovato: {model_path}")

    # Carica metadata
    print("Caricamento metadata...")
    metadata = load_metadata(input_dir)

    # Estrai configurazione
    config = metadata.get("config", {})
    label_to_class_id = get_label_to_class_id(config)
    print(f"Label mappings: {label_to_class_id}")

    # Crea dizionario scene per lookup veloce
    scenes = {s["scene_id"]: s for s in metadata.get("scenes", [])}

    # Carica modello
    print(f"\nCaricamento modello ONNX...")
    model = RFDETR_ONNX(str(model_path))
    print(f"Modello caricato. Input size: {model.input_width}x{model.input_height}")

    # Crea directory output
    output_dir = input_dir / output_subdir
    output_dir.mkdir(exist_ok=True)
    print(f"Output directory: {output_dir}")

    # Directory frames
    frames_dir = input_dir / "frames"
    if not frames_dir.exists():
        raise FileNotFoundError(f"Directory frames non trovata: {frames_dir}")

    # Statistiche
    stats = {
        "total_frames": 0,
        "frames_with_label": 0,
        "detections_success": 0,
        "detections_failed": 0,
        "class_distribution": {}
    }

    # Processa ogni frame
    frames = metadata.get("frames", [])
    stats["total_frames"] = len(frames)

    print(f"\nProcessamento {len(frames)} frame...\n")

    for frame in tqdm(frames, desc="Generazione bbox"):
        scene_id = frame.get("scene_id")
        filename = frame.get("filename")

        if not scene_id or not filename:
            continue

        # Ottieni scena e label
        scene = scenes.get(scene_id, {})
        label = scene.get("label")

        if not label:
            continue  # Skip frame senza label

        stats["frames_with_label"] += 1

        # Verifica label valida
        if label not in label_to_class_id:
            print(f"\nWarning: Label '{label}' non trovata in config, skip {filename}")
            continue

        class_id = label_to_class_id[label]

        # Path immagine
        image_path = frames_dir / filename
        if not image_path.exists():
            print(f"\nWarning: Immagine non trovata: {image_path}")
            continue

        # Ottieni dimensioni immagine
        img_width, img_height = get_image_dimensions(image_path)

        # Inference RF-DETR
        try:
            scores, labels, boxes, _ = model.predict(
                str(image_path),
                confidence_threshold=confidence
            )
        except Exception as e:
            print(f"\nErrore inference per {filename}: {e}")
            stats["detections_failed"] += 1
            continue

        if len(boxes) == 0:
            stats["detections_failed"] += 1
            continue

        # Seleziona bbox più grande (area maggiore = auto più vicina/prominente)
        areas = [(box[2] - box[0]) * (box[3] - box[1]) for box in boxes]
        best_idx = np.argmax(areas)
        best_box = boxes[best_idx]
        best_score = scores[best_idx]

        # Converti a formato YOLO
        yolo_box = convert_to_yolo(best_box, img_width, img_height)

        # Salva annotazione
        txt_filename = Path(filename).stem + ".txt"
        output_path = output_dir / txt_filename
        save_yolo_annotation(output_path, class_id, yolo_box)

        stats["detections_success"] += 1

        # Aggiorna distribuzione classi
        if label not in stats["class_distribution"]:
            stats["class_distribution"][label] = 0
        stats["class_distribution"][label] += 1

    # Report finale
    print(f"\n{'='*60}")
    print(f"REPORT FINALE")
    print(f"{'='*60}")
    print(f"Frame totali:           {stats['total_frames']}")
    print(f"Frame con label:        {stats['frames_with_label']}")
    print(f"Detection riuscite:     {stats['detections_success']}")
    print(f"Detection fallite:      {stats['detections_failed']}")
    print(f"Success rate:           {stats['detections_success'] / max(1, stats['frames_with_label']) * 100:.1f}%")
    print(f"\nDistribuzione per classe (numero gara):")
    for label, count in sorted(stats["class_distribution"].items(), key=lambda x: -x[1]):
        print(f"  #{label}: {count} frame")
    print(f"\nAnnotazioni salvate in: {output_dir}")
    print(f"{'='*60}\n")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Genera bbox automatici con RF-DETR e li combina con label manuali"
    )
    parser.add_argument(
        "-i", "--input",
        type=Path,
        required=True,
        help="Directory del dataset (contiene metadata.json e frames/)"
    )
    parser.add_argument(
        "-m", "--model",
        type=Path,
        default=Path(__file__).parent.parent / "models" / "RT-F1-2025" / "RT-F1-2025-V4.onnx",
        help="Path al modello ONNX RF-DETR"
    )
    parser.add_argument(
        "-c", "--confidence",
        type=float,
        default=0.1,
        help="Confidence threshold (default: 0.1 per catturare più detection)"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="annotations",
        help="Nome sottodirectory per le annotazioni (default: annotations)"
    )

    args = parser.parse_args()

    try:
        generate_auto_bbox(
            input_dir=args.input,
            model_path=args.model,
            confidence=args.confidence,
            output_subdir=args.output
        )
    except Exception as e:
        print(f"\nErrore: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
