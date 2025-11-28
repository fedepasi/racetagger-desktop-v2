#!/usr/bin/env python3
"""Test Pexels API download"""

import os
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load .env
env_path = Path(__file__).parent.parent / '.env'
print(f"Loading .env from: {env_path}")
load_dotenv(env_path)

# Get API key
api_key = os.getenv('PEXELS_API_KEY')
print(f"API Key: {api_key[:10]}...")

# Test request
url = "https://api.pexels.com/v1/search"
headers = {'Authorization': api_key}
params = {'query': 'formula 1 race', 'per_page': 3}

print("\n🔍 Searching for F1 photos...")
response = requests.get(url, headers=headers, params=params, timeout=10)
print(f"Status: {response.status_code}")

if response.ok:
    data = response.json()
    photos = data.get('photos', [])
    print(f"Found {len(photos)} photos\n")

    # Download first photo
    for i, photo in enumerate(photos[:2], 1):
        img_url = photo['src']['large']
        img_id = photo['id']

        print(f"{i}. Downloading photo {img_id}...")
        img_response = requests.get(img_url, timeout=30)

        if img_response.ok:
            output_file = Path(f"/tmp/test_pexels_{img_id}.jpg")
            output_file.write_bytes(img_response.content)
            print(f"   ✅ Saved to {output_file} ({len(img_response.content)} bytes)")
        else:
            print(f"   ❌ Error: {img_response.status_code}")

    print("\n✅ Test completed successfully!")
else:
    print(f"❌ Error: {response.text}")
