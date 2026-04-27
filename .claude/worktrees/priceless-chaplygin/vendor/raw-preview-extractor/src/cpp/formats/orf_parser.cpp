#include "orf_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

bool OrfParser::canParse(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }
    
    // Check for Olympus custom TIFF headers (MMOR or IIRO)
    if (size >= 4) {
        uint32_t header = Utils::EndianUtils::readUInt32(data, false);
        if (header == 0x4D4D4F52 || header == 0x4949524F) { // "MMOR" or "IIRO"
            return true;
        }
    }
    
    // Also check standard TIFF with Olympus make
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
                        // Check for "OLYMPUS" in make tag
                        const TiffTag& makeTag = makeIt->second;
                        if (makeTag.type == 2 && makeTag.count >= 7) {
                            size_t offset = (makeTag.count <= 4) ? 
                                reinterpret_cast<size_t>(&makeTag.valueOffset) : makeTag.valueOffset;
                            
                            if (offset + 7 <= size) {
                                const char* makeStr = reinterpret_cast<const char*>(data + offset);
                                if (std::strncmp(makeStr, "OLYMPUS", 7) == 0) {
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

std::vector<PreviewInfo> OrfParser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    // Try standard TIFF parsing first
    TiffParser tiffParser;
    std::vector<Formats::PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    for (const auto& tiffPreview : tiffPreviews) {
        PreviewInfo orfPreview(tiffPreview);
        
        if (orfPreview.offset > 0 && orfPreview.size > 0) {
            if (orfPreview.offset + orfPreview.size <= size) {
                const uint8_t* jpegData = data + orfPreview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, orfPreview.size)) {
                    orfPreview.quality = Utils::JpegValidator::classifyPreview(
                        tiffPreview.width, tiffPreview.height, tiffPreview.size);
                    
                    if (orfPreview.size >= 200 * 1024 && orfPreview.size <= 3 * 1024 * 1024) {
                        orfPreview.priority = 10;
                    } else {
                        orfPreview.priority = 6;
                    }
                    
                    previews.push_back(orfPreview);
                }
            }
        }
    }
    
    return previews;
}

PreviewInfo OrfParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Select highest priority, then largest size
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