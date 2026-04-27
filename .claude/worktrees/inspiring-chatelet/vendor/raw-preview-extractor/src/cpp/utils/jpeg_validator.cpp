#include "jpeg_validator.h"
#include <algorithm>
#include <vector>

namespace RawExtractor {
namespace Utils {

bool JpegValidator::isValidJpeg(const uint8_t* data, size_t size) {
    if (size < 4) return false;
    
    // Check for JPEG SOI marker (0xFFD8)
    if (data[0] != 0xFF || data[1] != 0xD8) {
        return false;
    }
    
    // Find EOI marker (0xFFD9)
    for (size_t i = size - 2; i > 2; i--) {
        if (data[i] == 0xFF && data[i + 1] == 0xD9) {
            return true;
        }
    }
    
    return false;
}

std::vector<JpegMarker> JpegValidator::findJpegMarkers(const uint8_t* data, size_t size) {
    std::vector<JpegMarker> markers;
    
    for (size_t i = 0; i < size - 1; i++) {
        if (data[i] == 0xFF && data[i + 1] != 0x00 && data[i + 1] != 0xFF) {
            JpegMarker marker;
            marker.offset = i;
            
            switch (data[i + 1]) {
                case 0xD8:
                    marker.type = JPEG_SOI;
                    marker.length = 2;
                    break;
                case 0xD9:
                    marker.type = JPEG_EOI;
                    marker.length = 2;
                    break;
                case 0xDB:
                    marker.type = JPEG_DQT;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                case 0xC4:
                    marker.type = JPEG_DHT;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                case 0xDA:
                    marker.type = JPEG_SOS;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                case 0xE0:
                    marker.type = JPEG_APP0;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                case 0xE1:
                    marker.type = JPEG_APP1;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                case 0xFE:
                    marker.type = JPEG_COM;
                    if (i + 3 < size) {
                        marker.length = (static_cast<uint16_t>(data[i + 2]) << 8) | data[i + 3];
                    }
                    break;
                default:
                    continue;
            }
            
            markers.push_back(marker);
            
            // Skip the marker and its data
            if (marker.length > 2) {
                i += marker.length - 1;
            } else {
                i += 1;
            }
        }
    }
    
    return markers;
}

size_t JpegValidator::findJpegStart(const uint8_t* data, size_t size) {
    for (size_t i = 0; i < size - 1; i++) {
        if (data[i] == 0xFF && data[i + 1] == 0xD8) {
            return i;
        }
    }
    return SIZE_MAX;
}

size_t JpegValidator::findJpegEnd(const uint8_t* data, size_t size, size_t startOffset) {
    for (size_t i = std::max(startOffset, static_cast<size_t>(2)); i < size - 1; i++) {
        if (data[i] == 0xFF && data[i + 1] == 0xD9) {
            return i + 2; // Include the EOI marker
        }
    }
    return SIZE_MAX;
}

uint8_t JpegValidator::estimateQuality(const uint8_t* data, size_t size) {
    auto markers = findJpegMarkers(data, size);
    
    for (const auto& marker : markers) {
        if (marker.type == JPEG_DQT && marker.offset + 4 < size) {
            // Read quantization table values
            const uint8_t* qtable = data + marker.offset + 4;
            
            // Calculate average quantization value for luminance table
            uint32_t sum = 0;
            for (int i = 0; i < 64 && marker.offset + 4 + i < size; i++) {
                sum += qtable[i];
            }
            
            uint8_t avgQ = static_cast<uint8_t>(sum / 64);
            
            // Estimate quality based on average quantization value
            if (avgQ < 50) return 95; // High quality
            else if (avgQ < 100) return 75; // Medium-high quality
            else if (avgQ < 150) return 50; // Medium quality
            else return 25; // Low quality
        }
    }
    
    return 50; // Default estimate
}

PreviewQuality JpegValidator::classifyPreview(uint32_t width, uint32_t height, size_t fileSize) {
    // Size thresholds for classification
    const size_t THUMBNAIL_MAX_SIZE = 500 * 1024; // 500KB
    const size_t PREVIEW_MIN_SIZE = 200 * 1024;   // 200KB
    const size_t PREVIEW_MAX_SIZE = 3 * 1024 * 1024; // 3MB
    
    // Resolution thresholds
    const uint32_t THUMBNAIL_MAX_WIDTH = 320;
    const uint32_t THUMBNAIL_MAX_HEIGHT = 240;
    const uint32_t PREVIEW_MIN_WIDTH = 800;
    const uint32_t PREVIEW_MIN_HEIGHT = 600;
    
    if (fileSize <= THUMBNAIL_MAX_SIZE || 
        (width <= THUMBNAIL_MAX_WIDTH && height <= THUMBNAIL_MAX_HEIGHT)) {
        return QUALITY_THUMBNAIL;
    }
    
    if (fileSize >= PREVIEW_MIN_SIZE && fileSize <= PREVIEW_MAX_SIZE &&
        width >= PREVIEW_MIN_WIDTH && height >= PREVIEW_MIN_HEIGHT) {
        return QUALITY_PREVIEW;
    }
    
    if (fileSize > PREVIEW_MAX_SIZE || width > 2048 || height > 2048) {
        return QUALITY_FULL;
    }
    
    return QUALITY_PREVIEW; // Default classification
}

} // namespace Utils
} // namespace RawExtractor