#!/usr/bin/env python3
"""
Video Frame Labeler GUI

Interfaccia grafica per labeling rapido di frame estratti da video.
Mostra i frame rappresentativi di ogni scena e permette labeling veloce
con tasti numerici o click su bottoni.

Le label sono configurate dinamicamente da:
1. Il file metadata.json (config salvato durante l'estrazione)
2. Oppure configs/labels_config.json

Usage:
    python 11-video-labeler-gui.py --input ./frames_output

Requisiti:
    pip install opencv-python pillow
"""

import os
import sys
import json
import shutil
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from pathlib import Path
from PIL import Image, ImageTk
from typing import Dict, List, Optional
from datetime import datetime


# Path al file di configurazione di default
SCRIPT_DIR = Path(__file__).parent
CONFIG_DIR = SCRIPT_DIR.parent / "configs"
DEFAULT_CONFIG = CONFIG_DIR / "labels_config.json"


def load_config(input_dir: Path) -> Dict:
    """
    Carica configurazione label.
    Prima prova dal metadata.json, poi dal config di default.
    """
    metadata_file = input_dir / "metadata.json"

    if metadata_file.exists():
        with open(metadata_file) as f:
            metadata = json.load(f)

        if "config" in metadata:
            print(f"📋 Config caricato da metadata.json")
            return metadata["config"]

    # Fallback al config di default
    if DEFAULT_CONFIG.exists():
        with open(DEFAULT_CONFIG) as f:
            config = json.load(f)
        print(f"📋 Config caricato da {DEFAULT_CONFIG}")
        return config

    # Config minimale
    return {
        "project_name": "project",
        "labels": {str(i): f"CLASS_{i}" for i in range(1, 21)},
        "groups": {},
        "shortcuts": {}
    }


class VideoLabelerGUI:
    """GUI per labeling rapido di scene video con config dinamico"""

    def __init__(self, input_dir: str):
        self.input_dir = Path(input_dir)
        self.scenes_dir = self.input_dir / "scenes"
        self.metadata_file = self.input_dir / "metadata.json"

        self.metadata = None
        self.scenes = []
        self.current_index = 0
        self.deleted_scenes = set()

        # Load data e config
        self._load_metadata()
        self.config = load_config(self.input_dir)
        self.labels = self.config.get("labels", {})
        self.groups = self.config.get("groups", {})
        self.shortcuts = self.config.get("shortcuts", {})

        # Setup GUI
        self.root = tk.Tk()
        self.root.title(f"🏷️ Video Frame Labeler - {self.config.get('project_name', 'Project')}")
        self.root.geometry("1400x900")
        self.root.configure(bg="#1a1a1a")

        # Bind keyboard
        self.root.bind("<Key>", self._on_key)
        self.root.bind("<Left>", lambda e: self._prev_scene())
        self.root.bind("<Right>", lambda e: self._next_scene())
        self.root.bind("<Delete>", lambda e: self._delete_scene())
        self.root.bind("<BackSpace>", lambda e: self._delete_scene())
        self.root.bind("<space>", lambda e: self._skip_scene())
        self.root.bind("<Escape>", lambda e: self._save_and_exit())

        self._setup_ui()
        self._update_display()

    def _load_metadata(self):
        """Carica metadata dell'estrazione"""
        if not self.metadata_file.exists():
            raise FileNotFoundError(f"Metadata non trovato: {self.metadata_file}")

        with open(self.metadata_file) as f:
            self.metadata = json.load(f)

        self.scenes = self.metadata.get("scenes", [])
        self.deleted_scenes = set(self.metadata.get("deleted_scenes", []))

        # Trova prima scena non labelata
        for i, scene in enumerate(self.scenes):
            if not scene.get("label") and scene["scene_id"] not in self.deleted_scenes:
                self.current_index = i
                break

    def _setup_ui(self):
        """Configura l'interfaccia"""
        # Style
        style = ttk.Style()
        style.theme_use('clam')

        # Main container
        main = ttk.Frame(self.root)
        main.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Left panel - Image
        left_frame = ttk.Frame(main)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Image canvas
        self.canvas = tk.Canvas(left_frame, bg="#2a2a2a", highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)

        # Info bar sotto immagine
        info_frame = ttk.Frame(left_frame)
        info_frame.pack(fill=tk.X, pady=(10, 0))

        self.info_label = ttk.Label(
            info_frame,
            text="",
            font=("Helvetica", 14)
        )
        self.info_label.pack(side=tk.LEFT)

        self.progress_label = ttk.Label(
            info_frame,
            text="",
            font=("Helvetica", 12)
        )
        self.progress_label.pack(side=tk.RIGHT)

        # Right panel - Controls
        right_frame = ttk.Frame(main, width=420)
        right_frame.pack(side=tk.RIGHT, fill=tk.Y, padx=(20, 0))
        right_frame.pack_propagate(False)

        # Title
        title = ttk.Label(
            right_frame,
            text=f"🏷️ {self.config.get('project_name', 'Labeling')}",
            font=("Helvetica", 16, "bold")
        )
        title.pack(pady=(0, 15))

        # Scrollable frame per i bottoni label
        canvas_frame = tk.Canvas(right_frame, bg="#2a2a2a", highlightthickness=0, height=500)
        scrollbar = ttk.Scrollbar(right_frame, orient="vertical", command=canvas_frame.yview)
        scrollable_frame = ttk.Frame(canvas_frame)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas_frame.configure(scrollregion=canvas_frame.bbox("all"))
        )

        canvas_frame.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas_frame.configure(yscrollcommand=scrollbar.set)

        # Crea bottoni per gruppi o label dirette
        self.label_buttons = {}

        if self.groups:
            # Usa gruppi se definiti
            for group_key, group_info in self.groups.items():
                if isinstance(group_info, dict):
                    group_name = group_info.get("name", group_key)
                    group_color = group_info.get("color", "#666666")
                    group_labels = group_info.get("labels", [])

                    # Group header
                    group_frame = ttk.Frame(scrollable_frame)
                    group_frame.pack(fill=tk.X, pady=5)

                    group_label = tk.Label(
                        group_frame,
                        text=group_name,
                        bg=group_color,
                        fg="white",
                        font=("Helvetica", 10, "bold"),
                        width=15
                    )
                    group_label.pack(side=tk.LEFT, padx=(0, 10))

                    # Label buttons nel gruppo
                    for key in group_labels:
                        if key in self.labels:
                            label_name = self.labels[key]
                            btn = tk.Button(
                                group_frame,
                                text=f"[{key}] {label_name}",
                                bg=group_color,
                                fg="white",
                                font=("Helvetica", 9),
                                width=18,
                                command=lambda k=key: self._assign_label(k),
                                relief=tk.FLAT,
                                cursor="hand2"
                            )
                            btn.pack(side=tk.LEFT, padx=2)
                            self.label_buttons[key] = btn
        else:
            # Mostra tutte le label in griglia
            row_frame = None
            for i, (key, label_name) in enumerate(sorted(self.labels.items())):
                if i % 3 == 0:
                    row_frame = ttk.Frame(scrollable_frame)
                    row_frame.pack(fill=tk.X, pady=2)

                btn = tk.Button(
                    row_frame,
                    text=f"[{key}] {label_name}",
                    bg="#444444",
                    fg="white",
                    font=("Helvetica", 9),
                    width=18,
                    command=lambda k=key: self._assign_label(k),
                    relief=tk.FLAT,
                    cursor="hand2"
                )
                btn.pack(side=tk.LEFT, padx=2)
                self.label_buttons[key] = btn

        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Separator
        ttk.Separator(right_frame, orient=tk.HORIZONTAL).pack(fill=tk.X, pady=15)

        # Action buttons
        actions_frame = ttk.Frame(right_frame)
        actions_frame.pack(fill=tk.X)

        # Custom label
        custom_frame = ttk.Frame(actions_frame)
        custom_frame.pack(fill=tk.X, pady=5)

        ttk.Label(custom_frame, text="Custom:").pack(side=tk.LEFT)
        self.custom_entry = ttk.Entry(custom_frame, width=20)
        self.custom_entry.pack(side=tk.LEFT, padx=5)
        self.custom_entry.bind("<Return>", lambda e: self._assign_custom())

        ttk.Button(
            custom_frame,
            text="Applica",
            command=self._assign_custom
        ).pack(side=tk.LEFT)

        # Navigation
        nav_frame = ttk.Frame(actions_frame)
        nav_frame.pack(fill=tk.X, pady=15)

        ttk.Button(nav_frame, text="◀ Prev", command=self._prev_scene, width=10).pack(side=tk.LEFT)
        ttk.Button(nav_frame, text="Skip ▶", command=self._skip_scene, width=10).pack(side=tk.LEFT, padx=10)
        ttk.Button(nav_frame, text="🗑️ Delete", command=self._delete_scene, width=10).pack(side=tk.LEFT)

        # Save & Exit
        ttk.Button(
            actions_frame,
            text="💾 Salva ed Esci",
            command=self._save_and_exit
        ).pack(fill=tk.X, pady=15)

        # Keyboard shortcuts help
        help_frame = ttk.LabelFrame(right_frame, text="⌨️ Shortcuts")
        help_frame.pack(fill=tk.X, pady=10)

        shortcuts = [
            ("1-9, a-z", "Label diretta"),
            ("← →", "Naviga scene"),
            ("Space", "Salta"),
            ("Del", "Elimina"),
            ("Esc", "Salva ed esci"),
        ]

        for key, desc in shortcuts:
            row = ttk.Frame(help_frame)
            row.pack(fill=tk.X, padx=5, pady=2)
            ttk.Label(row, text=key, font=("Courier", 10)).pack(side=tk.LEFT)
            ttk.Label(row, text=desc, font=("Helvetica", 9)).pack(side=tk.RIGHT)

        # Stats
        self.stats_label = ttk.Label(right_frame, text="", font=("Helvetica", 10))
        self.stats_label.pack(side=tk.BOTTOM, pady=10)

    def _update_display(self):
        """Aggiorna visualizzazione scena corrente"""
        if not self.scenes:
            return

        scene = self.scenes[self.current_index]
        scene_id = scene["scene_id"]

        # Load image
        img_path = self.scenes_dir / f"scene_{scene_id:04d}_rep.jpg"
        if img_path.exists():
            img = Image.open(img_path)

            # Resize to fit canvas
            canvas_w = self.canvas.winfo_width() or 900
            canvas_h = self.canvas.winfo_height() or 600

            ratio = min(canvas_w / img.width, canvas_h / img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

            self.photo = ImageTk.PhotoImage(img)
            self.canvas.delete("all")
            self.canvas.create_image(
                canvas_w // 2, canvas_h // 2,
                image=self.photo, anchor=tk.CENTER
            )

        # Update info
        label = scene.get("label", "")
        status = "🏷️ " + label if label else "⏳ Non labelata"
        if scene_id in self.deleted_scenes:
            status = "🗑️ Eliminata"

        frame_count = scene.get("frame_count", 0)
        duration = (scene.get("end_timestamp_ms", 0) - scene.get("start_timestamp_ms", 0)) / 1000

        self.info_label.config(text=f"Scena {scene_id} | {frame_count} frame | {duration:.1f}s | {status}")

        # Progress
        labeled = sum(1 for s in self.scenes if s.get("label") or s["scene_id"] in self.deleted_scenes)
        total = len(self.scenes)
        self.progress_label.config(text=f"{labeled}/{total} ({labeled/total*100:.0f}%)")

        # Stats
        label_counts = {}
        for s in self.scenes:
            if s.get("label"):
                label_counts[s["label"]] = label_counts.get(s["label"], 0) + 1

        stats_text = "📊 " + ", ".join(f"{l}:{c}" for l, c in sorted(label_counts.items())[:6])
        self.stats_label.config(text=stats_text if label_counts else "📊 Nessuna label ancora")

    def _on_key(self, event):
        """Handle keyboard input"""
        key = event.char

        # Ignora tasti speciali
        if not key or event.keysym in ['Left', 'Right', 'Delete', 'BackSpace', 'space', 'Escape']:
            return

        # Prova come chiave label
        if key in self.labels:
            self._assign_label(key)
        elif key.upper() in self.labels:
            self._assign_label(key.upper())

    def _assign_label(self, label_key: str):
        """Assegna label alla scena corrente"""
        if label_key in self.labels:
            label_name = self.labels[label_key]
            self.scenes[self.current_index]["label"] = label_name
            print(f"✅ Scena {self.current_index}: {label_name}")
            self._next_unlabeled()

    def _assign_custom(self):
        """Assegna label custom"""
        label = self.custom_entry.get().strip().upper()
        if label:
            self.scenes[self.current_index]["label"] = label
            self.custom_entry.delete(0, tk.END)
            print(f"✅ Scena {self.current_index}: {label} (custom)")
            self._next_unlabeled()

    def _next_scene(self):
        """Vai alla prossima scena"""
        if self.current_index < len(self.scenes) - 1:
            self.current_index += 1
            self._update_display()

    def _prev_scene(self):
        """Vai alla scena precedente"""
        if self.current_index > 0:
            self.current_index -= 1
            self._update_display()

    def _skip_scene(self):
        """Salta la scena corrente"""
        self._next_scene()

    def _delete_scene(self):
        """Marca scena come eliminata"""
        scene_id = self.scenes[self.current_index]["scene_id"]
        self.deleted_scenes.add(scene_id)
        print(f"🗑️ Scena {scene_id} eliminata")
        self._next_unlabeled()

    def _next_unlabeled(self):
        """Vai alla prossima scena non labelata"""
        for i in range(self.current_index + 1, len(self.scenes)):
            scene = self.scenes[i]
            if not scene.get("label") and scene["scene_id"] not in self.deleted_scenes:
                self.current_index = i
                self._update_display()
                return

        # Se non ci sono altre scene, resta qui
        self._update_display()

        # Check if all done
        unlabeled = sum(
            1 for s in self.scenes
            if not s.get("label") and s["scene_id"] not in self.deleted_scenes
        )
        if unlabeled == 0:
            messagebox.showinfo("🎉 Completato!", "Tutte le scene sono state labellate!")

    def _save_and_exit(self):
        """Salva e chiudi"""
        self._save()
        self.root.destroy()

    def _save(self):
        """Salva metadata"""
        self.metadata["scenes"] = self.scenes
        self.metadata["deleted_scenes"] = list(self.deleted_scenes)
        self.metadata["last_labeling_date"] = datetime.now().isoformat()

        with open(self.metadata_file, 'w') as f:
            json.dump(self.metadata, f, indent=2)

        labeled = sum(1 for s in self.scenes if s.get("label"))
        deleted = len(self.deleted_scenes)
        print(f"💾 Salvato: {labeled} labelate, {deleted} eliminate")

    def run(self):
        """Avvia la GUI"""
        self.root.mainloop()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="GUI per labeling frame video")
    parser.add_argument("--input", "-i", required=True, help="Directory con frame estratti")

    args = parser.parse_args()

    try:
        app = VideoLabelerGUI(args.input)
        app.run()
    except FileNotFoundError as e:
        print(f"❌ Errore: {e}")
        print("Assicurati di aver prima eseguito l'estrazione con:")
        print("  python 10-video-frame-extractor.py extract --video video.mp4 --output ./frames")
        sys.exit(1)


if __name__ == "__main__":
    main()
