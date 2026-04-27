#include "raf_parser.h"
#include "jpeg_validator.h"
#include "endian.h"
#include <cstring>

namespace RawExtractor {
namespace Formats {

const char RAF_MAGIC[] = "FUJIFILMCCD-RAW";

bool RafParser::canParse(const uint8_t* data, size_t size) {
    if (size < 16) {
        return false;
    }
    
    return std::memcmp(data, RAF_MAGIC, 15) == 0;
}

std::vector<PreviewInfo> RafParser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size) || size < 100) {
        return previews;
    }
    
    // RAF uses big-endian byte order exclusively
    // JPEG preview offset and length are at fixed positions (typically bytes 84-87)
    if (size >= 88) {
        uint32_t jpegOffset = Utils::EndianUtils::readUInt32(data + 84, false);
        uint32_t jpegLength = Utils::EndianUtils::readUInt32(data + 88, false);
        
        if (jpegOffset > 0 && jpegLength > 0 && jpegOffset + jpegLength <= size) {
            if (Utils::JpegValidator::isValidJpeg(data + jpegOffset, jpegLength)) {
                PreviewInfo rafPreview;
                rafPreview.offset = jpegOffset;
                rafPreview.size = jpegLength;
                rafPreview.isJpeg = true;
                rafPreview.quality = Utils::JpegValidator::classifyPreview(0, 0, jpegLength);
                
                if (jpegLength >= 200 * 1024 && jpegLength <= 3 * 1024 * 1024) {
                    rafPreview.priority = 10;
                } else {
                    rafPreview.priority = 7;
                }
                
                previews.push_back(rafPreview);
            }
        }
    }
    
    return previews;
}

PreviewInfo RafParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    return previews.empty() ? PreviewInfo{} : previews[0];
}

} // namespace Formats
} // namespace RawExtractor