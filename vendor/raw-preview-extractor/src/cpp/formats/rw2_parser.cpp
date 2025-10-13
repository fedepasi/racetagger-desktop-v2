#include "rw2_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

// Panasonic RW2 magic header
const uint8_t RW2_MAGIC[] = {0x49, 0x49, 0x55, 0x00, 0x08, 0x00, 0x00, 0x00};

bool Rw2Parser::canParse(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }
    
    // Check for RW2 specific header
    if (std::memcmp(data, RW2_MAGIC, 8) == 0) {
        return true;
    }
    
    // Also check standard TIFF with Panasonic make
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian);
    
    if (magic == 0x002A) {
        TiffParser tiffParser;
        if (tiffParser.parseHeader(data, size)) {
            uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
            if (firstIfdOffset < size) {
                TiffIfd ifd;
                if (tiffParser.parseIfd(data, size, firstIfdOffset, ifd)) {
                    auto makeIt = ifd.tags.find(0x010F);
                    if (makeIt != ifd.tags.end()) {
                        const TiffTag& makeTag = makeIt->second;
                        if (makeTag.type == 2 && makeTag.count >= 9) {
                            size_t offset = (makeTag.count <= 4) ? 
                                reinterpret_cast<size_t>(&makeTag.valueOffset) : makeTag.valueOffset;
                            
                            if (offset + 9 <= size) {
                                const char* makeStr = reinterpret_cast<const char*>(data + offset);
                                if (std::strncmp(makeStr, "Panasonic", 9) == 0) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    return false;
}

std::vector<PreviewInfo> Rw2Parser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    TiffParser tiffParser;
    std::vector<Formats::PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    // RW2 files embed complete JPEG previews with EXIF data
    for (const auto& tiffPreview : tiffPreviews) {
        PreviewInfo rw2Preview(tiffPreview);
        
        if (rw2Preview.offset > 0 && rw2Preview.size > 0) {
            if (rw2Preview.offset + rw2Preview.size <= size) {
                const uint8_t* jpegData = data + rw2Preview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, rw2Preview.size)) {
                    rw2Preview.quality = Utils::JpegValidator::classifyPreview(
                        tiffPreview.width, tiffPreview.height, tiffPreview.size);
                    
                    // RW2 previews are generally high quality
                    if (rw2Preview.size >= 200 * 1024 && rw2Preview.size <= 3 * 1024 * 1024) {
                        rw2Preview.priority = 10;
                    } else if (rw2Preview.quality == Utils::QUALITY_PREVIEW) {
                        rw2Preview.priority = 8;
                    } else {
                        rw2Preview.priority = 5;
                    }
                    
                    previews.push_back(rw2Preview);
                }
            }
        }
    }
    
    return previews;
}

PreviewInfo Rw2Parser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Select based on priority and size
    PreviewInfo bestPreview;
    int highestPriority = -1;
    
    for (const auto& preview : previews) {
        if (preview.priority > highestPriority || 
            (preview.priority == highestPriority && preview.size > bestPreview.size)) {
            highestPriority = preview.priority;
            bestPreview = preview;
        }
    }
    
    return bestPreview;
}

} // namespace Formats
} // namespace RawExtractor