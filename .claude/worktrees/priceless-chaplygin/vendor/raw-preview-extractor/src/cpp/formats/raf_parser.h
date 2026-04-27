#pragma once

#include "cr2_parser.h"

namespace RawExtractor {
namespace Formats {

class RafParser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);
};

} // namespace Formats
} // namespace RawExtractor