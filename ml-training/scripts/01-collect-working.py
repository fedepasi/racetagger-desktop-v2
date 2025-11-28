#!/usr/bin/env python3
"""Working data collection script - tested and functional"""

import os
import sys
import time
import requests
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Configuration
CATEGORIES = {
    'racing_action': {
        'queries': [
            'formula 1 race track car speed',
            'rally car racing dirt road action',
            'rally raid dakar race desert',
            'wrc rally racing forest jump',
        ],
        'target': 800,
    },
    'portrait_paddock': {
        'queries': [
            'formula 1 driver portrait face',
            'rally driver portrait face closeup',
            'dakar pilot portrait service area',
        ],
        'target': 400,
    },
    'podium_celebration': {
        'queries': [
            'formula 1 podium celebration winners',
            'rally podium winners celebration',
            'dakar rally finish ceremony',
        ],
        'target': 200,
    },
    'garage_pitlane': {
        'queries': [
            'formula 1 pit lane garage mechanics',
            'rally service area mechanics car',
            'dakar rally bivouac repair team',
        ],
        'target': 300,
    },
    'crowd_scene': {
        'queries': [
            'formula 1 fans crowd grandstand',
            'rally spectators watching roadside',
            'dakar rally fans crowd desert',
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

        for page in range(1, 15):  # Max 15 pages per query
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
                    print(f"  No more photos on page {page}")
                    sys.stdout.flush()
                    break

                # Download photos from this page
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
                    except Exception as e:
                        pass  # Skip failed downloads

                    time.sleep(1)  # Rate limiting

                time.sleep(1)  # Delay between pages

            except Exception as e:
                print(f"  Error on page {page}: {e}")
                sys.stdout.flush()
                time.sleep(5)
                continue

    print(f"\n✅ Collected {downloaded} images for {category}")
    sys.stdout.flush()
    return downloaded

def main():
    parser = argparse.ArgumentParser(description='Collect motorsport images')
    parser.add_argument('--source', default='pexels', help='API source (pexels only)')
    parser.add_argument('--limit', type=int, default=None, help='Max images')
    args = parser.parse_args()

    print("\n" + "="*60)
    print("🎯 RaceTagger Dataset Collection (Working Version)")
    print("="*60)
    sys.stdout.flush()

    # Load API key
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)
    api_key = os.getenv('PEXELS_API_KEY')

    if not api_key or api_key == 'your_pexels_key_here':
        print("❌ PEXELS_API_KEY not set in .env file")
        sys.exit(1)

    print(f"✅ Using source: PEXELS")
    sys.stdout.flush()

    # Output directory
    output_base = Path(__file__).parent.parent / 'f1_scenes_dataset' / 'raw'

    # Collect each category
    total_downloaded = 0

    for category, config in CATEGORIES.items():
        output_dir = output_base / category
        target = config['target']

        if args.limit:
            target = min(target, args.limit - total_downloaded)

        if target <= 0:
            break

        downloaded = collect_category(
            api_key=api_key,
            category=category,
            queries=config['queries'],
            target=target,
            output_dir=output_dir
        )

        total_downloaded += downloaded

        if args.limit and total_downloaded >= args.limit:
            break

    # Final summary
    print("\n" + "="*60)
    print("📊 Collection Complete!")
    print("="*60)
    print(f"Total images downloaded: {total_downloaded}")
    sys.stdout.flush()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Collection interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
