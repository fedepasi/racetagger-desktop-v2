#!/usr/bin/env python3
"""
Video Frame Extractor for ML Training Dataset Creation

Estrae frame da video di highlights e li organizza in blocchi
per facilitare il labeling di dataset per object detection.

Features:
- Estrazione frame a intervalli configurabili
- Rilevamento cambio scena automatico
- Raggruppamento frame simili in blocchi
- Configurazione label da file JSON esterno
- Interfaccia CLI per labeling rapido per blocco
- Export in formato Roboflow/YOLO

Usage:
    python 10-video-frame-extractor.py extract --video highlights.mp4 --output ./frames
    python 10-video-frame-extractor.py label --input ./frames
    python 10-video-frame-extractor.py export --input ./frames --format roboflow

Config:
    Modifica configs/labels_config.json per personalizzare le label
"""

import os
import sys
import cv2
import json
import shutil
import argparse
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict


# Path al file di configurazione
SCRIPT_DIR = Path(__file__).parent
CONFIG_DIR = SCRIPT_DIR.parent / "configs"
DEFAULT_CONFIG = CONFIG_DIR / "labels_config.json"


@dataclass
class FrameInfo:
    """Informazioni su un singolo frame estratto"""
    filename: str
    frame_number: int
    timestamp_ms: float
    scene_id: int
    similarity_to_prev: float
    labeled: bool = False
    label: str = ""


@dataclass
class SceneInfo:
    """Informazioni su una scena (gruppo di frame simili)"""
    scene_id: int
    start_frame: int
    end_frame: int
    frame_count: int
    start_timestamp_ms: float
    end_timestamp_ms: float
    label: str = ""
    representative_frame: str = ""


def load_labels_config(config_path: Optional[Path] = None) -> Dict:
    """
    Carica configurazione label da file JSON.

    Args:
        config_path: Percorso file config (default: configs/labels_config.json)

    Returns:
        Dizionario con configurazione label
    """
    config_file = config_path or DEFAULT_CONFIG

    if not config_file.exists():
        print(f"⚠️  Config non trovato: {config_file}")
        print(f"   Creando config di default...")

        # Crea config di default
        default_config = {
            "project_name": "my_project",
            "description": "Configurazione label - modifica questo file!",
            "labels": {
                str(i): f"CLASS_{i}" for i in range(1, 21)
            },
            "groups": {},
            "shortcuts": {}
        }

        config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(config_file, 'w') as f:
            json.dump(default_config, f, indent=2)

        return default_config

    with open(config_file) as f:
        config = json.load(f)

    print(f"📋 Config caricato: {config.get('project_name', 'unknown')}")
    print(f"   Label disponibili: {len(config.get('labels', {}))}")

    return config


class VideoFrameExtractor:
    """Estrae e organizza frame da video per ML training"""

    def __init__(
        self,
        output_dir: str,
        scene_threshold: float = 0.7,
        config_path: Optional[str] = None
    ):
        """
        Args:
            output_dir: Directory dove salvare i frame estratti
            scene_threshold: Soglia di similarità per cambio scena (0-1)
            config_path: Percorso file configurazione label (opzionale)
        """
        self.output_dir = Path(output_dir)
        self.scene_threshold = scene_threshold
        self.frames_dir = self.output_dir / "frames"
        self.scenes_dir = self.output_dir / "scenes"
        self.labeled_dir = self.output_dir / "labeled"
        self.metadata_file = self.output_dir / "metadata.json"

        # Carica configurazione label
        config_file = Path(config_path) if config_path else None
        self.config = load_labels_config(config_file)
        self.labels = self.config.get("labels", {})
        self.groups = self.config.get("groups", {})
        self.shortcuts = self.config.get("shortcuts", {})

        # Crea directory
        for d in [self.frames_dir, self.scenes_dir, self.labeled_dir]:
            d.mkdir(parents=True, exist_ok=True)

    def extract_frames(
        self,
        video_path: str,
        fps: float = 2.0,
        max_frames: Optional[int] = None,
        start_time: float = 0,
        end_time: Optional[float] = None
    ) -> Dict:
        """
        Estrae frame dal video con scene detection.

        Args:
            video_path: Percorso del video
            fps: Frame per secondo da estrarre
            max_frames: Numero massimo di frame (None = tutti)
            start_time: Tempo di inizio in secondi
            end_time: Tempo di fine in secondi (None = fino alla fine)

        Returns:
            Dizionario con metadati dell'estrazione
        """
        print(f"\n🎬 Apertura video: {video_path}")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossibile aprire il video: {video_path}")

        # Info video
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / video_fps

        print(f"   FPS video: {video_fps:.2f}")
        print(f"   Frame totali: {total_frames}")
        print(f"   Durata: {duration:.2f}s ({duration/60:.1f} min)")

        # Calcola intervallo frame
        frame_interval = int(video_fps / fps)

        # Imposta range temporale
        start_frame = int(start_time * video_fps)
        end_frame = int(end_time * video_fps) if end_time else total_frames

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        frames_info: List[FrameInfo] = []
        scenes_info: List[SceneInfo] = []
        current_scene_id = 0
        current_scene_start = start_frame
        prev_frame = None
        prev_hist = None

        frame_count = 0
        current_frame_num = start_frame

        print(f"\n📷 Estrazione frame (1 ogni {frame_interval} frame, ~{fps} fps)...")
        print(f"   Range: {start_time}s - {end_time if end_time else duration}s")

        while current_frame_num < end_frame:
            if max_frames and frame_count >= max_frames:
                break

            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame_num)
            ret, frame = cap.read()

            if not ret:
                break

            timestamp_ms = (current_frame_num / video_fps) * 1000

            # Calcola similarità con frame precedente
            similarity = 1.0
            if prev_frame is not None:
                similarity = self._calculate_similarity(prev_frame, frame, prev_hist)

            # Rileva cambio scena
            is_new_scene = similarity < self.scene_threshold

            if is_new_scene and prev_frame is not None:
                # Salva info scena precedente
                scenes_info.append(SceneInfo(
                    scene_id=current_scene_id,
                    start_frame=current_scene_start,
                    end_frame=current_frame_num - frame_interval,
                    frame_count=len([f for f in frames_info if f.scene_id == current_scene_id]),
                    start_timestamp_ms=frames_info[-1].timestamp_ms if frames_info else 0,
                    end_timestamp_ms=timestamp_ms,
                    representative_frame=f"scene_{current_scene_id:04d}_rep.jpg"
                ))
                current_scene_id += 1
                current_scene_start = current_frame_num
                print(f"\n   🎬 Nuova scena {current_scene_id} al frame {current_frame_num} (sim: {similarity:.2f})")

            # Salva frame
            filename = f"frame_{frame_count:06d}_scene{current_scene_id:04d}.jpg"
            frame_path = self.frames_dir / filename
            cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])

            # Salva frame rappresentativo per ogni nuova scena
            if is_new_scene or prev_frame is None:
                rep_path = self.scenes_dir / f"scene_{current_scene_id:04d}_rep.jpg"
                cv2.imwrite(str(rep_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])

            frames_info.append(FrameInfo(
                filename=filename,
                frame_number=current_frame_num,
                timestamp_ms=timestamp_ms,
                scene_id=current_scene_id,
                similarity_to_prev=similarity
            ))

            prev_frame = frame.copy()
            prev_hist = self._compute_histogram(frame)
            frame_count += 1
            current_frame_num += frame_interval

            # Progress
            if frame_count % 50 == 0:
                progress = (current_frame_num - start_frame) / (end_frame - start_frame) * 100
                print(f"   Estratti {frame_count} frame ({progress:.1f}%), {current_scene_id + 1} scene...")

        # Ultima scena
        if frames_info:
            scenes_info.append(SceneInfo(
                scene_id=current_scene_id,
                start_frame=current_scene_start,
                end_frame=current_frame_num,
                frame_count=len([f for f in frames_info if f.scene_id == current_scene_id]),
                start_timestamp_ms=frames_info[-1].timestamp_ms,
                end_timestamp_ms=timestamp_ms,
                representative_frame=f"scene_{current_scene_id:04d}_rep.jpg"
            ))

        cap.release()

        # Salva metadata con config incluso
        metadata = {
            "video_path": str(video_path),
            "extraction_date": datetime.now().isoformat(),
            "video_fps": video_fps,
            "extraction_fps": fps,
            "total_frames_extracted": frame_count,
            "total_scenes": len(scenes_info),
            "scene_threshold": self.scene_threshold,
            "frames": [asdict(f) for f in frames_info],
            "scenes": [asdict(s) for s in scenes_info],
            "config": self.config  # Salva config usato
        }

        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"\n✅ Estrazione completata!")
        print(f"   Frame estratti: {frame_count}")
        print(f"   Scene rilevate: {len(scenes_info)}")
        print(f"   Output: {self.output_dir}")

        return metadata

    def _compute_histogram(self, frame: np.ndarray) -> np.ndarray:
        """Calcola istogramma colore normalizzato"""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
        return hist

    def _calculate_similarity(
        self,
        frame1: np.ndarray,
        frame2: np.ndarray,
        hist1: Optional[np.ndarray] = None
    ) -> float:
        """
        Calcola similarità tra due frame usando istogramma colore.

        Returns:
            Valore 0-1 (1 = identici, 0 = completamente diversi)
        """
        if hist1 is None:
            hist1 = self._compute_histogram(frame1)
        hist2 = self._compute_histogram(frame2)

        similarity = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
        return max(0, similarity)  # Può essere negativo, normalizziamo a 0

    def interactive_labeling(self):
        """
        Interfaccia CLI interattiva per labeling per scena.
        """
        if not self.metadata_file.exists():
            print("❌ Nessun metadata trovato. Esegui prima 'extract'.")
            return

        with open(self.metadata_file) as f:
            metadata = json.load(f)

        scenes = metadata.get("scenes", [])

        # Usa config dal metadata se presente, altrimenti quello corrente
        config = metadata.get("config", self.config)
        labels = config.get("labels", self.labels)
        shortcuts = config.get("shortcuts", self.shortcuts)
        groups = config.get("groups", self.groups)

        print("\n🏷️  LABELING INTERATTIVO PER SCENA")
        print("=" * 50)
        print(f"\n📋 Progetto: {config.get('project_name', 'unknown')}")
        print("\nComandi disponibili:")
        print("  [chiave] - Assegna label (es: 1 → CLASS_A)")
        print("  s        - Salta scena")
        print("  d        - Elimina scena (non usabile)")
        print("  v        - Visualizza frame scena")
        print("  l        - Lista tutte le label")
        print("  g        - Lista gruppi")
        print("  q        - Salva e esci")
        print("  ?        - Aiuto")
        print()

        labeled_count = 0
        deleted_scenes = set(metadata.get("deleted_scenes", []))

        for i, scene in enumerate(scenes):
            scene_id = scene["scene_id"]

            if scene.get("label"):
                print(f"⏭️  Scena {scene_id} già labelata: {scene['label']}")
                continue

            if scene_id in deleted_scenes:
                continue

            frame_count = scene["frame_count"]
            duration_sec = (scene["end_timestamp_ms"] - scene["start_timestamp_ms"]) / 1000
            rep_frame = scene.get("representative_frame", "")

            print(f"\n{'='*50}")
            print(f"📸 Scena {scene_id}/{len(scenes)-1}")
            print(f"   Frame: {frame_count} | Durata: {duration_sec:.1f}s")
            print(f"   Rappresentativo: {rep_frame}")

            while True:
                user_input = input("\n   Label (o comando): ").strip()

                if user_input.lower() == 'q':
                    self._save_labels(metadata, scenes, deleted_scenes)
                    print(f"\n✅ Salvato! Labeling completato per {labeled_count} scene.")
                    return

                elif user_input.lower() == 's':
                    print("   ⏭️ Saltata")
                    break

                elif user_input.lower() == 'd':
                    deleted_scenes.add(scene_id)
                    print("   🗑️ Marcata per eliminazione")
                    break

                elif user_input.lower() == 'v':
                    self._preview_scene(scene_id)

                elif user_input.lower() == 'l':
                    print("\n   📋 Label disponibili:")
                    for key, label in sorted(labels.items(), key=lambda x: x[0]):
                        print(f"      {key:>3} → {label}")

                elif user_input.lower() == 'g':
                    print("\n   👥 Gruppi disponibili:")
                    for shortcut, group_info in groups.items():
                        if isinstance(group_info, dict):
                            name = group_info.get("name", shortcut)
                            group_labels = group_info.get("labels", [])
                            print(f"      {shortcut}: {name} ({', '.join(group_labels)})")

                elif user_input.lower() == '?':
                    print("\n   📖 Aiuto:")
                    print("      Inserisci la chiave della label (es: 1, 2, a, b)")
                    print("      Oppure digita direttamente il nome label")
                    print("      Shortcut gruppi:", list(shortcuts.keys()))

                elif user_input.lower() in shortcuts:
                    # Shortcut per gruppo
                    group_keys = shortcuts[user_input.lower()]
                    print(f"   👥 Gruppo: {[labels.get(k, k) for k in group_keys]}")
                    sub_input = input("   Quale? ").strip()
                    if sub_input in labels:
                        scene["label"] = labels[sub_input]
                        labeled_count += 1
                        print(f"   ✅ Label: {scene['label']}")
                        break

                elif user_input in labels:
                    # Chiave diretta
                    scene["label"] = labels[user_input]
                    labeled_count += 1
                    print(f"   ✅ Label: {scene['label']}")
                    break

                elif user_input.upper() in [l.upper() for l in labels.values()]:
                    # Nome label diretto
                    scene["label"] = user_input.upper()
                    labeled_count += 1
                    print(f"   ✅ Label: {scene['label']}")
                    break

                elif user_input:
                    # Label custom
                    confirm = input(f"   Label custom '{user_input.upper()}'? (y/n): ").strip().lower()
                    if confirm == 'y':
                        scene["label"] = user_input.upper()
                        labeled_count += 1
                        print(f"   ✅ Label: {scene['label']}")
                        break

        self._save_labels(metadata, scenes, deleted_scenes)
        print(f"\n✅ Labeling completato! {labeled_count} scene labelate.")

    def _preview_scene(self, scene_id: int):
        """Apre il frame rappresentativo della scena"""
        rep_path = self.scenes_dir / f"scene_{scene_id:04d}_rep.jpg"
        if rep_path.exists():
            # Usa comando di sistema per aprire immagine
            if sys.platform == "darwin":
                os.system(f'open "{rep_path}"')
            elif sys.platform == "win32":
                os.system(f'start "" "{rep_path}"')
            else:
                os.system(f'xdg-open "{rep_path}"')
            print(f"   👁️ Aperto: {rep_path}")
        else:
            print(f"   ❌ Frame non trovato: {rep_path}")

    def _save_labels(self, metadata: Dict, scenes: List[Dict], deleted_scenes: set):
        """Salva le label aggiornate"""
        metadata["scenes"] = scenes
        metadata["deleted_scenes"] = list(deleted_scenes)
        metadata["last_labeling_date"] = datetime.now().isoformat()

        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

    def organize_labeled_frames(self):
        """
        Organizza i frame in sottocartelle per label.
        Utile per preparare il dataset per Roboflow.
        """
        if not self.metadata_file.exists():
            print("❌ Nessun metadata trovato.")
            return

        with open(self.metadata_file) as f:
            metadata = json.load(f)

        scenes = {s["scene_id"]: s for s in metadata.get("scenes", [])}
        frames = metadata.get("frames", [])
        deleted_scenes = set(metadata.get("deleted_scenes", []))

        print("\n📁 Organizzazione frame per label...")

        label_counts = defaultdict(int)

        for frame_info in frames:
            scene_id = frame_info["scene_id"]

            if scene_id in deleted_scenes:
                continue

            scene = scenes.get(scene_id, {})
            label = scene.get("label", "unlabeled")

            if not label:
                label = "unlabeled"

            # Crea cartella label
            label_dir = self.labeled_dir / label
            label_dir.mkdir(exist_ok=True)

            # Copia frame
            src = self.frames_dir / frame_info["filename"]
            dst = label_dir / frame_info["filename"]

            if src.exists():
                shutil.copy2(src, dst)
                label_counts[label] += 1

        print("\n✅ Organizzazione completata!")
        print("\n📊 Distribuzione frame:")
        for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
            print(f"   {label}: {count} frame")

        print(f"\n📁 Output: {self.labeled_dir}")

    def export_roboflow(self, project_name: Optional[str] = None):
        """
        Esporta in formato pronto per Roboflow upload.
        Crea un archivio con struttura:
        - images/
        - annotations/ (formato YOLO txt, se hai bbox)

        Per object detection, dovrai fare labeling bbox in Roboflow.
        """
        if not self.labeled_dir.exists():
            print("❌ Nessun frame organizzato. Esegui prima 'organize'.")
            return

        project = project_name or self.config.get("project_name", "project")
        export_dir = self.output_dir / f"export_{project}"
        images_dir = export_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n📦 Export per Roboflow: {project}")

        # Copia tutte le immagini con prefisso label
        total = 0
        label_counts = defaultdict(int)

        for label_dir in self.labeled_dir.iterdir():
            if not label_dir.is_dir():
                continue

            label = label_dir.name
            for img in label_dir.glob("*.jpg"):
                new_name = f"{label}_{img.name}"
                shutil.copy2(img, images_dir / new_name)
                total += 1
                label_counts[label] += 1

        # Crea file classes.txt per YOLO
        classes_file = export_dir / "classes.txt"
        unique_labels = sorted(label_counts.keys())
        with open(classes_file, 'w') as f:
            for label in unique_labels:
                if label != "unlabeled":
                    f.write(f"{label}\n")

        # Crea file di istruzioni
        readme = export_dir / "README.txt"
        with open(readme, 'w') as f:
            f.write(f"""
Roboflow Import Instructions
=============================

Project: {project}
Images: {total}
Classes: {len(unique_labels)}
Export Date: {datetime.now().isoformat()}

Classes:
{chr(10).join(f'  - {label}: {count} images' for label, count in sorted(label_counts.items()))}

Steps:
1. Go to app.roboflow.com
2. Create new project: "{project}"
3. Upload all images from 'images/' folder
4. Images are pre-named with labels: LABEL_frame_XXXX.jpg
5. Use Roboflow's labeling tool to draw bounding boxes
6. The filename prefix indicates the class

Tips:
- Use "Smart Polygon" for faster bbox creation
- Enable "Auto-label" after labeling ~20 images per class
- Export as "YOLO v8" format for training
- classes.txt contains all class names for YOLO format
""")

        print(f"✅ Esportati {total} frame in: {export_dir}")
        print(f"   Classes: {len(unique_labels)}")
        print(f"   Leggi {readme.name} per istruzioni Roboflow")

        return export_dir


def main():
    parser = argparse.ArgumentParser(
        description="Video Frame Extractor per ML Training",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Esempi:
  # Estrai frame da video
  python 10-video-frame-extractor.py extract --video highlights.mp4 --output ./dataset --fps 2

  # Labeling interattivo per scena
  python 10-video-frame-extractor.py label --input ./dataset

  # Organizza frame per label
  python 10-video-frame-extractor.py organize --input ./dataset

  # Esporta per Roboflow
  python 10-video-frame-extractor.py export --input ./dataset --project my-project

Configurazione Label:
  Modifica il file configs/labels_config.json per personalizzare le label.
  Puoi anche specificare un file config custom con --config.
        """
    )

    # Argomento globale per config
    parser.add_argument("--config", "-c", help="File configurazione label (JSON)")

    subparsers = parser.add_subparsers(dest="command", help="Comando")

    # Extract
    extract_parser = subparsers.add_parser("extract", help="Estrai frame da video")
    extract_parser.add_argument("--video", "-v", required=True, help="Percorso video input")
    extract_parser.add_argument("--output", "-o", required=True, help="Directory output")
    extract_parser.add_argument("--fps", type=float, default=2.0, help="Frame per secondo (default: 2)")
    extract_parser.add_argument("--max-frames", type=int, help="Max frame da estrarre")
    extract_parser.add_argument("--start", type=float, default=0, help="Tempo inizio (secondi)")
    extract_parser.add_argument("--end", type=float, help="Tempo fine (secondi)")
    extract_parser.add_argument("--threshold", type=float, default=0.7,
                               help="Soglia cambio scena 0-1 (default: 0.7)")

    # Label
    label_parser = subparsers.add_parser("label", help="Labeling interattivo")
    label_parser.add_argument("--input", "-i", required=True, help="Directory con frame estratti")

    # Organize
    org_parser = subparsers.add_parser("organize", help="Organizza frame per label")
    org_parser.add_argument("--input", "-i", required=True, help="Directory con frame estratti")

    # Export
    export_parser = subparsers.add_parser("export", help="Esporta per Roboflow")
    export_parser.add_argument("--input", "-i", required=True, help="Directory con frame estratti")
    export_parser.add_argument("--project", "-p", help="Nome progetto (default: da config)")

    # Init config
    init_parser = subparsers.add_parser("init", help="Crea file configurazione template")
    init_parser.add_argument("--output", "-o", help="Percorso file config output")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == "init":
        # Crea config template
        output = Path(args.output) if args.output else DEFAULT_CONFIG

        template = {
            "project_name": "my_project",
            "description": "Modifica questo file con le tue label!",
            "labels": {
                "1": "CLASS_1",
                "2": "CLASS_2",
                "3": "CLASS_3",
                "4": "CLASS_4",
                "5": "CLASS_5",
                "6": "CLASS_6",
                "7": "CLASS_7",
                "8": "CLASS_8",
                "9": "CLASS_9",
                "10": "CLASS_10"
            },
            "groups": {
                "group_a": {
                    "name": "Gruppo A",
                    "color": "#FF0000",
                    "labels": ["1", "2", "3"]
                },
                "group_b": {
                    "name": "Gruppo B",
                    "color": "#00FF00",
                    "labels": ["4", "5", "6"]
                }
            },
            "shortcuts": {
                "a": ["1", "2", "3"],
                "b": ["4", "5", "6"]
            }
        }

        output.parent.mkdir(parents=True, exist_ok=True)
        with open(output, 'w') as f:
            json.dump(template, f, indent=2)

        print(f"✅ Config template creato: {output}")
        print(f"   Modifica il file per personalizzare le label!")
        return

    config_path = args.config if hasattr(args, 'config') and args.config else None

    if args.command == "extract":
        extractor = VideoFrameExtractor(args.output, args.threshold, config_path)
        extractor.extract_frames(
            args.video,
            fps=args.fps,
            max_frames=args.max_frames,
            start_time=args.start,
            end_time=args.end
        )

    elif args.command == "label":
        extractor = VideoFrameExtractor(args.input, config_path=config_path)
        extractor.interactive_labeling()

    elif args.command == "organize":
        extractor = VideoFrameExtractor(args.input, config_path=config_path)
        extractor.organize_labeled_frames()

    elif args.command == "export":
        extractor = VideoFrameExtractor(args.input, config_path=config_path)
        extractor.export_roboflow(args.project)


if __name__ == "__main__":
    main()
