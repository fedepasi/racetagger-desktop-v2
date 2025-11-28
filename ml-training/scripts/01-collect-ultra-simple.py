#!/usr/bin/env python3
"""Ultra-simple collection test - minimal version"""

import os
import sys
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load API key
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)
api_key = os.getenv('PEXELS_API_KEY')

print("Starting ultra-simple collection...")
print(f"API key: {api_key[:20]}...")
sys.stdout.flush()

# Output directory
output_dir = Path(__file__).parent.parent / 'f1_scenes_dataset' / 'raw' / 'racing_action'
output_dir.mkdir(parents=True, exist_ok=True)

downloaded = 0
target = 50
query = "formula 1 race"

print(f"\nTarget: {target} images")
print(f"Query: {query}\n")
sys.stdout.flush()

# Make API request
url = "https://api.pexels.com/v1/search"
headers = {'Authorization': api_key}
params = {'query': query, 'per_page': 30, 'page': 1}

print("Making API request...")
sys.stdout.flush()

response = requests.get(url, headers=headers, params=params, timeout=30)
print(f"API response: {response.status_code}")
sys.stdout.flush()

photos = response.json().get('photos', [])
print(f"Found {len(photos)} photos")
sys.stdout.flush()

# Download each photo
for i, photo in enumerate(photos):
    if downloaded >= target:
        break

    image_id = photo['id']
    image_url = photo['src']['large']
    output_path = output_dir / f"pexels_{image_id}.jpg"

    if output_path.exists():
        print(f"  [{i+1}] Skip {image_id} (exists)")
        sys.stdout.flush()
        continue

    print(f"  [{i+1}] Downloading {image_id}...")
    sys.stdout.flush()

    try:
        img_response = requests.get(image_url, timeout=15)
        img_response.raise_for_status()
        output_path.write_bytes(img_response.content)
        downloaded += 1
        print(f"  [{downloaded}/{target}] ✅ Downloaded {image_id}")
        sys.stdout.flush()
    except Exception as e:
        print(f"  ❌ Failed: {e}")
        sys.stdout.flush()

    time.sleep(1)

print(f"\n✅ Done! Downloaded {downloaded} new images")
