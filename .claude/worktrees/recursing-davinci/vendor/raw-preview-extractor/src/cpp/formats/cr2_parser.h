#pragma once

#include <string>
#include "tiff_parser.h"
#include "../utils/jpeg_validator.h"

namespace RawExtractor {
namespace Formats {

// Extended PreviewInfo for format-specific data - redefining the struct
struct PreviewInfo {
    uint32_t offset = 0;
    uint32_t size = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    bool isJpeg = false;
    uint32_t subfileType = 0;
    int ifdIndex = -1; // -1 for SubIFD, 0+ for main IFD
    Utils::PreviewQuality quality = Utils::QUALITY_THUMBNAIL;
    int priority = 0; // Higher number = higher priority
    uint16_t orientation = 1; // EXIF orientation: 1=normal, 3=180°, 6=90°CW, 8=90°CCW
    std::string type = ""; // Preview type/name (e.g., "NEF_SubIFD0", "CR2_IFD0", "CR3_PRVW", etc.)
    
    PreviewInfo() = default;
};

class Cr2Parser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);
};

} // namespace Formats
} // namespace RawExtractor