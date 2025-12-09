#!/usr/bin/env python3
"""
Video Frame Labeler - Web Interface

Interfaccia web per labeling rapido di frame estratti da video.
Usa Flask per servire una pagina web interattiva.

Usage:
    python 12-video-labeler-web.py --input ./frames_output

Requisiti:
    pip install flask
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template_string, jsonify, request, send_file

# Path al file di configurazione di default
SCRIPT_DIR = Path(__file__).parent
CONFIG_DIR = SCRIPT_DIR.parent / "configs"
DEFAULT_CONFIG = CONFIG_DIR / "labels_config.json"

app = Flask(__name__)

# Variabili globali
INPUT_DIR = None
SCENES_DIR = None
METADATA_FILE = None
metadata = None
config = None


HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🏷️ Video Frame Labeler - {{ config.project_name }}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #fff;
            min-height: 100vh;
        }
        .container {
            display: flex;
            height: 100vh;
        }
        .image-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 20px;
        }
        .image-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #2a2a2a;
            border-radius: 10px;
            overflow: hidden;
        }
        .image-container img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .info-bar {
            padding: 15px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .info-bar .scene-info {
            font-size: 16px;
        }
        .info-bar .progress {
            font-size: 14px;
            color: #888;
        }
        .controls-panel {
            width: 400px;
            background: #252525;
            padding: 20px;
            overflow-y: auto;
        }
        .controls-panel h2 {
            margin-bottom: 20px;
            font-size: 18px;
        }
        .label-group {
            margin-bottom: 15px;
        }
        .group-header {
            display: inline-block;
            padding: 5px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 8px;
        }
        .label-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }
        .label-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            color: white;
            transition: transform 0.1s, opacity 0.1s;
        }
        .label-btn:hover {
            transform: scale(1.05);
            opacity: 0.9;
        }
        .label-btn:active {
            transform: scale(0.95);
        }
        .custom-label {
            margin-top: 20px;
            display: flex;
            gap: 10px;
        }
        .custom-label input {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 5px;
            background: #333;
            color: white;
            font-size: 14px;
        }
        .custom-label button {
            padding: 10px 20px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        }
        .nav-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        .nav-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }
        .nav-btn.prev { background: #555; color: white; }
        .nav-btn.skip { background: #666; color: white; }
        .nav-btn.delete { background: #c0392b; color: white; }
        .nav-btn:hover { opacity: 0.8; }
        .save-btn {
            width: 100%;
            padding: 15px;
            margin-top: 20px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
        }
        .save-btn:hover { background: #1976D2; }
        .shortcuts {
            margin-top: 20px;
            padding: 15px;
            background: #333;
            border-radius: 5px;
            font-size: 12px;
        }
        .shortcuts h3 {
            margin-bottom: 10px;
            font-size: 14px;
        }
        .shortcuts table {
            width: 100%;
        }
        .shortcuts td {
            padding: 3px 0;
        }
        .shortcuts .key {
            font-family: monospace;
            background: #444;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .stats {
            margin-top: 15px;
            padding: 10px;
            background: #333;
            border-radius: 5px;
            font-size: 12px;
        }
        .current-label {
            display: inline-block;
            padding: 5px 10px;
            background: #4CAF50;
            border-radius: 4px;
            margin-left: 10px;
        }
        .deleted-label {
            background: #c0392b;
        }
        .unlabeled {
            background: #666;
        }
        .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #4CAF50;
            color: white;
            padding: 15px 30px;
            border-radius: 5px;
            display: none;
            z-index: 1000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="image-panel">
            <div class="image-container">
                <img id="sceneImage" src="" alt="Scene">
            </div>
            <div class="info-bar">
                <div class="scene-info">
                    <span id="sceneId">Scena 0</span>
                    <span id="frameCount"></span>
                    <span id="currentLabel" class="current-label unlabeled">Non labelata</span>
                </div>
                <div class="progress">
                    <span id="progressText">0/0 (0%)</span>
                </div>
            </div>
        </div>
        <div class="controls-panel">
            <h2>🏷️ {{ config.project_name }}</h2>

            <div id="labelGroups"></div>

            <div class="custom-label">
                <input type="text" id="customLabel" placeholder="Label custom...">
                <button onclick="applyCustomLabel()">OK</button>
            </div>

            <div class="nav-buttons">
                <button class="nav-btn prev" onclick="prevScene()">◀ Prev</button>
                <button class="nav-btn skip" onclick="nextScene()">Skip ▶</button>
                <button class="nav-btn delete" onclick="deleteScene()">🗑️</button>
            </div>

            <button class="save-btn" onclick="saveAndExit()">💾 Salva</button>

            <div class="shortcuts">
                <h3>⌨️ Shortcuts</h3>
                <table>
                    <tr><td class="key">0-9</td><td>Label diretta</td></tr>
                    <tr><td class="key">← →</td><td>Naviga scene</td></tr>
                    <tr><td class="key">Space</td><td>Salta</td></tr>
                    <tr><td class="key">Del</td><td>Elimina</td></tr>
                    <tr><td class="key">S</td><td>Salva</td></tr>
                </table>
            </div>

            <div class="stats" id="stats"></div>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        let scenes = {{ scenes | tojson }};
        let labels = {{ labels | tojson }};
        let groups = {{ groups | tojson }};
        let deletedScenes = new Set({{ deleted_scenes | tojson }});
        let currentIndex = 0;

        // Trova prima scena non labelata
        function findFirstUnlabeled() {
            for (let i = 0; i < scenes.length; i++) {
                if (!scenes[i].label && !deletedScenes.has(scenes[i].scene_id)) {
                    return i;
                }
            }
            return 0;
        }

        currentIndex = findFirstUnlabeled();

        // Crea bottoni label
        function createLabelButtons() {
            const container = document.getElementById('labelGroups');
            container.innerHTML = '';

            if (Object.keys(groups).length > 0) {
                // Usa gruppi
                for (const [groupKey, groupInfo] of Object.entries(groups)) {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'label-group';

                    const header = document.createElement('span');
                    header.className = 'group-header';
                    header.style.background = groupInfo.color;
                    header.textContent = groupInfo.name;
                    groupDiv.appendChild(header);

                    const buttonsDiv = document.createElement('div');
                    buttonsDiv.className = 'label-buttons';

                    for (const labelKey of groupInfo.labels) {
                        if (labels[labelKey]) {
                            const btn = document.createElement('button');
                            btn.className = 'label-btn';
                            btn.style.background = groupInfo.color;
                            btn.textContent = `[${labelKey}] ${labels[labelKey]}`;
                            btn.onclick = () => assignLabel(labelKey);
                            buttonsDiv.appendChild(btn);
                        }
                    }

                    groupDiv.appendChild(buttonsDiv);
                    container.appendChild(groupDiv);
                }
            } else {
                // Mostra tutte le label
                const buttonsDiv = document.createElement('div');
                buttonsDiv.className = 'label-buttons';

                for (const [key, label] of Object.entries(labels)) {
                    const btn = document.createElement('button');
                    btn.className = 'label-btn';
                    btn.style.background = '#555';
                    btn.textContent = `[${key}] ${label}`;
                    btn.onclick = () => assignLabel(key);
                    buttonsDiv.appendChild(btn);
                }

                container.appendChild(buttonsDiv);
            }
        }

        function updateDisplay() {
            const scene = scenes[currentIndex];
            const sceneId = scene.scene_id;

            // Aggiorna immagine
            document.getElementById('sceneImage').src = `/scene/${sceneId}?t=${Date.now()}`;

            // Aggiorna info
            document.getElementById('sceneId').textContent = `Scena ${sceneId}/${scenes.length - 1}`;
            document.getElementById('frameCount').textContent = `| ${scene.frame_count} frame`;

            // Aggiorna label corrente
            const labelSpan = document.getElementById('currentLabel');
            if (deletedScenes.has(sceneId)) {
                labelSpan.textContent = '🗑️ Eliminata';
                labelSpan.className = 'current-label deleted-label';
            } else if (scene.label) {
                labelSpan.textContent = '🏷️ ' + scene.label;
                labelSpan.className = 'current-label';
            } else {
                labelSpan.textContent = '⏳ Non labelata';
                labelSpan.className = 'current-label unlabeled';
            }

            // Aggiorna progress
            const labeled = scenes.filter(s => s.label || deletedScenes.has(s.scene_id)).length;
            const pct = Math.round(labeled / scenes.length * 100);
            document.getElementById('progressText').textContent = `${labeled}/${scenes.length} (${pct}%)`;

            // Aggiorna stats
            updateStats();
        }

        function updateStats() {
            const counts = {};
            for (const scene of scenes) {
                if (scene.label) {
                    counts[scene.label] = (counts[scene.label] || 0) + 1;
                }
            }

            const statsText = Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([label, count]) => `${label}: ${count}`)
                .join(', ');

            document.getElementById('stats').textContent = statsText || 'Nessuna label ancora';
        }

        function assignLabel(key) {
            if (labels[key]) {
                scenes[currentIndex].label = labels[key];
                showToast(`✅ ${labels[key]}`);
                saveToServer();
                nextUnlabeled();
            }
        }

        function applyCustomLabel() {
            const input = document.getElementById('customLabel');
            const label = input.value.trim().toUpperCase();
            if (label) {
                scenes[currentIndex].label = label;
                input.value = '';
                showToast(`✅ ${label}`);
                saveToServer();
                nextUnlabeled();
            }
        }

        function nextScene() {
            if (currentIndex < scenes.length - 1) {
                currentIndex++;
                updateDisplay();
            }
        }

        function prevScene() {
            if (currentIndex > 0) {
                currentIndex--;
                updateDisplay();
            }
        }

        function deleteScene() {
            const sceneId = scenes[currentIndex].scene_id;
            deletedScenes.add(sceneId);
            showToast('🗑️ Eliminata');
            saveToServer();
            nextUnlabeled();
        }

        function nextUnlabeled() {
            for (let i = currentIndex + 1; i < scenes.length; i++) {
                if (!scenes[i].label && !deletedScenes.has(scenes[i].scene_id)) {
                    currentIndex = i;
                    updateDisplay();
                    return;
                }
            }
            updateDisplay();

            // Check completamento
            const unlabeled = scenes.filter(s => !s.label && !deletedScenes.has(s.scene_id)).length;
            if (unlabeled === 0) {
                showToast('🎉 Tutte le scene labellate!');
            }
        }

        function saveToServer() {
            fetch('/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scenes: scenes,
                    deleted_scenes: Array.from(deletedScenes)
                })
            });
        }

        function saveAndExit() {
            saveToServer();
            showToast('💾 Salvato!');
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 1500);
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                nextScene();
            } else if (e.key === 'ArrowLeft') {
                prevScene();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteScene();
            } else if (e.key.toLowerCase() === 's') {
                saveAndExit();
            } else if (labels[e.key]) {
                assignLabel(e.key);
            }
        });

        // Init
        createLabelButtons();
        updateDisplay();
    </script>
</body>
</html>
"""


def load_config_file(input_dir: Path) -> dict:
    """Carica configurazione label."""
    metadata_file = input_dir / "metadata.json"

    if metadata_file.exists():
        with open(metadata_file) as f:
            meta = json.load(f)
        if "config" in meta:
            return meta["config"]

    if DEFAULT_CONFIG.exists():
        with open(DEFAULT_CONFIG) as f:
            return json.load(f)

    return {
        "project_name": "project",
        "labels": {str(i): f"CLASS_{i}" for i in range(1, 21)},
        "groups": {},
        "shortcuts": {}
    }


@app.route('/')
def index():
    return render_template_string(
        HTML_TEMPLATE,
        config=config,
        scenes=metadata.get("scenes", []),
        labels=config.get("labels", {}),
        groups=config.get("groups", {}),
        deleted_scenes=metadata.get("deleted_scenes", [])
    )


@app.route('/scene/<int:scene_id>')
def get_scene_image(scene_id):
    img_path = SCENES_DIR / f"scene_{scene_id:04d}_rep.jpg"
    if img_path.exists():
        return send_file(img_path, mimetype='image/jpeg')
    return "Not found", 404


@app.route('/save', methods=['POST'])
def save():
    global metadata
    data = request.json

    metadata["scenes"] = data["scenes"]
    metadata["deleted_scenes"] = data["deleted_scenes"]
    metadata["last_labeling_date"] = datetime.now().isoformat()

    with open(METADATA_FILE, 'w') as f:
        json.dump(metadata, f, indent=2)

    labeled = sum(1 for s in data["scenes"] if s.get("label"))
    print(f"💾 Salvato: {labeled} scene labellate")

    return jsonify({"status": "ok"})


def main():
    global INPUT_DIR, SCENES_DIR, METADATA_FILE, metadata, config

    import argparse
    parser = argparse.ArgumentParser(description="Web GUI per labeling frame video")
    parser.add_argument("--input", "-i", required=True, help="Directory con frame estratti")
    parser.add_argument("--port", "-p", type=int, default=5000, help="Porta server (default: 5000)")

    args = parser.parse_args()

    INPUT_DIR = Path(args.input)
    SCENES_DIR = INPUT_DIR / "scenes"
    METADATA_FILE = INPUT_DIR / "metadata.json"

    if not METADATA_FILE.exists():
        print(f"❌ Metadata non trovato: {METADATA_FILE}")
        sys.exit(1)

    with open(METADATA_FILE) as f:
        metadata = json.load(f)

    config = load_config_file(INPUT_DIR)

    print(f"\n🏷️  Video Frame Labeler - Web Interface")
    print(f"=" * 50)
    print(f"📋 Progetto: {config.get('project_name', 'unknown')}")
    print(f"📸 Scene: {len(metadata.get('scenes', []))}")
    print(f"🏷️  Label: {len(config.get('labels', {}))}")
    print(f"\n🌐 Apri nel browser: http://localhost:{args.port}")
    print(f"   Premi Ctrl+C per terminare\n")

    app.run(host='0.0.0.0', port=args.port, debug=False)


if __name__ == "__main__":
    main()
