#pragma once

#include "cr2_parser.h" // For PreviewInfo definition
#include <cstring>

namespace RawExtractor {
namespace Formats {

class NefParser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);
    static std::string extractCameraModel(const uint8_t* data, size_t size);

private:
    static void extractNikonSpecificPreviews(const uint8_t* data, size_t size, 
                                            std::vector<PreviewInfo>& previews, uint16_t orientation);
};

} // namespace Formats
} // namespace RawExtractor