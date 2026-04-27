#include "cr2_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

bool Cr2Parser::canParse(const uint8_t* data, size_t size) {
    if (size < 10) {
        return false;
    }
    
    // Check TIFF header first
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian);
    
    if (magic != 0x002A) {
        return false;
    }
    
    // Check for CR2 specific magic at offset 8-9
    uint16_t cr2Magic = Utils::EndianUtils::readUInt16(data + 8, littleEndian);
    return cr2Magic == 0x5243; // "CR" in little endian
}

std::vector<PreviewInfo> Cr2Parser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    TiffParser tiffParser;
    std::vector<PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    // CR2 files have a specific 4-IFD structure:
    // IFD0: Full-size JPEG preview (~2MB, 2256x1504 on older models)
    // IFD1: Small thumbnail (160x120)
    // IFD2: Reduced resolution RAW
    // IFD3: Full resolution RAW
    
    for (const auto& preview : tiffPreviews) {
        // Filter and classify CR2 previews
        if (preview.offset > 0 && preview.size > 0) {
            PreviewInfo cr2Preview = preview;
            
            // Validate JPEG data
            if (preview.offset + preview.size <= size) {
                const uint8_t* jpegData = data + preview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, preview.size)) {
                    // Classify based on IFD index and size
                    if (preview.ifdIndex == 0) {
                        // IFD0 contains the full-size preview
                        cr2Preview.quality = Utils::QUALITY_PREVIEW;
                        cr2Preview.type = "CR2_IFD0";
                        
                        // Verify this is actually a good preview size
                        if (preview.size >= 200 * 1024 && preview.size <= 3 * 1024 * 1024) {
                            cr2Preview.priority = 10; // High priority
                        } else {
                            cr2Preview.priority = 5;
                        }
                    } else if (preview.ifdIndex == 1) {
                        // IFD1 contains the thumbnail
                        cr2Preview.quality = Utils::QUALITY_THUMBNAIL;
                        cr2Preview.type = "CR2_IFD1";
                        cr2Preview.priority = 1; // Low priority
                    } else if (preview.ifdIndex == -1) {
                        // SubIFD
                        cr2Preview.quality = Utils::JpegValidator::classifyPreview(
                            preview.width, preview.height, preview.size);
                        static int subIfdCounter = 0;
                        cr2Preview.type = "CR2_SubIFD" + std::to_string(subIfdCounter++);
                        cr2Preview.priority = 3;
                    } else {
                        // Other IFDs
                        cr2Preview.quality = Utils::JpegValidator::classifyPreview(
                            preview.width, preview.height, preview.size);
                        cr2Preview.type = "CR2_IFD" + std::to_string(preview.ifdIndex);
                        cr2Preview.priority = 3;
                    }
                    
                    previews.push_back(cr2Preview);
                }
            }
        }
    }
    
    return previews;
}

PreviewInfo Cr2Parser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Find the best preview based on CR2-specific criteria
    PreviewInfo bestPreview;
    int highestPriority = -1;
    
    for (const auto& preview : previews) {
        if (preview.priority > highestPriority) {
            highestPriority = preview.priority;
            bestPreview = preview;
        } else if (preview.priority == highestPriority) {
            // Same priority, prefer larger size within our target range
            const size_t MIN_TARGET = 200 * 1024;
            const size_t MAX_TARGET = 3 * 1024 * 1024;
            
            bool currentInRange = (bestPreview.size >= MIN_TARGET && bestPreview.size <= MAX_TARGET);
            bool candidateInRange = (preview.size >= MIN_TARGET && preview.size <= MAX_TARGET);
            
            if (candidateInRange && (!currentInRange || preview.size > bestPreview.size)) {
                bestPreview = preview;
            }
        }
    }
    
    return bestPreview;
}

} // namespace Formats
} // namespace RawExtractor