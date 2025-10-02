#pragma once

#include "cr2_parser.h" // For PreviewInfo definition

namespace RawExtractor {
namespace Formats {

struct Box {
    uint32_t size;
    uint32_t type;
    
    Box() : size(0), type(0) {}
};

class Cr3Parser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);

private:
    static Box parseBox(const uint8_t* data, size_t size, size_t offset);
    static PreviewInfo extractPreviewFromUuid(const uint8_t* data, size_t size, 
                                            size_t uuidDataOffset, uint32_t uuidDataSize);
    static PreviewInfo extractThumbnailPreview(const uint8_t* data, size_t size);
    static PreviewInfo extractMediumPreview(const uint8_t* data, size_t size);
    static PreviewInfo extractFullResolutionPreview(const uint8_t* data, size_t size);
    static uint16_t extractOrientation(const uint8_t* data, size_t size);
};

} // namespace Formats
} // namespace RawExtractor