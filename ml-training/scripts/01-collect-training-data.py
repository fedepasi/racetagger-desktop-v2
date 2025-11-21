#!/usr/bin/env python3
"""
RaceTagger ML Training - Dataset Collection Script

Collects F1/motorsport images from public APIs for training the scene classifier.

Supported sources:
- Unsplash API (free, 50 req/hour)
- Pexels API (free, 200 req/hour)
- Flickr API (Creative Commons)

Usage:
    python 01-collect-training-data.py [--source unsplash|pexels] [--limit 2000]
"""

import os
import sys
import time
import argparse
import requests
from pathlib import Path
from typing import List, Dict, Optional
from dotenv import load_dotenv
from utils import (
    get_project_root,
    get_dataset_path,
    ensure_dir,
    ProgressLogger,
    validate_image_file,
    compute_image_hash,
    print_dataset_stats
)

# Load environment variables
load_dotenv(get_project_root() / '.env')

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
        'target': 800,  # 40% of total
        'description': 'Cars in action on track'
    },
    'portrait_paddock': {
        'queries': [
            'formula 1 driver portrait face',
            'f1 pilot closeup paddock',
            'racing driver headshot interview',
            'motorsport driver without helmet',
        ],
        'target': 400,  # 20% of total
        'description': 'Driver portraits/closeups'
    },
    'podium_celebration': {
        'queries': [
            'formula 1 podium celebration winners',
            'f1 champagne spray trophy',
            'racing podium ceremony',
            'motorsport winners celebration',
        ],
        'target': 200,  # 10% of total
        'description': 'Podium celebrations'
    },
    'garage_pitlane': {
        'queries': [
            'formula 1 pit lane garage mechanics',
            'f1 team working on car',
            'racing pit stop crew',
            'motorsport garage preparation',
        ],
        'target': 300,  # 15% of total
        'description': 'Garage/pit lane scenes'
    },
    'crowd_scene': {
        'queries': [
            'formula 1 fans crowd grandstand',
            'f1 spectators cheering',
            'racing event audience',
            'motorsport crowd watching',
        ],
        'target': 300,  # 15% of total
        'description': 'Crowd/spectator scenes'
    }
}

# Rate limiting
RATE_LIMIT_DELAY = 1.0  # Seconds between requests
RETRY_DELAY = 5.0       # Seconds to wait on rate limit error
MAX_RETRIES = 3

# ═══════════════════════════════════════════════════════════════
# Unsplash API
# ═══════════════════════════════════════════════════════════════

class UnsplashCollector:
    """Collect images from Unsplash API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.unsplash.com"
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Client-ID {api_key}'
        })

    def search_photos(
        self,
        query: str,
        per_page: int = 30,
        page: int = 1
    ) -> List[Dict]:
        """Search photos on Unsplash."""

        url = f"{self.base_url}/search/photos"
        params = {
            'query': query,
            'per_page': per_page,
            'page': page,
            'orientation': 'landscape'
        }

        response = self.session.get(url, params=params)

        if response.status_code == 429:  # Rate limit
            raise Exception("Rate limit exceeded. Wait 1 hour.")

        response.raise_for_status()
        return response.json().get('results', [])

    def download_image(
        self,
        photo: Dict,
        output_path: Path
    ) -> bool:
        """Download image from Unsplash."""

        try:
            # Use 'regular' size (~1080px)
            image_url = photo['urls']['regular']
            image_id = photo['id']

            # Skip if already exists
            if output_path.exists():
                return False

            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            output_path.write_bytes(response.content)

            # Verify image is valid
            if not validate_image_file(str(output_path)):
                output_path.unlink()
                return False

            return True

        except Exception as e:
            print(f"\n  Error downloading {photo.get('id', 'unknown')}: {e}")
            if output_path.exists():
                output_path.unlink()
            return False

    def collect_category(
        self,
        category: str,
        queries: List[str],
        target: int,
        output_dir: Path
    ) -> int:
        """Collect images for a category."""

        ensure_dir(output_dir)

        print(f"\n{'='*60}")
        print(f"Collecting: {category}")
        print(f"Target: {target} images")
        print(f"{'='*60}")

        downloaded = 0
        images_per_query = target // len(queries)

        for query in queries:
            print(f"\nQuery: \"{query}\"")
            page = 1

            while downloaded < target:
                try:
                    photos = self.search_photos(query, per_page=30, page=page)

                    if not photos:
                        break

                    for photo in photos:
                        if downloaded >= target:
                            break

                        image_id = photo['id']
                        output_path = output_dir / f"unsplash_{image_id}.jpg"

                        if self.download_image(photo, output_path):
                            downloaded += 1
                            print(f"  [{downloaded}/{target}] Downloaded {image_id}")

                        time.sleep(RATE_LIMIT_DELAY)

                    page += 1
                    time.sleep(RATE_LIMIT_DELAY)

                except Exception as e:
                    print(f"\n⚠️  Error: {e}")
                    time.sleep(RETRY_DELAY)
                    continue

        print(f"\n✅ Collected {downloaded} images for {category}")
        return downloaded


# ═══════════════════════════════════════════════════════════════
# Pexels API
# ═══════════════════════════════════════════════════════════════

class PexelsCollector:
    """Collect images from Pexels API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.pexels.com/v1"
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': api_key
        })

    def search_photos(
        self,
        query: str,
        per_page: int = 80,
        page: int = 1
    ) -> List[Dict]:
        """Search photos on Pexels."""

        url = f"{self.base_url}/search"
        params = {
            'query': query,
            'per_page': per_page,
            'page': page,
            'orientation': 'landscape'
        }

        response = self.session.get(url, params=params)

        if response.status_code == 429:  # Rate limit
            raise Exception("Rate limit exceeded. Wait 1 minute.")

        response.raise_for_status()
        return response.json().get('photos', [])

    def download_image(
        self,
        photo: Dict,
        output_path: Path
    ) -> bool:
        """Download image from Pexels."""

        try:
            # Use 'large' size (~1280px)
            image_url = photo['src']['large']
            image_id = photo['id']

            if output_path.exists():
                return False

            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            output_path.write_bytes(response.content)

            if not validate_image_file(str(output_path)):
                output_path.unlink()
                return False

            return True

        except Exception as e:
            print(f"\n  Error downloading {photo.get('id', 'unknown')}: {e}")
            if output_path.exists():
                output_path.unlink()
            return False

    def collect_category(
        self,
        category: str,
        queries: List[str],
        target: int,
        output_dir: Path
    ) -> int:
        """Collect images for a category."""

        ensure_dir(output_dir)

        print(f"\n{'='*60}")
        print(f"Collecting: {category}")
        print(f"Target: {target} images")
        print(f"{'='*60}")

        downloaded = 0

        for query in queries:
            print(f"\nQuery: \"{query}\"")
            page = 1

            while downloaded < target:
                try:
                    photos = self.search_photos(query, per_page=80, page=page)

                    if not photos:
                        break

                    for photo in photos:
                        if downloaded >= target:
                            break

                        image_id = photo['id']
                        output_path = output_dir / f"pexels_{image_id}.jpg"

                        if self.download_image(photo, output_path):
                            downloaded += 1
                            print(f"  [{downloaded}/{target}] Downloaded {image_id}")

                        time.sleep(RATE_LIMIT_DELAY)

                    page += 1
                    time.sleep(RATE_LIMIT_DELAY)

                except Exception as e:
                    print(f"\n⚠️  Error: {e}")
                    time.sleep(RETRY_DELAY)
                    continue

        print(f"\n✅ Collected {downloaded} images for {category}")
        return downloaded


# ═══════════════════════════════════════════════════════════════
# Main Collection Function
# ═══════════════════════════════════════════════════════════════

def collect_dataset(source: str = 'unsplash', limit: Optional[int] = None):
    """
    Collect dataset from specified source.

    Args:
        source: 'unsplash' or 'pexels'
        limit: Optional limit on total images to collect
    """

    print("\n" + "="*60)
    print("🎯 RaceTagger Dataset Collection")
    print("="*60)

    # Check API keys
    if source == 'unsplash':
        api_key = os.getenv('UNSPLASH_API_KEY')
        if not api_key or api_key == 'your_unsplash_key_here':
            print("❌ UNSPLASH_API_KEY not set in .env file")
            print("   Get a free key: https://unsplash.com/developers")
            sys.exit(1)
        collector = UnsplashCollector(api_key)

    elif source == 'pexels':
        api_key = os.getenv('PEXELS_API_KEY')
        if not api_key or api_key == 'your_pexels_key_here':
            print("❌ PEXELS_API_KEY not set in .env file")
            print("   Get a free key: https://www.pexels.com/api/")
            sys.exit(1)
        collector = PexelsCollector(api_key)

    else:
        print(f"❌ Unknown source: {source}")
        sys.exit(1)

    print(f"✅ Using source: {source.upper()}")

    # Output directory
    output_base = get_dataset_path('raw')

    # Collect each category
    total_downloaded = 0

    for category, config in CATEGORIES.items():
        output_dir = output_base / category

        target = config['target']
        if limit:
            target = min(target, limit - total_downloaded)

        if target <= 0:
            break

        downloaded = collector.collect_category(
            category=category,
            queries=config['queries'],
            target=target,
            output_dir=output_dir
        )

        total_downloaded += downloaded

        if limit and total_downloaded >= limit:
            break

    # Print final statistics
    print("\n" + "="*60)
    print("📊 Collection Complete!")
    print("="*60)

    print_dataset_stats(output_base)

    print("\n🚀 Next Steps:")
    print("1. Review downloaded images")
    print("2. Run preprocessing: python scripts/02-prepare-dataset.py")


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Collect F1 training dataset from public APIs'
    )

    parser.add_argument(
        '--source',
        choices=['unsplash', 'pexels'],
        default='unsplash',
        help='API source to use (default: unsplash)'
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
        sys.exit(1)


if __name__ == '__main__':
    main()
