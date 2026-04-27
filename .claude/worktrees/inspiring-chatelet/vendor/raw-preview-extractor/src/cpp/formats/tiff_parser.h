#pragma once

#include <cstdint>
#include <cstddef>
#include <map>
#include <vector>

namespace RawExtractor {
namespace Formats {

struct TiffTag {
    uint16_t tag;
    uint16_t type;
    uint32_t count;
    uint32_t valueOffset;
};

struct TiffIfd {
    std::map<uint16_t, TiffTag> tags;
    uint32_t nextIfdOffset;
};

// Forward declaration - actual definition in cr2_parser.h
struct PreviewInfo;

class TiffParser {
public:
    TiffParser();
    
    bool parseHeader(const uint8_t* data, size_t size);
    bool parseIfd(const uint8_t* data, size_t size, uint32_t offset, TiffIfd& ifd);
    TiffTag parseTag(const uint8_t* data, size_t size, uint32_t offset);
    
    uint32_t getTagValue32(const TiffTag& tag, const uint8_t* data, size_t size);
    std::vector<uint32_t> getTagValues32(const TiffTag& tag, const uint8_t* data, size_t size);
    
    std::vector<PreviewInfo> findPreviews(const uint8_t* data, size_t size);
    PreviewInfo extractPreviewFromIfd(const uint8_t* data, size_t size, const TiffIfd& ifd, int ifdIndex);
    
    uint16_t extractOrientation(const uint8_t* data, size_t size);
    
    static PreviewInfo selectBestPreview(const std::vector<PreviewInfo>& previews);
    
private:
    bool littleEndian_;
    uint32_t firstIfdOffset_;
    
    uint32_t getTypeSize(uint16_t type);
};

} // namespace Formats
} // namespace RawExtractor