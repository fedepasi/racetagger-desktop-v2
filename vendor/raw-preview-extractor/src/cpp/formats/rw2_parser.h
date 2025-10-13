#pragma once

#include "cr2_parser.h"
#include <cstring>

namespace RawExtractor {
namespace Formats {

class Rw2Parser {
public:
    static bool canParse(const uint8_t* data, size_t size);
    static std::vector<PreviewInfo> extractPreviews(const uint8_t* data, size_t size);
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);
};

} // namespace Formats
} // namespace RawExtractor