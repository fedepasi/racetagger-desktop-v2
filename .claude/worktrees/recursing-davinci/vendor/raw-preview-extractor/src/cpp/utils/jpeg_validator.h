#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>

namespace RawExtractor {
namespace Utils {

enum JpegMarkerType {
    JPEG_SOI = 0xD8,   // Start of Image
    JPEG_EOI = 0xD9,   // End of Image
    JPEG_DQT = 0xDB,   // Quantization Table
    JPEG_DHT = 0xC4,   // Huffman Table
    JPEG_SOS = 0xDA,   // Start of Scan
    JPEG_APP0 = 0xE0,  // Application segment 0
    JPEG_APP1 = 0xE1,  // Application segment 1 (EXIF)
    JPEG_COM = 0xFE    // Comment
};

enum PreviewQuality {
    QUALITY_THUMBNAIL,
    QUALITY_PREVIEW,
    QUALITY_FULL
};

struct JpegMarker {
    JpegMarkerType type;
    size_t offset;
    uint16_t length;
};

class JpegValidator {
public:
    static bool isValidJpeg(const uint8_t* data, size_t size);
    static std::vector<JpegMarker> findJpegMarkers(const uint8_t* data, size_t size);
    static size_t findJpegStart(const uint8_t* data, size_t size);
    static size_t findJpegEnd(const uint8_t* data, size_t size, size_t startOffset = 0);
    static uint8_t estimateQuality(const uint8_t* data, size_t size);
    static PreviewQuality classifyPreview(uint32_t width, uint32_t height, size_t fileSize);
};

} // namespace Utils
} // namespace RawExtractor