#include "tiff_parser.h"
#include "cr2_parser.h" // For complete PreviewInfo definition
#include "endian.h"
#include <cstring>
#include <algorithm>

namespace RawExtractor {
namespace Formats {

// TIFF Tag definitions
const uint16_t TIFF_TAG_IMAGE_WIDTH = 0x0100;
const uint16_t TIFF_TAG_IMAGE_HEIGHT = 0x0101;
const uint16_t TIFF_TAG_STRIP_OFFSETS = 0x0111;
const uint16_t TIFF_TAG_STRIP_BYTE_COUNTS = 0x0117;
const uint16_t TIFF_TAG_ORIENTATION = 0x0112;
const uint16_t TIFF_TAG_SUB_IFDS = 0x014A;
const uint16_t TIFF_TAG_NEW_SUBFILE_TYPE = 0x00FE;
const uint16_t TIFF_TAG_COMPRESSION = 0x0103;
const uint16_t TIFF_TAG_JPEG_INTERCHANGE_FORMAT = 0x0201;
const uint16_t TIFF_TAG_JPEG_INTERCHANGE_FORMAT_LENGTH = 0x0202;

// TIFF Type definitions
const uint16_t TIFF_TYPE_BYTE = 1;
const uint16_t TIFF_TYPE_ASCII = 2;
const uint16_t TIFF_TYPE_SHORT = 3;
const uint16_t TIFF_TYPE_LONG = 4;
const uint16_t TIFF_TYPE_RATIONAL = 5;

TiffParser::TiffParser() : littleEndian_(true) {}

bool TiffParser::parseHeader(const uint8_t* data, size_t size) {
    if (size < 8) {
        return false;
    }

    // Check TIFF header
    littleEndian_ = Utils::EndianUtils::detectEndianness(data);
    
    // Check magic number (0x002A)
    uint16_t magic = Utils::EndianUtils::readUInt16(data + 2, littleEndian_);
    if (magic != 0x002A) {
        return false;
    }

    // Read first IFD offset
    firstIfdOffset_ = Utils::EndianUtils::readUInt32(data + 4, littleEndian_);
    
    return true;
}

bool TiffParser::parseIfd(const uint8_t* data, size_t size, uint32_t offset, TiffIfd& ifd) {
    if (offset + 2 > size) {
        return false;
    }

    // Read number of directory entries
    uint16_t numEntries = Utils::EndianUtils::readUInt16(data + offset, littleEndian_);
    
    if (offset + 2 + (numEntries * 12) + 4 > size) {
        return false;
    }

    // Parse directory entries
    for (uint16_t i = 0; i < numEntries; i++) {
        uint32_t entryOffset = offset + 2 + (i * 12);
        TiffTag tag = parseTag(data, size, entryOffset);
        
        if (tag.tag != 0) {
            ifd.tags[tag.tag] = tag;
        }
    }

    // Read next IFD offset
    uint32_t nextIfdOffset = offset + 2 + (numEntries * 12);
    ifd.nextIfdOffset = Utils::EndianUtils::readUInt32(data + nextIfdOffset, littleEndian_);

    return true;
}

TiffTag TiffParser::parseTag(const uint8_t* data, size_t size, uint32_t offset) {
    TiffTag tag = {};
    
    if (offset + 12 > size) {
        return tag;
    }

    tag.tag = Utils::EndianUtils::readUInt16(data + offset, littleEndian_);
    tag.type = Utils::EndianUtils::readUInt16(data + offset + 2, littleEndian_);
    tag.count = Utils::EndianUtils::readUInt32(data + offset + 4, littleEndian_);
    tag.valueOffset = Utils::EndianUtils::readUInt32(data + offset + 8, littleEndian_);

    return tag;
}

uint32_t TiffParser::getTagValue32(const TiffTag& tag, const uint8_t* data, size_t size) {
    uint32_t typeSize = getTypeSize(tag.type);
    
    if (typeSize == 0) {
        return 0;
    }

    uint32_t totalSize = typeSize * tag.count;
    
    if (totalSize <= 4) {
        // Value is stored in valueOffset directly
        if (tag.type == TIFF_TYPE_SHORT) {
            return Utils::EndianUtils::readUInt16(reinterpret_cast<const uint8_t*>(&tag.valueOffset), littleEndian_);
        } else if (tag.type == TIFF_TYPE_LONG) {
            return tag.valueOffset;
        } else if (tag.type == TIFF_TYPE_BYTE) {
            return tag.valueOffset & 0xFF;
        }
    } else {
        // Value is stored at offset
        if (tag.valueOffset + typeSize > size) {
            return 0;
        }
        
        if (tag.type == TIFF_TYPE_SHORT) {
            return Utils::EndianUtils::readUInt16(data + tag.valueOffset, littleEndian_);
        } else if (tag.type == TIFF_TYPE_LONG) {
            return Utils::EndianUtils::readUInt32(data + tag.valueOffset, littleEndian_);
        }
    }
    
    return 0;
}

std::vector<uint32_t> TiffParser::getTagValues32(const TiffTag& tag, const uint8_t* data, size_t size) {
    std::vector<uint32_t> values;
    uint32_t typeSize = getTypeSize(tag.type);
    
    if (typeSize == 0) {
        return values;
    }

    uint32_t totalSize = typeSize * tag.count;
    const uint8_t* valuePtr;
    
    if (totalSize <= 4) {
        valuePtr = reinterpret_cast<const uint8_t*>(&tag.valueOffset);
    } else {
        if (tag.valueOffset + totalSize > size) {
            return values;
        }
        valuePtr = data + tag.valueOffset;
    }

    for (uint32_t i = 0; i < tag.count; i++) {
        uint32_t value = 0;
        
        if (tag.type == TIFF_TYPE_SHORT) {
            value = Utils::EndianUtils::readUInt16(valuePtr + i * 2, littleEndian_);
        } else if (tag.type == TIFF_TYPE_LONG) {
            value = Utils::EndianUtils::readUInt32(valuePtr + i * 4, littleEndian_);
        } else if (tag.type == TIFF_TYPE_BYTE) {
            value = valuePtr[i];
        }
        
        values.push_back(value);
    }
    
    return values;
}

uint32_t TiffParser::getTypeSize(uint16_t type) {
    switch (type) {
        case TIFF_TYPE_BYTE: return 1;
        case TIFF_TYPE_ASCII: return 1;
        case TIFF_TYPE_SHORT: return 2;
        case TIFF_TYPE_LONG: return 4;
        case TIFF_TYPE_RATIONAL: return 8;
        default: return 0;
    }
}

std::vector<PreviewInfo> TiffParser::findPreviews(const uint8_t* data, size_t size) {
    std::vector<PreviewInfo> previews;
    
    if (!parseHeader(data, size)) {
        return previews;
    }

    // Parse all IFDs starting from the first one
    uint32_t currentOffset = firstIfdOffset_;
    int ifdIndex = 0;
    
    while (currentOffset != 0 && currentOffset < size) {
        TiffIfd ifd;
        if (!parseIfd(data, size, currentOffset, ifd)) {
            break;
        }
        
        // Check this IFD for previews
        PreviewInfo preview = extractPreviewFromIfd(data, size, ifd, ifdIndex);
        if (preview.offset != 0 && preview.size > 0) {
            previews.push_back(preview);
        }
        
        // Check SubIFDs
        auto subIfdIt = ifd.tags.find(TIFF_TAG_SUB_IFDS);
        if (subIfdIt != ifd.tags.end()) {
            std::vector<uint32_t> subIfdOffsets = getTagValues32(subIfdIt->second, data, size);
            
            for (size_t i = 0; i < subIfdOffsets.size(); i++) {
                TiffIfd subIfd;
                if (parseIfd(data, size, subIfdOffsets[i], subIfd)) {
                    PreviewInfo subPreview = extractPreviewFromIfd(data, size, subIfd, -1 - static_cast<int>(i));
                    if (subPreview.offset != 0 && subPreview.size > 0) {
                        previews.push_back(subPreview);
                    }
                }
            }
        }
        
        currentOffset = ifd.nextIfdOffset;
        ifdIndex++;
    }
    
    return previews;
}

PreviewInfo TiffParser::extractPreviewFromIfd(const uint8_t* data, size_t size, const TiffIfd& ifd, int ifdIndex) {
    PreviewInfo preview = {};
    preview.ifdIndex = ifdIndex;
    
    // Check for JPEG data using StripOffsets/StripByteCounts
    auto stripOffsetsIt = ifd.tags.find(TIFF_TAG_STRIP_OFFSETS);
    auto stripByteCountsIt = ifd.tags.find(TIFF_TAG_STRIP_BYTE_COUNTS);
    
    if (stripOffsetsIt != ifd.tags.end() && stripByteCountsIt != ifd.tags.end()) {
        std::vector<uint32_t> offsets = getTagValues32(stripOffsetsIt->second, data, size);
        std::vector<uint32_t> byteCounts = getTagValues32(stripByteCountsIt->second, data, size);
        
        if (!offsets.empty() && !byteCounts.empty() && offsets.size() == byteCounts.size()) {
            preview.offset = offsets[0];
            preview.size = byteCounts[0];
        }
    }
    
    // Check for JPEG data using JpegInterchangeFormat tags (Nikon style)
    auto jpegOffsetIt = ifd.tags.find(TIFF_TAG_JPEG_INTERCHANGE_FORMAT);
    auto jpegLengthIt = ifd.tags.find(TIFF_TAG_JPEG_INTERCHANGE_FORMAT_LENGTH);
    
    if (jpegOffsetIt != ifd.tags.end() && jpegLengthIt != ifd.tags.end()) {
        preview.offset = getTagValue32(jpegOffsetIt->second, data, size);
        preview.size = getTagValue32(jpegLengthIt->second, data, size);
    }
    
    // Get image dimensions
    auto widthIt = ifd.tags.find(TIFF_TAG_IMAGE_WIDTH);
    auto heightIt = ifd.tags.find(TIFF_TAG_IMAGE_HEIGHT);
    
    if (widthIt != ifd.tags.end()) {
        preview.width = getTagValue32(widthIt->second, data, size);
    }
    
    if (heightIt != ifd.tags.end()) {
        preview.height = getTagValue32(heightIt->second, data, size);
    }
    
    // Check compression type
    auto compressionIt = ifd.tags.find(TIFF_TAG_COMPRESSION);
    if (compressionIt != ifd.tags.end()) {
        uint32_t compression = getTagValue32(compressionIt->second, data, size);
        preview.isJpeg = (compression == 6 || compression == 7); // Old-style JPEG or JPEG
    }
    
    // Check subfile type
    auto subfileTypeIt = ifd.tags.find(TIFF_TAG_NEW_SUBFILE_TYPE);
    if (subfileTypeIt != ifd.tags.end()) {
        preview.subfileType = getTagValue32(subfileTypeIt->second, data, size);
    }
    
    return preview;
}

PreviewInfo TiffParser::selectBestPreview(const std::vector<PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    // Sort previews by preference
    std::vector<PreviewInfo> sortedPreviews = previews;
    
    std::sort(sortedPreviews.begin(), sortedPreviews.end(), 
        [](const PreviewInfo& a, const PreviewInfo& b) {
            // Prefer JPEG compression
            if (a.isJpeg != b.isJpeg) {
                return a.isJpeg > b.isJpeg;
            }
            
            // Prefer size range 200KB - 3MB
            const size_t MIN_SIZE = 200 * 1024;
            const size_t MAX_SIZE = 3 * 1024 * 1024;
            
            bool aInRange = (a.size >= MIN_SIZE && a.size <= MAX_SIZE);
            bool bInRange = (b.size >= MIN_SIZE && b.size <= MAX_SIZE);
            
            if (aInRange != bInRange) {
                return aInRange > bInRange;
            }
            
            // Within range, prefer larger previews
            if (aInRange && bInRange) {
                return a.size > b.size;
            }
            
            // Outside range, prefer the one closest to our target
            size_t targetSize = 1024 * 1024; // 1MB target
            size_t aDiff = (a.size > targetSize) ? a.size - targetSize : targetSize - a.size;
            size_t bDiff = (b.size > targetSize) ? b.size - targetSize : targetSize - b.size;
            
            return aDiff < bDiff;
        });
    
    return sortedPreviews[0];
}

uint16_t TiffParser::extractOrientation(const uint8_t* data, size_t size) {
    if (!parseHeader(data, size)) {
        return 1; // Default to normal orientation
    }
    
    // Parse IFD0 to find orientation tag
    TiffIfd ifd0;
    if (!parseIfd(data, size, firstIfdOffset_, ifd0)) {
        return 1;
    }
    
    // Look for orientation tag (0x0112)
    auto orientationIt = ifd0.tags.find(TIFF_TAG_ORIENTATION);
    if (orientationIt != ifd0.tags.end()) {
        uint16_t orientation = static_cast<uint16_t>(getTagValue32(orientationIt->second, data, size));
        
        // Validate orientation value (should be 1-8)
        if (orientation >= 1 && orientation <= 8) {
            return orientation;
        }
    }
    
    return 1; // Default to normal orientation
}

} // namespace Formats
} // namespace RawExtractor