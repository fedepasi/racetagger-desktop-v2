#include "dng_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

bool DngParser::canParse(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }
    
    // Check TIFF header
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian);
    
    if (magic != 0x002A) {
        return false;
    }
    
    // DNG files have specific DNG version tags
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return false;
    }
    
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    if (firstIfdOffset >= size) {
        return false;
    }
    
    TiffIfd ifd;
    if (tiffParser.parseIfd(data, size, firstIfdOffset, ifd)) {
        // Look for DNG version tag (0xC612)
        if (ifd.tags.find(0xC612) != ifd.tags.end()) {
            return true;
        }
        
        // Also check for Adobe as software creator
        auto softwareIt = ifd.tags.find(0x0131);
        if (softwareIt != ifd.tags.end()) {
            const TiffTag& softwareTag = softwareIt->second;
            if (softwareTag.type == 2 && softwareTag.count >= 5) {
                size_t offset = (softwareTag.count <= 4) ? 
                    reinterpret_cast<size_t>(&softwareTag.valueOffset) : softwareTag.valueOffset;
                
                if (offset + 5 <= size) {
                    const char* softwareStr = reinterpret_cast<const char*>(data + offset);
                    if (std::strncmp(softwareStr, "Adobe", 5) == 0) {
                        return true;
                    }
                }
            }
        }
    }
    
    return false;
}

std::vector<PreviewInfo> DngParser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    TiffParser tiffParser;
    std::vector<Formats::PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    // Extract orientation from IFD0
    uint16_t orientation = tiffParser.extractOrientation(data, size);
    
    // DNG format explicitly defines preview storage through SubIFD structures
    // IFD0 contains low-resolution thumbnail while SubIFDs hold higher quality previews
    
    for (const auto& tiffPreview : tiffPreviews) {
        PreviewInfo dngPreview(tiffPreview);
        
        if (dngPreview.offset > 0 && dngPreview.size > 0) {
            // Validate JPEG data
            if (dngPreview.offset + dngPreview.size <= size) {
                const uint8_t* jpegData = data + dngPreview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, dngPreview.size)) {
                    // Classify DNG preview based on NewSubfileType and location
                    if (tiffPreview.subfileType == 1) {
                        // Reduced resolution image
                        dngPreview.quality = Utils::JpegValidator::classifyPreview(
                            tiffPreview.width, tiffPreview.height, tiffPreview.size);
                        
                        if (dngPreview.size >= 200 * 1024 && dngPreview.size <= 3 * 1024 * 1024) {
                            dngPreview.priority = 10;
                        } else {
                            dngPreview.priority = 8;
                        }
                    } else if (tiffPreview.ifdIndex == -1) {
                        // SubIFD preview - DNG standard location
                        dngPreview.quality = Utils::JpegValidator::classifyPreview(
                            tiffPreview.width, tiffPreview.height, tiffPreview.size);
                        dngPreview.priority = 9;
                    } else if (tiffPreview.ifdIndex == 0) {
                        // IFD0 - usually thumbnail
                        dngPreview.quality = Utils::QUALITY_THUMBNAIL;
                        dngPreview.priority = 2;
                    } else {
                        // Other IFDs
                        dngPreview.quality = Utils::JpegValidator::classifyPreview(
                            tiffPreview.width, tiffPreview.height, tiffPreview.size);
                        dngPreview.priority = 5;
                    }
                    
                    dngPreview.orientation = orientation;
                    previews.push_back(dngPreview);
                }
            }
        }
    }
    
    return previews;
}

PreviewInfo DngParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // DNG has well-defined preview hierarchy, select based on priority and size
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