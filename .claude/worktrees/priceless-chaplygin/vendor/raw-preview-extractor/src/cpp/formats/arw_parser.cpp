#include "arw_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

// Sony ARW specific tags
const uint16_t SONY_TAG_SR2_PRIVATE = 0x7200;
const uint16_t SONY_TAG_SR2_SUB_IFD = 0x7201;

bool ArwParser::canParse(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }
    
    // Check TIFF header
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian);
    
    if (magic != 0x002A) {
        return false;
    }
    
    // ARW files are TIFF-based, check for Sony maker signatures
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
        // Look for make tag containing "SONY"
        auto makeIt = ifd.tags.find(0x010F);
        if (makeIt != ifd.tags.end()) {
            const TiffTag& makeTag = makeIt->second;
            if (makeTag.type == 2 && makeTag.count >= 4) {
                size_t offset = (makeTag.count <= 4) ? 
                    reinterpret_cast<size_t>(&makeTag.valueOffset) : makeTag.valueOffset;
                
                if (offset + 4 <= size) {
                    const char* makeStr = reinterpret_cast<const char*>(data + offset);
                    if (std::strncmp(makeStr, "SONY", 4) == 0) {
                        return true;
                    }
                }
            }
        }
        
        // Also check for Sony-specific private tags
        if (ifd.tags.find(SONY_TAG_SR2_PRIVATE) != ifd.tags.end()) {
            return true;
        }
    }
    
    return false;
}

std::vector<PreviewInfo> ArwParser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    TiffParser tiffParser;
    std::vector<Formats::PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    // Extract orientation using ARW-specific method (checks multiple IFDs)
    uint16_t orientation = extractArwOrientation(data, size);
    
    // Sony ARW files store previews in various locations depending on the version
    // - IFD0 with SubfileType=1 or within SR2Private subdirectories
    // - Modern Sony cameras (A7R III, A1, A7M4) include full-size previews
    
    for (const auto& tiffPreview : tiffPreviews) {
        PreviewInfo arwPreview(tiffPreview);
        
        if (arwPreview.offset > 0 && arwPreview.size > 0) {
            // Validate JPEG data
            if (arwPreview.offset + arwPreview.size <= size) {
                const uint8_t* jpegData = data + arwPreview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, arwPreview.size)) {
                    // Classify ARW preview based on various factors
                    classifyArwPreview(arwPreview, tiffPreview);
                    arwPreview.orientation = orientation;
                    previews.push_back(arwPreview);
                }
            }
        }
    }
    
    // Check for Sony-specific SR2Private previews
    extractSr2PrivatePreviews(data, size, previews, orientation);
    
    return previews;
}

void ArwParser::classifyArwPreview(PreviewInfo& preview, const Formats::PreviewInfo& tiffPreview) {
    // Classify based on subfile type and size
    if (tiffPreview.subfileType == 1) {
        // Reduced resolution image (preview)
        preview.quality = Utils::JpegValidator::classifyPreview(
            tiffPreview.width, tiffPreview.height, tiffPreview.size);
        preview.type = "ARW_Preview";
        
        if (preview.size >= 200 * 1024 && preview.size <= 3 * 1024 * 1024) {
            preview.priority = 10; // High priority for target size
        } else if (preview.quality == Utils::QUALITY_PREVIEW) {
            preview.priority = 8;
        } else {
            preview.priority = 5;
        }
    } else if (tiffPreview.ifdIndex == 1) {
        // IFD1 typically contains smaller preview
        preview.quality = Utils::QUALITY_THUMBNAIL;
        preview.type = "ARW_IFD1";
        preview.priority = 2;
    } else if (tiffPreview.ifdIndex == -1) {
        // SubIFD preview
        preview.quality = Utils::JpegValidator::classifyPreview(
            tiffPreview.width, tiffPreview.height, tiffPreview.size);
        static int subIfdCounter = 0;
        preview.type = "ARW_SubIFD" + std::to_string(subIfdCounter++);
        
        // Modern Sony cameras often have high-quality SubIFD previews
        if (preview.size >= 1024 * 1024) { // 1MB+
            preview.priority = 9;
        } else {
            preview.priority = 6;
        }
    } else if (tiffPreview.ifdIndex == 0) {
        // IFD0 preview
        preview.quality = Utils::JpegValidator::classifyPreview(
            tiffPreview.width, tiffPreview.height, tiffPreview.size);
        preview.type = "ARW_IFD0";
        preview.priority = 7;
    } else {
        // Other IFDs
        preview.quality = Utils::JpegValidator::classifyPreview(
            tiffPreview.width, tiffPreview.height, tiffPreview.size);
        preview.type = "ARW_IFD" + std::to_string(tiffPreview.ifdIndex);
        preview.priority = 4;
    }
}

void ArwParser::extractSr2PrivatePreviews(const uint8_t* data, size_t size, 
                                         std::vector<PreviewInfo>& previews, uint16_t orientation) {
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return;
    }
    
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    
    // Parse IFDs looking for SR2Private structures
    uint32_t currentOffset = firstIfdOffset;
    
    while (currentOffset != 0 && currentOffset < size) {
        TiffIfd ifd;
        if (!tiffParser.parseIfd(data, size, currentOffset, ifd)) {
            break;
        }
        
        // Look for SR2Private tag
        auto sr2PrivateIt = ifd.tags.find(SONY_TAG_SR2_PRIVATE);
        if (sr2PrivateIt != ifd.tags.end()) {
            uint32_t sr2Offset = tiffParser.getTagValue32(sr2PrivateIt->second, data, size);
            uint32_t sr2Length = sr2PrivateIt->second.count;
            
            if (sr2Offset > 0 && sr2Length > 0 && sr2Offset + sr2Length <= size) {
                // Parse SR2Private structure
                parseSr2Private(data, size, sr2Offset, sr2Length, previews, orientation);
            }
        }
        
        // Also check SR2SubIFD tags
        auto sr2SubIfdIt = ifd.tags.find(SONY_TAG_SR2_SUB_IFD);
        if (sr2SubIfdIt != ifd.tags.end()) {
            std::vector<uint32_t> subIfdOffsets = tiffParser.getTagValues32(sr2SubIfdIt->second, data, size);
            
            for (uint32_t subOffset : subIfdOffsets) {
                if (subOffset > 0 && subOffset < size) {
                    TiffIfd subIfd;
                    if (tiffParser.parseIfd(data, size, subOffset, subIfd)) {
                        // Look for JPEG data in SubIFD
                        auto stripOffsetsIt = subIfd.tags.find(0x0111);
                        auto stripByteCountsIt = subIfd.tags.find(0x0117);
                        
                        if (stripOffsetsIt != subIfd.tags.end() && stripByteCountsIt != subIfd.tags.end()) {
                            std::vector<uint32_t> offsets = tiffParser.getTagValues32(stripOffsetsIt->second, data, size);
                            std::vector<uint32_t> byteCounts = tiffParser.getTagValues32(stripByteCountsIt->second, data, size);
                            
                            if (!offsets.empty() && !byteCounts.empty()) {
                                uint32_t jpegOffset = offsets[0];
                                uint32_t jpegSize = byteCounts[0];
                                
                                if (jpegOffset + jpegSize <= size && 
                                    Utils::JpegValidator::isValidJpeg(data + jpegOffset, jpegSize)) {
                                    
                                    PreviewInfo sr2Preview;
                                    sr2Preview.offset = jpegOffset;
                                    sr2Preview.size = jpegSize;
                                    sr2Preview.isJpeg = true;
                                    sr2Preview.ifdIndex = -10; // Mark as SR2 preview
                                    sr2Preview.quality = Utils::JpegValidator::classifyPreview(0, 0, jpegSize);
                                    sr2Preview.type = "ARW_SR2SubIFD";
                                    sr2Preview.orientation = orientation;
                                    
                                    if (jpegSize >= 200 * 1024 && jpegSize <= 3 * 1024 * 1024) {
                                        sr2Preview.priority = 11; // Very high priority
                                    } else {
                                        sr2Preview.priority = 7;
                                    }
                                    
                                    // Check for duplicates
                                    bool duplicate = false;
                                    for (const auto& existing : previews) {
                                        if (existing.offset == sr2Preview.offset && 
                                            existing.size == sr2Preview.size) {
                                            duplicate = true;
                                            break;
                                        }
                                    }
                                    
                                    if (!duplicate) {
                                        previews.push_back(sr2Preview);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        currentOffset = ifd.nextIfdOffset;
    }
}

void ArwParser::parseSr2Private(const uint8_t* data, size_t size, uint32_t offset, 
                               uint32_t length, std::vector<PreviewInfo>& previews, uint16_t orientation) {
    // SR2Private structure is encrypted/proprietary, but we can look for JPEG markers
    if (offset + length > size) {
        return;
    }
    
    const uint8_t* sr2Data = data + offset;
    
    // Search for JPEG markers within the SR2Private data
    for (uint32_t i = 0; i < length - 1; i++) {
        if (sr2Data[i] == 0xFF && sr2Data[i + 1] == 0xD8) {
            // Found potential JPEG start
            size_t jpegStart = offset + i;
            size_t jpegEnd = Utils::JpegValidator::findJpegEnd(data, size, jpegStart);
            
            if (jpegEnd != SIZE_MAX && jpegEnd > jpegStart) {
                uint32_t jpegSize = static_cast<uint32_t>(jpegEnd - jpegStart);
                
                if (Utils::JpegValidator::isValidJpeg(data + jpegStart, jpegSize)) {
                    PreviewInfo sr2Preview;
                    sr2Preview.offset = static_cast<uint32_t>(jpegStart);
                    sr2Preview.size = jpegSize;
                    sr2Preview.isJpeg = true;
                    sr2Preview.ifdIndex = -20; // Mark as SR2Private preview
                    sr2Preview.quality = Utils::JpegValidator::classifyPreview(0, 0, jpegSize);
                    sr2Preview.type = "ARW_SR2Private";
                    sr2Preview.orientation = orientation;
                    
                    if (jpegSize >= 200 * 1024 && jpegSize <= 3 * 1024 * 1024) {
                        sr2Preview.priority = 12; // Highest priority for SR2 previews in range
                    } else {
                        sr2Preview.priority = 8;
                    }
                    
                    // Check for duplicates
                    bool duplicate = false;
                    for (const auto& existing : previews) {
                        if (existing.offset == sr2Preview.offset && 
                            existing.size == sr2Preview.size) {
                            duplicate = true;
                            break;
                        }
                    }
                    
                    if (!duplicate) {
                        previews.push_back(sr2Preview);
                    }
                }
            }
        }
    }
}

PreviewInfo ArwParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Find the best preview based on ARW-specific criteria
    PreviewInfo bestPreview;
    int highestPriority = -1;
    
    for (const auto& preview : previews) {
        if (preview.priority > highestPriority) {
            highestPriority = preview.priority;
            bestPreview = preview;
        } else if (preview.priority == highestPriority) {
            // Same priority, prefer size within target range, then larger
            const size_t MIN_TARGET = 200 * 1024;
            const size_t MAX_TARGET = 3 * 1024 * 1024;
            
            bool currentInRange = (bestPreview.size >= MIN_TARGET && bestPreview.size <= MAX_TARGET);
            bool candidateInRange = (preview.size >= MIN_TARGET && preview.size <= MAX_TARGET);
            
            if (candidateInRange && (!currentInRange || preview.size > bestPreview.size)) {
                bestPreview = preview;
            } else if (!currentInRange && !candidateInRange) {
                // Both outside range, prefer the one closer to 1MB
                size_t targetSize = 1024 * 1024;
                size_t currentDiff = (bestPreview.size > targetSize) ? 
                    bestPreview.size - targetSize : targetSize - bestPreview.size;
                size_t candidateDiff = (preview.size > targetSize) ? 
                    preview.size - targetSize : targetSize - preview.size;
                
                if (candidateDiff < currentDiff) {
                    bestPreview = preview;
                }
            }
        }
    }
    
    return bestPreview;
}

uint16_t ArwParser::extractArwOrientation(const uint8_t* data, size_t size) {
    if (size < 8) {
        return 1; // Default orientation
    }
    
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return 1;
    }
    
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    
    if (firstIfdOffset >= size) {
        return 1;
    }
    
    const uint16_t ORIENTATION_TAG = 0x0112;
    
    // Parse all IFDs starting from IFD0
    uint32_t currentOffset = firstIfdOffset;
    int ifdIndex = 0;
    
    while (currentOffset != 0 && currentOffset < size && ifdIndex < 10) { // Limit to 10 IFDs
        TiffIfd ifd;
        if (!tiffParser.parseIfd(data, size, currentOffset, ifd)) {
            break;
        }
        
        // Look for orientation tag in current IFD
        auto orientationIt = ifd.tags.find(ORIENTATION_TAG);
        if (orientationIt != ifd.tags.end()) {
            uint16_t orientation = static_cast<uint16_t>(tiffParser.getTagValue32(orientationIt->second, data, size));
            
            // Validate orientation value (1-8 are valid EXIF orientations)
            if (orientation >= 1 && orientation <= 8) {
                // For ARW files, prioritize IFD0, then IFD1, then others
                if (ifdIndex == 0) {
                    return orientation; // IFD0 has highest priority
                } else if (ifdIndex == 1 && orientation != 1) {
                    return orientation; // IFD1 if not default value
                }
            }
        }
        
        // Check SubIFDs in current IFD
        auto subIfdIt = ifd.tags.find(0x014A); // SubIFD tag
        if (subIfdIt != ifd.tags.end()) {
            std::vector<uint32_t> subIfdOffsets = tiffParser.getTagValues32(subIfdIt->second, data, size);
            
            for (uint32_t subOffset : subIfdOffsets) {
                if (subOffset > 0 && subOffset < size) {
                    TiffIfd subIfd;
                    if (tiffParser.parseIfd(data, size, subOffset, subIfd)) {
                        auto subOrientationIt = subIfd.tags.find(ORIENTATION_TAG);
                        if (subOrientationIt != subIfd.tags.end()) {
                            uint16_t subOrientation = static_cast<uint16_t>(tiffParser.getTagValue32(subOrientationIt->second, data, size));
                            if (subOrientation >= 1 && subOrientation <= 8 && subOrientation != 1) {
                                return subOrientation; // Found in SubIFD
                            }
                        }
                    }
                }
            }
        }
        
        currentOffset = ifd.nextIfdOffset;
        ifdIndex++;
    }
    
    // Default to normal orientation if not found
    return 1;
}

} // namespace Formats
} // namespace RawExtractor