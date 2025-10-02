#include "cr3_parser.h"
#include "endian.h"
#include "jpeg_validator.h"
#include <cstring>

namespace RawExtractor {
namespace Formats {

// CR3 Box type definitions
const uint32_t BOX_TYPE_FTYP = 0x66747970; // "ftyp"
const uint32_t BOX_TYPE_UUID = 0x75756964; // "uuid"
const uint32_t BOX_TYPE_MDAT = 0x6D646174; // "mdat"
const uint32_t BOX_TYPE_MOOV = 0x6D6F6F76; // "moov"

// Canon CR3 UUID for preview box
const uint8_t CR3_PREVIEW_UUID[16] = {
    0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88,
    0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16
};

// PRVW box signature
const uint32_t PRVW_SIGNATURE = 0x50525657; // "PRVW"

bool Cr3Parser::canParse(const uint8_t* data, size_t size) {
    if (size < 20) {
        return false;
    }
    
    // Check ftyp box signature
    uint32_t boxSize = Utils::EndianUtils::readUInt32(data, false); // CR3 uses big-endian
    uint32_t boxType = Utils::EndianUtils::readUInt32(data + 4, false);
    
    if (boxType != BOX_TYPE_FTYP) {
        return false;
    }
    
    // Check major brand for CR3
    uint32_t majorBrand = Utils::EndianUtils::readUInt32(data + 8, false);
    return majorBrand == 0x63723320 || // "cr3 " (with space)
           majorBrand == 0x63727820;   // "crx " (newer CR3 format)
}

std::vector<PreviewInfo> Cr3Parser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    // Extract orientation from CMT1 section
    uint16_t orientation = extractOrientation(data, size);
    
    // 1. Extract THMB (thumbnail) preview
    PreviewInfo thumbnail = extractThumbnailPreview(data, size);
    if (thumbnail.offset > 0 && thumbnail.size > 0) {
        thumbnail.orientation = orientation;
        previews.push_back(thumbnail);
    }
    
    // 2. Extract PRVW (medium preview) from UUID box
    PreviewInfo mediumPreview = extractMediumPreview(data, size);
    if (mediumPreview.offset > 0 && mediumPreview.size > 0) {
        mediumPreview.orientation = orientation;
        previews.push_back(mediumPreview);
    }
    
    // 3. Extract full resolution preview from MDAT
    PreviewInfo fullPreview = extractFullResolutionPreview(data, size);
    if (fullPreview.offset > 0 && fullPreview.size > 0) {
        fullPreview.orientation = orientation;
        previews.push_back(fullPreview);
    }
    
    return previews;
}

Box Cr3Parser::parseBox(const uint8_t* data, size_t size, size_t offset) {
    Box box = {};
    
    if (offset + 8 > size) {
        return box;
    }
    
    box.size = Utils::EndianUtils::readUInt32(data + offset, false);
    box.type = Utils::EndianUtils::readUInt32(data + offset + 4, false);
    
    // Handle 64-bit size
    if (box.size == 1 && offset + 16 <= size) {
        // 64-bit size follows
        uint64_t size64 = (static_cast<uint64_t>(Utils::EndianUtils::readUInt32(data + offset + 8, false)) << 32) |
                          Utils::EndianUtils::readUInt32(data + offset + 12, false);
        box.size = static_cast<uint32_t>(std::min(size64, static_cast<uint64_t>(size - offset)));
    } else if (box.size == 0) {
        // Box extends to end of file
        box.size = static_cast<uint32_t>(size - offset);
    }
    
    return box;
}

PreviewInfo Cr3Parser::extractPreviewFromUuid(const uint8_t* data, size_t size, size_t uuidDataOffset, uint32_t uuidDataSize) {
    PreviewInfo preview = {};
    
    if (uuidDataOffset + 16 > size || uuidDataSize < 16) {
        return preview;
    }
    
    // UUID data has 8 bytes header, then comes the PRVW box
    size_t prvwBoxOffset = uuidDataOffset + 8;
    
    // Read PRVW box size and type
    if (prvwBoxOffset + 8 > size) {
        return preview;
    }
    
    uint32_t prvwBoxSize = Utils::EndianUtils::readUInt32(data + prvwBoxOffset, false);
    uint32_t prvwSig = Utils::EndianUtils::readUInt32(data + prvwBoxOffset + 4, false);
    
    if (prvwSig == PRVW_SIGNATURE && prvwBoxSize > 20) {
        // PRVW box found, parse its structure
        size_t prvwDataOffset = prvwBoxOffset + 8; // Skip PRVW box header
        
        // Skip PRVW internal header (appears to be 16 bytes)
        size_t jpegSearchOffset = prvwDataOffset + 16;
        
        if (jpegSearchOffset < size) {
            // Find JPEG start markers
            size_t jpegStart = Utils::JpegValidator::findJpegStart(data + jpegSearchOffset, size - jpegSearchOffset);
            if (jpegStart != SIZE_MAX) {
                jpegStart += jpegSearchOffset; // Adjust to absolute offset
                
                // Calculate max JPEG size based on PRVW box size
                size_t maxJpegSize = prvwBoxSize - (jpegStart - prvwBoxOffset);
                size_t jpegEnd = Utils::JpegValidator::findJpegEnd(data, std::min(size, prvwBoxOffset + prvwBoxSize), jpegStart);
                
                if (jpegEnd != SIZE_MAX && jpegEnd > jpegStart && (jpegEnd - jpegStart) <= maxJpegSize) {
                    preview.offset = static_cast<uint32_t>(jpegStart);
                    preview.size = static_cast<uint32_t>(jpegEnd - jpegStart);
                    preview.isJpeg = true;
                    preview.quality = Utils::JpegValidator::classifyPreview(0, 0, preview.size);
                    preview.priority = 8; // High priority for CR3 previews
                    
                    // Validate the JPEG data
                    if (Utils::JpegValidator::isValidJpeg(data + preview.offset, preview.size)) {
                        return preview;
                    }
                }
            }
        }
    }
    
    return {};
}

PreviewInfo Cr3Parser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // CR3 typically has one main preview in the UUID box
    // Return the largest valid preview within our target range
    PreviewInfo bestPreview;
    const size_t MIN_TARGET = 200 * 1024;
    const size_t MAX_TARGET = 3 * 1024 * 1024;
    
    for (const auto& preview : previews) {
        if (preview.size >= MIN_TARGET && preview.size <= MAX_TARGET) {
            if (bestPreview.size == 0 || preview.size > bestPreview.size) {
                bestPreview = preview;
            }
        }
    }
    
    // If no preview in target range, return the first valid one
    if (bestPreview.size == 0 && !previews.empty()) {
        bestPreview = previews[0];
    }
    
    return bestPreview;
}

PreviewInfo Cr3Parser::extractThumbnailPreview(const uint8_t* data, size_t size) {
    PreviewInfo preview = {};
    
    // Look for THMB signature in the file
    for (size_t i = 0; i < size - 4; i++) {
        if (Utils::EndianUtils::readUInt32(data + i, false) == 0x54484D42) { // "THMB"
            // THMB found, extract thumbnail
            if (i + 20 < size) {
                // Skip THMB header and look for dimensions
                size_t dataOffset = i + 16;
                
                // Look for JPEG marker after THMB header
                size_t jpegStart = Utils::JpegValidator::findJpegStart(data + dataOffset, size - dataOffset);
                if (jpegStart != SIZE_MAX) {
                    jpegStart += dataOffset;
                    
                    size_t jpegEnd = Utils::JpegValidator::findJpegEnd(data, size, jpegStart);
                    if (jpegEnd != SIZE_MAX && jpegEnd > jpegStart) {
                        preview.offset = static_cast<uint32_t>(jpegStart);
                        preview.size = static_cast<uint32_t>(jpegEnd - jpegStart);
                        preview.width = 160; // THMB typical size
                        preview.height = 120;
                        preview.isJpeg = true;
                        preview.quality = Utils::QUALITY_THUMBNAIL;
                        preview.type = "CR3_THMB";
                        preview.priority = 1; // Low priority - thumbnail
                        
                        if (Utils::JpegValidator::isValidJpeg(data + preview.offset, preview.size)) {
                            return preview;
                        }
                    }
                }
            }
            break;
        }
    }
    
    return preview;
}

PreviewInfo Cr3Parser::extractMediumPreview(const uint8_t* data, size_t size) {
    // This is the existing PRVW extraction logic
    size_t offset = 0;
    while (offset < size - 8) {
        Box box = parseBox(data, size, offset);
        if (box.size == 0) {
            break;
        }
        
        if (box.type == BOX_TYPE_UUID && box.size >= 32) {
            // Check if this is the preview UUID
            if (offset + 24 <= size && 
                std::memcmp(data + offset + 8, CR3_PREVIEW_UUID, 16) == 0) {
                
                PreviewInfo preview = extractPreviewFromUuid(data, size, offset + 24, box.size - 24);
                if (preview.offset > 0 && preview.size > 0) {
                    preview.quality = Utils::QUALITY_PREVIEW;
                    preview.type = "CR3_PRVW";
                    preview.priority = 5; // Medium priority
                    return preview;
                }
            }
        }
        
        offset += box.size;
        if (box.size < 8) break;
    }
    
    return {};
}

PreviewInfo Cr3Parser::extractFullResolutionPreview(const uint8_t* data, size_t size) {
    PreviewInfo preview = {};
    
    // Look for MDAT box
    size_t offset = 0;
    while (offset < size - 8) {
        Box box = parseBox(data, size, offset);
        if (box.size == 0) {
            break;
        }
        
        if (box.type == BOX_TYPE_MDAT) {
            // Found MDAT box, look for large JPEG inside
            size_t mdatDataOffset = offset + 8;
            size_t searchLimit = std::min(size, offset + box.size);
            
            // Look for JPEG markers in MDAT
            size_t jpegStart = Utils::JpegValidator::findJpegStart(data + mdatDataOffset, searchLimit - mdatDataOffset);
            if (jpegStart != SIZE_MAX) {
                jpegStart += mdatDataOffset;
                
                size_t jpegEnd = Utils::JpegValidator::findJpegEnd(data, searchLimit, jpegStart);
                if (jpegEnd != SIZE_MAX && jpegEnd > jpegStart) {
                    uint32_t jpegSize = static_cast<uint32_t>(jpegEnd - jpegStart);
                    
                    // Only consider large JPEGs (>1MB) as full resolution previews
                    if (jpegSize > 1024 * 1024) {
                        preview.offset = static_cast<uint32_t>(jpegStart);
                        preview.size = jpegSize;
                        preview.width = 5472; // Typical CR3 full res dimensions
                        preview.height = 3648;
                        preview.isJpeg = true;
                        preview.quality = Utils::QUALITY_FULL;
                        preview.type = "CR3_MDAT";
                        preview.priority = 10; // High priority - full resolution
                        
                        if (Utils::JpegValidator::isValidJpeg(data + preview.offset, preview.size)) {
                            return preview;
                        }
                    }
                }
            }
            break;
        }
        
        offset += box.size;
        if (box.size < 8) break;
    }
    
    return preview;
}

uint16_t Cr3Parser::extractOrientation(const uint8_t* data, size_t size) {
    // Look for CMT1 (Canon MeTadata 1) section
    for (size_t i = 0; i < size - 4; i++) {
        if (Utils::EndianUtils::readUInt32(data + i, false) == 0x434D5431) { // "CMT1"
            // CMT1 found, orientation is at offset 0x140 from CMT1 start
            size_t orientationOffset = i + 0x140;
            if (orientationOffset + 2 <= size) {
                // Read orientation value (little-endian in CMT1)
                uint16_t orientation = Utils::EndianUtils::readUInt16(data + orientationOffset, true);
                
                // Validate orientation value (should be 1-8)
                if (orientation >= 1 && orientation <= 8) {
                    return orientation;
                }
            }
            break;
        }
    }
    
    return 1; // Default to normal orientation
}

} // namespace Formats
} // namespace RawExtractor