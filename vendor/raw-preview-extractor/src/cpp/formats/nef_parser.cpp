#include "nef_parser.h"
#include "tiff_parser.h"
#include "jpeg_validator.h"
#include "endian.h"

namespace RawExtractor {
namespace Formats {

// Nikon specific TIFF tags
const uint16_t NIKON_TAG_MAKER_NOTE = 0x927C;
const uint16_t NIKON_TAG_JPEG_FROM_RAW_START = 0x0201;
const uint16_t NIKON_TAG_JPEG_FROM_RAW_LENGTH = 0x0202;

bool NefParser::canParse(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }
    
    // Check TIFF header
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian);
    
    if (magic != 0x002A) {
        return false;
    }
    
    // NEF files are standard TIFF, so we need to check for Nikon-specific markers
    // We'll do a more thorough check by looking for Nikon maker notes
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return false;
    }
    
    // Parse first IFD to look for Nikon signatures
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    if (firstIfdOffset >= size) {
        return false;
    }
    
    TiffIfd ifd;
    if (tiffParser.parseIfd(data, size, firstIfdOffset, ifd)) {
        // Look for make tag (0x010F) containing "NIKON"
        auto makeIt = ifd.tags.find(0x010F);
        if (makeIt != ifd.tags.end()) {
            // Check if the make field contains "NIKON"
            const TiffTag& makeTag = makeIt->second;
            if (makeTag.type == 2 && makeTag.count >= 5) { // ASCII type
                size_t offset = (makeTag.count <= 4) ? 
                    reinterpret_cast<size_t>(&makeTag.valueOffset) : makeTag.valueOffset;
                
                if (offset + 5 <= size) {
                    const char* makeStr = reinterpret_cast<const char*>(data + offset);
                    if (std::strncmp(makeStr, "NIKON", 5) == 0) {
                        return true;
                    }
                }
            }
        }
    }
    
    return false;
}

std::vector<PreviewInfo> NefParser::extractPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!canParse(data, size)) {
        return previews;
    }
    
    TiffParser tiffParser;
    std::vector<Formats::PreviewInfo> tiffPreviews = tiffParser.findPreviews(data, size);
    
    // Extract orientation from IFD0
    uint16_t orientation = tiffParser.extractOrientation(data, size);
    
    // NEF files store their full-size JPEG preview in SubIFD#1
    // The preview location and size are specified by JpgFromRawStart (0x0201) 
    // and JpgFromRawLength (0x0202) tags
    
    for (const auto& tiffPreview : tiffPreviews) {
        PreviewInfo nefPreview(tiffPreview);
        
        if (nefPreview.offset > 0 && nefPreview.size > 0) {
            // Validate JPEG data
            if (nefPreview.offset + nefPreview.size <= size) {
                const uint8_t* jpegData = data + nefPreview.offset;
                
                if (Utils::JpegValidator::isValidJpeg(jpegData, nefPreview.size)) {
                    // Classify NEF preview based on SubIFD index and size
                    if (nefPreview.ifdIndex == -1) {
                        // SubIFD preview - this is typically the full-size preview
                        nefPreview.quality = Utils::JpegValidator::classifyPreview(
                            nefPreview.width, nefPreview.height, nefPreview.size);
                        
                        // Assign type name for SubIFD previews
                        static int subIfdCounter = 0;
                        nefPreview.type = "NEF_SubIFD" + std::to_string(subIfdCounter++);
                        
                        if (nefPreview.size >= 200 * 1024 && nefPreview.size <= 3 * 1024 * 1024) {
                            nefPreview.priority = 10; // High priority for target size range
                        } else if (nefPreview.quality == Utils::QUALITY_PREVIEW) {
                            nefPreview.priority = 8;
                        } else {
                            nefPreview.priority = 5;
                        }
                    } else if (nefPreview.ifdIndex == 1) {
                        // IFD1 often contains smaller preview
                        nefPreview.quality = Utils::QUALITY_THUMBNAIL;
                        nefPreview.type = "NEF_IFD1";
                        nefPreview.priority = 2;
                    } else if (nefPreview.ifdIndex == 0) {
                        // IFD0 main preview
                        nefPreview.quality = Utils::JpegValidator::classifyPreview(
                            nefPreview.width, nefPreview.height, nefPreview.size);
                        nefPreview.type = "NEF_IFD0";
                        nefPreview.priority = 7;
                    } else {
                        // Other IFDs
                        nefPreview.quality = Utils::JpegValidator::classifyPreview(
                            nefPreview.width, nefPreview.height, nefPreview.size);
                        nefPreview.type = "NEF_IFD" + std::to_string(nefPreview.ifdIndex);
                        nefPreview.priority = 3;
                    }
                    
                    nefPreview.orientation = orientation;
                    previews.push_back(nefPreview);
                }
            }
        }
    }
    
    // Also check for specific Nikon JPEG tags in SubIFDs
    extractNikonSpecificPreviews(data, size, previews, orientation);
    
    return previews;
}

void NefParser::extractNikonSpecificPreviews(const uint8_t* data, size_t size, 
                                           std::vector<PreviewInfo>& previews, uint16_t orientation) {
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return;
    }
    
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    
    // Parse IFDs and look for SubIFDs with Nikon JPEG tags
    uint32_t currentOffset = firstIfdOffset;
    int ifdIndex = 0;
    
    while (currentOffset != 0 && currentOffset < size) {
        TiffIfd ifd;
        if (!tiffParser.parseIfd(data, size, currentOffset, ifd)) {
            break;
        }
        
        // Check SubIFDs
        auto subIfdIt = ifd.tags.find(0x014A);
        if (subIfdIt != ifd.tags.end()) {
            std::vector<uint32_t> subIfdOffsets = tiffParser.getTagValues32(subIfdIt->second, data, size);
            
            for (size_t i = 0; i < subIfdOffsets.size(); i++) {
                TiffIfd subIfd;
                if (tiffParser.parseIfd(data, size, subIfdOffsets[i], subIfd)) {
                    // Look for Nikon JPEG tags
                    auto jpegStartIt = subIfd.tags.find(NIKON_TAG_JPEG_FROM_RAW_START);
                    auto jpegLengthIt = subIfd.tags.find(NIKON_TAG_JPEG_FROM_RAW_LENGTH);
                    
                    if (jpegStartIt != subIfd.tags.end() && jpegLengthIt != subIfd.tags.end()) {
                        uint32_t jpegOffset = tiffParser.getTagValue32(jpegStartIt->second, data, size);
                        uint32_t jpegLength = tiffParser.getTagValue32(jpegLengthIt->second, data, size);
                        
                        if (jpegOffset > 0 && jpegLength > 0 && 
                            jpegOffset + jpegLength <= size) {
                            
                            if (Utils::JpegValidator::isValidJpeg(data + jpegOffset, jpegLength)) {
                                PreviewInfo nikonPreview;
                                nikonPreview.offset = jpegOffset;
                                nikonPreview.size = jpegLength;
                                nikonPreview.isJpeg = true;
                                nikonPreview.ifdIndex = -1 - static_cast<int>(i); // SubIFD marker
                                nikonPreview.quality = Utils::JpegValidator::classifyPreview(0, 0, jpegLength);
                                nikonPreview.orientation = orientation;
                                
                                if (jpegLength >= 200 * 1024 && jpegLength <= 3 * 1024 * 1024) {
                                    nikonPreview.priority = 12; // Very high priority
                                } else {
                                    nikonPreview.priority = 7;
                                }
                                
                                // Check if this preview is already in our list
                                bool duplicate = false;
                                for (const auto& existing : previews) {
                                    if (existing.offset == nikonPreview.offset && 
                                        existing.size == nikonPreview.size) {
                                        duplicate = true;
                                        break;
                                    }
                                }
                                
                                if (!duplicate) {
                                    previews.push_back(nikonPreview);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        currentOffset = ifd.nextIfdOffset;
        ifdIndex++;
    }
}

PreviewInfo NefParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Find the best preview based on NEF-specific criteria
    PreviewInfo bestPreview;
    int highestPriority = -1;
    
    for (const auto& preview : previews) {
        if (preview.priority > highestPriority) {
            highestPriority = preview.priority;
            bestPreview = preview;
        } else if (preview.priority == highestPriority) {
            // Same priority, prefer larger size within target range
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

std::string NefParser::extractCameraModel(const uint8_t* data, size_t size) {
    if (size < 8) {
        return "UNKNOWN";
    }
    
    TiffParser tiffParser;
    if (!tiffParser.parseHeader(data, size)) {
        return "UNKNOWN";
    }
    
    bool littleEndian = Utils::EndianUtils::detectEndianness(data);
    uint32_t firstIfdOffset = Utils::EndianUtils::readUInt32(data + 4, littleEndian);
    
    if (firstIfdOffset >= size) {
        return "UNKNOWN";
    }
    
    TiffIfd ifd;
    if (tiffParser.parseIfd(data, size, firstIfdOffset, ifd)) {
        // Look for Model tag (0x0110)
        auto modelIt = ifd.tags.find(0x0110);
        if (modelIt != ifd.tags.end()) {
            const TiffTag& modelTag = modelIt->second;
            if (modelTag.type == 2 && modelTag.count > 0) { // ASCII type
                size_t offset;
                if (modelTag.count <= 4) {
                    // Value stored directly in valueOffset
                    offset = reinterpret_cast<size_t>(&modelTag.valueOffset);
                } else {
                    // Value stored at offset
                    offset = modelTag.valueOffset;
                }
                
                if (offset + modelTag.count <= size) {
                    const char* modelStr = reinterpret_cast<const char*>(data + offset);
                    // Create string with proper length, remove null terminator
                    std::string model(modelStr, modelTag.count - 1);
                    
                    // Clean up the string (remove trailing nulls and spaces)
                    while (!model.empty() && (model.back() == '\0' || model.back() == ' ')) {
                        model.pop_back();
                    }
                    
                    return model;
                }
            }
        }
    }
    
    return "UNKNOWN";
}

} // namespace Formats
} // namespace RawExtractor