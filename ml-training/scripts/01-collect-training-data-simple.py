#!/usr/bin/env python3
"""
RaceTagger ML Training - Simple Dataset Collection Script

Lightweight version without heavy dependencies (NO TensorFlow import).
Collects F1/motorsport images from Pexels or Unsplash APIs.

Usage:
    python 01-collect-training-data-simple.py --source pexels --limit 1000
"""

import os
import sys
import time
import argparse
import requests
from pathlib import Path
from dotenv import load_dotenv

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

CATEGORIES = {
    'racing_action': {
        'queries': [
            'formula 1 race track car speed',
            'f1 racing action on circuit',
            'formula one car motion blur',
            'motorsport race qualifying',
        ],
        'target': 800,
    },
    'portrait_paddock': {
        'queries': [
            'formula 1 driver portrait face',
            'f1 pilot closeup paddock',
            'racing driver headshot interview',
            'motorsport driver without helmet',
        ],
        'target': 400,
    },
    'podium_celebration': {
        'queries': [
            'formula 1 podium celebration winners',
            'f1 champagne spray trophy',
            'racing podium ceremony',
            'motorsport winners celebration',
        ],
        'target': 200,
    },
    'garage_pitlane': {
        'queries': [
            'formula 1 pit lane garage mechanics',
            'f1 team working on car',
            'racing pit stop crew',
            'motorsport garage preparation',
        ],
        'target': 300,
    },
    'crowd_scene': {
        'queries': [
            'formula 1 fans crowd grandstand',
            'f1 spectators cheering',
            'racing event audience',
            'motorsport crowd watching',
        ],
        'target': 300,
    }
}

RATE_LIMIT_DELAY = 1.0  # Seconds between requests
REQUEST_TIMEOUT = 30    # HTTP timeout

# ═══════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════

def get_project_root():
    """Get ml-training directory root."""
    return Path(__file__).parent.parent


def ensure_dir(path):
    """Ensure directory exists."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def download_image(url, output_path):
    """
    Download image from URL.

    Returns:
        bool: True if successful, False otherwise
    """
    if output_path.exists():
        return False  # Already exists

    try:
        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()

        output_path.write_bytes(response.content)
        return True

    except Exception as e:
        if output_path.exists():
            output_path.unlink()  # Clean up partial download
        return False


# ═══════════════════════════════════════════════════════════════
# Pexels API
# ═══════════════════════════════════════════════════════════════

def collect_category_pexels(api_key, category, queries, target, output_dir):
    """Collect images for a category from Pexels."""

    ensure_dir(output_dir)

    print(f"\n{'='*60}")
    print(f"Collecting: {category}")
    print(f"Target: {target} images")
    print(f"{'='*60}")

    downloaded = 0
    headers = {'Authorization': api_key}
    base_url = "https://api.pexels.com/v1/search"

    for query in queries:
        if downloaded >= target:
            break

        print(f"\nQuery: \"{query}\"")
        page = 1

        while downloaded < target:
            try:
                params = {
                    'query': query,
                    'per_page': 80,
                    'page': page,
                    'orientation': 'landscape'
                }

                response = requests.get(base_url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)

                if response.status_code == 429:
                    print("  ⚠️  Rate limit hit, waiting 60 seconds...")
                    time.sleep(60)
                    continue

                response.raise_for_status()
                photos = response.json().get('photos', [])

                if not photos:
                    break  # No more results

                for photo in photos:
                    if downloaded >= target:
                        break

                    image_id = photo['id']
                    image_url = photo['src']['large']
                    output_path = output_dir / f"pexels_{image_id}.jpg"

                    if download_image(image_url, output_path):
                        downloaded += 1
                        print(f"  [{downloaded}/{target}] Downloaded {image_id}")

                    time.sleep(RATE_LIMIT_DELAY)

                page += 1
                time.sleep(RATE_LIMIT_DELAY)

            except Exception as e:
                print(f"  ⚠️  Error: {e}")
                time.sleep(5)
                continue

    print(f"\n✅ Collected {downloaded} images for {category}")
    return downloaded


# ═══════════════════════════════════════════════════════════════
# Unsplash API
# ═══════════════════════════════════════════════════════════════

def collect_category_unsplash(api_key, category, queries, target, output_dir):
    """Collect images for a category from Unsplash."""

    ensure_dir(output_dir)

    print(f"\n{'='*60}")
    print(f"Collecting: {category}")
    print(f"Target: {target} images")
    print(f"{'='*60}")

    downloaded = 0
    headers = {'Authorization': f'Client-ID {api_key}'}
    base_url = "https://api.unsplash.com/search/photos"

    for query in queries:
        if downloaded >= target:
            break

        print(f"\nQuery: \"{query}\"")
        page = 1

        while downloaded < target:
            try:
                params = {
                    'query': query,
                    'per_page': 30,
                    'page': page,
                    'orientation': 'landscape'
                }

                response = requests.get(base_url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)

                if response.status_code == 429:
                    print("  ⚠️  Rate limit hit, waiting 1 hour...")
                    time.sleep(3600)
                    continue

                response.raise_for_status()
                photos = response.json().get('results', [])

                if not photos:
                    break

                for photo in photos:
                    if downloaded >= target:
                        break

                    image_id = photo['id']
                    image_url = photo['urls']['regular']
                    output_path = output_dir / f"unsplash_{image_id}.jpg"

                    if download_image(image_url, output_path):
                        downloaded += 1
                        print(f"  [{downloaded}/{target}] Downloaded {image_id}")

                    time.sleep(RATE_LIMIT_DELAY)

                page += 1
                time.sleep(RATE_LIMIT_DELAY)

            except Exception as e:
                print(f"  ⚠️  Error: {e}")
                time.sleep(5)
                continue

    print(f"\n✅ Collected {downloaded} images for {category}")
    return downloaded


# ═══════════════════════════════════════════════════════════════
# Main Collection Function
# ═══════════════════════════════════════════════════════════════

def collect_dataset(source='pexels', limit=None):
    """
    Main collection function.

    Args:
        source: 'pexels' or 'unsplash'
        limit: Maximum total images to collect
    """

    print("\n" + "="*60)
    print("🎯 RaceTagger Dataset Collection (Simple)")
    print("="*60)

    # Load API key
    env_path = get_project_root() / '.env'
    load_dotenv(env_path)

    if source == 'pexels':
        api_key = os.getenv('PEXELS_API_KEY')
        if not api_key or api_key == 'your_pexels_key_here':
            print("❌ PEXELS_API_KEY not set in .env file")
            sys.exit(1)
        collect_fn = collect_category_pexels

    elif source == 'unsplash':
        api_key = os.getenv('UNSPLASH_API_KEY')
        if not api_key or api_key == 'your_unsplash_key_here':
            print("❌ UNSPLASH_API_KEY not set in .env file")
            sys.exit(1)
        collect_fn = collect_category_unsplash

    else:
        print(f"❌ Unknown source: {source}")
        sys.exit(1)

    print(f"✅ Using source: {source.upper()}")

    # Output directory
    output_base = get_project_root() / 'f1_scenes_dataset' / 'raw'

    # Collect each category
    total_downloaded = 0

    for category, config in CATEGORIES.items():
        output_dir = output_base / category

        target = config['target']
        if limit:
            target = min(target, limit - total_downloaded)

        if target <= 0:
            break

        downloaded = collect_fn(
            api_key=api_key,
            category=category,
            queries=config['queries'],
            target=target,
            output_dir=output_dir
        )

        total_downloaded += downloaded

        if limit and total_downloaded >= limit:
            break

    # Final summary
    print("\n" + "="*60)
    print("📊 Collection Complete!")
    print("="*60)
    print(f"Total images downloaded: {total_downloaded}")

    print("\n🚀 Next Steps:")
    print("1. Check downloaded images:")
    print(f"   ls -R {output_base}")
    print("2. Run preprocessing:")
    print("   python scripts/02-prepare-dataset.py")


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Collect F1 training dataset (simple version)'
    )

    parser.add_argument(
        '--source',
        choices=['unsplash', 'pexels'],
        default='pexels',
        help='API source to use (default: pexels)'
    )

    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Maximum total images to collect'
    )

    args = parser.parse_args()

    try:
        collect_dataset(source=args.source, limit=args.limit)
    except KeyboardInterrupt:
        print("\n\n⚠️  Collection interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
