# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-15

### Added
- Native C++ RAW preview extraction optimized for Electron
- Support for major RAW formats: CR2, CR3, NEF, ARW, DNG, RAF, ORF, PEF, RW2
- Memory-mapped file I/O for optimal performance  
- Intelligent preview selection targeting 200KB-3MB size range
- Format-specific parsing algorithms for each RAW type
- TypeScript definitions and full type safety
- Comprehensive error handling and validation
- Electron example application with GUI
- Jest test suite with mock RAW file generation
- Async/sync API variants
- Buffer-based extraction for in-memory processing

### Features
- **Canon CR2/CR3**: Four-IFD structure parsing with UUID box support
- **Nikon NEF**: SubIFD navigation with JpgFromRawStart/Length tags  
- **Sony ARW**: SR2Private structure parsing with version detection
- **Adobe DNG**: Standards-compliant SubIFD preview extraction
- **Fujifilm RAF**: Fixed-offset preview with big-endian support
- **Olympus ORF**: Custom TIFF header handling (MMOR/IIRO)
- **Panasonic RW2**: Modified TIFF structure with proprietary tags

### Performance
- Boyer-Moore-Horspool algorithm for JPEG marker detection
- Memory-mapped files provide 3-10x speedup over traditional I/O
- Lazy loading with caching support
- Worker thread compatibility
- Chunked reading for files >2GB

### Documentation
- Comprehensive README with usage examples
- Complete API reference with TypeScript types
- Electron integration guide
- Performance benchmarks and optimization details
- Troubleshooting guide for common issues