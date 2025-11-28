#!/usr/bin/env python3
"""Collect only missing categories - optimized version"""

import os
import sys
import time
import requests
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Only missing categories
CATEGORIES = {
    'podium_celebration': {
        'queries': [
            'formula 1 podium celebration winners',
            'rally podium winners celebration',
            'dakar rally finish ceremony',
            'wrc podium champagne trophy',
            'motorsport winners trophy celebration',
        ],
        'target': 200,
    },
    'garage_pitlane': {
        'queries': [
            'formula 1 pit lane garage mechanics',
            'rally service area mechanics car',
            'dakar rally bivouac repair team',
            'wrc service park mechanics working',
            'motorsport pit crew garage',
        ],
        'target': 300,
    },
    'crowd_scene': {
        'queries': [
            'formula 1 fans crowd grandstand',
            'rally spectators watching roadside',
            'dakar rally fans crowd desert',
            'wrc rally fans forest watching',
            'motorsport spectators grandstand',
        ],
        'target': 300,
    }
}

def collect_category(api_key, category, queries, target, output_dir):
    """Collect images for a category"""
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Collecting: {category}")
    print(f"Target: {target} images")
    print(f"{'='*60}")
    sys.stdout.flush()

    downloaded = 0
    headers = {'Authorization': api_key}
    base_url = "https://api.pexels.com/v1/search"

    for query in queries:
        if downloaded >= target:
            break

        print(f"\nQuery: \"{query}\"")
        sys.stdout.flush()

        for page in range(1, 20):
            if downloaded >= target:
                break

            try:
                params = {
                    'query': query,
                    'per_page': 30,
                    'page': page,
                    'orientation': 'landscape'
                }

                response = requests.get(base_url, headers=headers, params=params, timeout=30)

                if response.status_code == 429:
                    print("  ⚠️  Rate limit, waiting 60s...")
                    sys.stdout.flush()
                    time.sleep(60)
                    continue

                response.raise_for_status()
                photos = response.json().get('photos', [])

                if not photos:
                    break

                for photo in photos:
                    if downloaded >= target:
                        break

                    image_id = photo['id']
                    image_url = photo['src']['large']
                    output_path = output_dir / f"pexels_{image_id}.jpg"

                    if output_path.exists():
                        continue

                    try:
                        img_response = requests.get(image_url, timeout=15)
                        img_response.raise_for_status()
                        output_path.write_bytes(img_response.content)
                        downloaded += 1
                        print(f"  [{downloaded}/{target}] Downloaded {image_id}")
                        sys.stdout.flush()
                    except:
                        pass

                    time.sleep(1)

                time.sleep(1)

            except Exception as e:
                print(f"  Error: {e}")
                sys.stdout.flush()
                time.sleep(5)

    print(f"\n✅ Collected {downloaded} images for {category}")
    sys.stdout.flush()
    return downloaded

def main():
    print("\n" + "="*60)
    print("🎯 RaceTagger - Missing Categories Collection")
    print("="*60)
    sys.stdout.flush()

    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
    api_key = os.getenv('PEXELS_API_KEY')

    if not api_key:
        print("❌ PEXELS_API_KEY not set")
        sys.exit(1)

    print(f"✅ Using source: PEXELS")
    sys.stdout.flush()

    output_base = Path(__file__).parent.parent / 'f1_scenes_dataset' / 'raw'
    total_downloaded = 0

    for category, config in CATEGORIES.items():
        output_dir = output_base / category
        downloaded = collect_category(
            api_key=api_key,
            category=category,
            queries=config['queries'],
            target=config['target'],
            output_dir=output_dir
        )
        total_downloaded += downloaded

    print("\n" + "="*60)
    print("📊 Collection Complete!")
    print("="*60)
    print(f"Total images downloaded: {total_downloaded}")
    sys.stdout.flush()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
