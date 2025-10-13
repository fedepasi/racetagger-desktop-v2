#pragma once

#include "cr2_parser.h" // For PreviewInfo definition
#include <cstring>

namespace RawExtractor {
namespace Formats {

class ArwParser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);

private:
    static void classifyArwPreview(PreviewInfo& preview, const Formats::PreviewInfo& tiffPreview);
    static void extractSr2PrivatePreviews(const uint8_t* data, size_t size, 
                                         std::vector<PreviewInfo>& previews, uint16_t orientation);
    static void parseSr2Private(const uint8_t* data, size_t size, uint32_t offset, 
                               uint32_t length, std::vector<PreviewInfo>& previews, uint16_t orientation);
    static uint16_t extractArwOrientation(const uint8_t* data, size_t size);
};

} // namespace Formats
} // namespace RawExtractor