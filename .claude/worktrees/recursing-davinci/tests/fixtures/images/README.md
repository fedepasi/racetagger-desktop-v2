# Test Image Fixtures

This directory contains sample images for automated testing.

## Committed Files (Small, in git)

These files are small enough to be committed directly to the repository:

### Standard Images
- **sample.jpg** (200KB) - Basic JPEG test file with EXIF data
- **motorsport-track.jpg** - Track/circuit scene for scene classifier testing
- **paddock.jpg** - Paddock/pit area scene
- **podium.jpg** - Podium/ceremony scene
- **portrait.jpg** - Close-up portrait scene
- **race-numbers.jpg** - Image with visible race numbers for object detection
- **multi-subjects.jpg** - Multiple subjects for segmentation testing

### RAW Files (Small Samples)
- **sample-small.nef** (5MB) - Minimal Nikon NEF file
- **sample.cr2** (4MB) - Canon CR2 RAW file

## On-Demand Downloads (Large files)

These files are downloaded when needed using `npm run download-test-files`:

- **high-res-canon.jpg** - High-resolution Canon JPEG with full EXIF
- **high-res-nikon.jpg** - Nikon JPEG with comprehensive metadata

## Adding Your Own Test Files

For testing with your own RAW files:

1. Place files in this directory
2. Add to `.gitignore` if large (>5MB)
3. Update test files to use your samples

### Recommended Test Files

- **NEF (Nikon)**: Any recent Nikon RAW file
- **CR2/CR3 (Canon)**: Canon DSLR/mirrorless RAW
- **ARW (Sony)**: Sony Alpha series RAW
- **ORF (Olympus)**: Olympus/OM System RAW
- **DNG (Adobe)**: Universal DNG format

## File Sources

Sample images are sourced from:
- **exif-samples**: https://github.com/ianare/exif-samples
- **pexels.com**: Free stock photography (motorsport images)
- **unsplash.com**: Free high-quality images

## Checksums

To verify file integrity:

```bash
shasum -a 256 tests/fixtures/images/*.jpg
```

Expected checksums are documented in test files.
