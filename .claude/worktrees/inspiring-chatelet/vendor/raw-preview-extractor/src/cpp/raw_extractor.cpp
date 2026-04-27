#include "raw_extractor.h"
#include "memory_map.h"
#include "jpeg_validator.h"
#include "cr2_parser.h"
#include "cr3_parser.h"
#include "nef_parser.h"
#include "arw_parser.h"
#include "dng_parser.h"
#include "raf_parser.h"
#include "orf_parser.h"
#include "rw2_parser.h"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#else
#include <sys/resource.h>
#include <unistd.h>
#endif

namespace RawExtractor {

// TimeoutManager implementation
RawExtractor::TimeoutManager::TimeoutManager(uint32_t timeoutMs) 
    : timeoutMs_(timeoutMs), startTime_(std::chrono::steady_clock::now()) {
}

bool RawExtractor::TimeoutManager::isExpired() const {
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime_);
    return elapsed.count() >= static_cast<long>(timeoutMs_);
}

void RawExtractor::TimeoutManager::reset() {
    startTime_ = std::chrono::steady_clock::now();
}

RawExtractor::RawExtractor() : initialized_(true) {
}

RawExtractor::~RawExtractor() {
}

bool RawExtractor::checkMemoryUsage(size_t currentMemory, const ExtractionOptions& options) {
    size_t maxMemoryBytes = options.maxMemoryMb * 1024 * 1024;
    
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS_EX pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS*)&pmc, sizeof(pmc))) {
        size_t processMemory = pmc.WorkingSetSize;
        return (processMemory + currentMemory) <= maxMemoryBytes;
    }
#else
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) == 0) {
        size_t processMemory = usage.ru_maxrss * 1024; // ru_maxrss is in KB on Linux, bytes on macOS
        #ifdef __APPLE__
        // On macOS, ru_maxrss is already in bytes
        #else
        // On Linux, convert from KB to bytes
        processMemory *= 1024;
        #endif
        return (processMemory + currentMemory) <= maxMemoryBytes;
    }
#endif
    
    // Fallback: just check the current allocation against limit
    return currentMemory <= maxMemoryBytes;
}

ErrorCode RawExtractor::validateFile(const uint8_t* data, size_t size) {
    if (!data) {
        return ErrorCode::INVALID_FORMAT;
    }
    
    if (size < 16) {
        return ErrorCode::CORRUPTED_FILE;
    }
    
    // Basic file structure validation
    // Check if file starts with valid headers
    bool hasValidHeader = false;
    
    // Check for common RAW file headers
    if (size >= 4) {
        // TIFF-based formats (CR2, NEF, ARW, DNG, etc.)
        if ((data[0] == 'I' && data[1] == 'I' && data[2] == 0x2A && data[3] == 0x00) ||  // Little-endian TIFF
            (data[0] == 'M' && data[1] == 'M' && data[2] == 0x00 && data[3] == 0x2A)) {  // Big-endian TIFF
            hasValidHeader = true;
        }
        
        // CR3 format (ISOBMFF/MP4 based)
        if (size >= 20) {
            uint32_t boxType = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
            if (boxType == 0x66747970) { // "ftyp"
                hasValidHeader = true;
            }
        }
    }
    
    return hasValidHeader ? ErrorCode::SUCCESS : ErrorCode::INVALID_FORMAT;
}

ExtractionResult RawExtractor::extractPreview(const std::string& filePath, const ExtractionOptions& options) {
    ExtractionResult result;
    
    if (!initialized_) {
        result.setError(ErrorCode::UNKNOWN_ERROR, "RawExtractor not initialized");
        return result;
    }
    
    // Try cache first if enabled - TEMPORARILY DISABLED
    // if (options.useCache) {
    //     std::string cacheKey = generateCacheKey(filePath, options);
    //     if (tryFromCache(cacheKey, result)) {
    //         return result;
    //     }
    // }
    
    // Use memory-mapped file for better performance
    Utils::MemoryMappedFile mmf;
    if (!mmf.open(filePath)) {
        result.setError(ErrorCode::FILE_NOT_FOUND, "Failed to open file: " + filePath, filePath);
        return result;
    }
    
    result = extractPreviewFromBuffer(mmf.data(), mmf.size(), options);
    
    // Store in cache if successful and caching is enabled - TEMPORARILY DISABLED
    // if (result.success && options.useCache) {
    //     std::string cacheKey = generateCacheKey(filePath, options);
    //     storeInCache(cacheKey, result);
    // }
    
    return result;
}

ExtractionResult RawExtractor::extractPreviewFromBuffer(const uint8_t* data, size_t size, const ExtractionOptions& options) {
    ExtractionResult result;
    TimeoutManager timeout(options.timeoutMs);
    
    if (!initialized_) {
        result.setError(ErrorCode::UNKNOWN_ERROR, "RawExtractor not initialized");
        return result;
    }
    
    if (!data || size < 16) {
        result.setError(ErrorCode::INVALID_FORMAT, "Invalid data buffer");
        return result;
    }
    
    // Check memory usage only for very large files (>200MB)
    // Most RAW files are 10-50MB and should be processed without issue
    if (size > 200 * 1024 * 1024 && !checkMemoryUsage(size, options)) {
        result.setError(ErrorCode::MEMORY_LIMIT_EXCEEDED, "File size exceeds memory limit");
        return result;
    }
    
    // Validate file structure
    ErrorCode validationResult = validateFile(data, size);
    if (validationResult != ErrorCode::SUCCESS) {
        std::string errorMsg = (validationResult == ErrorCode::INVALID_FORMAT) ? 
            "Invalid file format" : "Corrupted file";
        result.setError(validationResult, errorMsg);
        return result;
    }
    
    // Check timeout
    if (timeout.isExpired()) {
        result.setError(ErrorCode::TIMEOUT_EXCEEDED, "Operation timed out during validation");
        return result;
    }
    
    // Fast format detection first
    result.format = detectFormatFast(data, size);
    if (result.format == RawFormat::UNKNOWN) {
        // Fallback to full detection if fast detection fails
        result.format = detectFormat(data, size);
        if (result.format == RawFormat::UNKNOWN) {
            result.setError(ErrorCode::INVALID_FORMAT, "Unsupported or unrecognized RAW format");
            return result;
        }
    }
    
    // Check timeout again
    if (timeout.isExpired()) {
        result.setError(ErrorCode::TIMEOUT_EXCEEDED, "Operation timed out during format detection");
        return result;
    }
    
    // Extract all available previews
    std::vector<Formats::PreviewInfo> previews = getAllPreviews(data, size, result.format);
    if (previews.empty()) {
        result.setError(ErrorCode::NO_PREVIEWS_FOUND, "No previews found in RAW file");
        return result;
    }
    
    // Check timeout after preview extraction
    if (timeout.isExpired()) {
        result.setError(ErrorCode::TIMEOUT_EXCEEDED, "Operation timed out during preview extraction");
        return result;
    }
    
    // Select the best preview based on options
    result.preview = selectBestPreview(previews, options, result.format);
    if (result.preview.offset == 0 || result.preview.size == 0) {
        result.setError(ErrorCode::NO_PREVIEWS_FOUND, "No suitable preview found matching criteria");
        return result;
    }
    
    // Validate and extract JPEG data
    if (!validatePreview(data, size, result.preview, options)) {
        result.setError(ErrorCode::VALIDATION_FAILED, "Selected preview failed validation");
        return result;
    }
    
    // Final timeout check
    if (timeout.isExpired()) {
        result.setError(ErrorCode::TIMEOUT_EXCEEDED, "Operation timed out during validation");
        return result;
    }
    
    result.jpegData = extractJpegData(data, size, result.preview);
    if (result.jpegData.empty()) {
        result.setError(ErrorCode::UNKNOWN_ERROR, "Failed to extract JPEG data");
        return result;
    }
    
    result.success = true;
    return result;
}

RawFormat RawExtractor::detectFormat(const uint8_t* data, size_t size) {
    if (Formats::Cr2Parser::canParse(data, size)) {
        return RawFormat::CR2;
    }
    if (Formats::Cr3Parser::canParse(data, size)) {
        return RawFormat::CR3;
    }
    if (Formats::NefParser::canParse(data, size)) {
        return RawFormat::NEF;
    }
    if (Formats::ArwParser::canParse(data, size)) {
        return RawFormat::ARW;
    }
    if (Formats::DngParser::canParse(data, size)) {
        return RawFormat::DNG;
    }
    if (Formats::RafParser::canParse(data, size)) {
        return RawFormat::RAF;
    }
    if (Formats::OrfParser::canParse(data, size)) {
        return RawFormat::ORF;
    }
    if (Formats::Rw2Parser::canParse(data, size)) {
        return RawFormat::RW2;
    }
    
    return RawFormat::UNKNOWN;
}

std::vector<Formats::PreviewInfo> RawExtractor::getAllPreviews(const uint8_t* data, size_t size, RawFormat format) {
    switch (format) {
        case RawFormat::CR2:
            return extractCr2Previews(data, size);
        case RawFormat::CR3:
            return extractCr3Previews(data, size);
        case RawFormat::NEF:
            return extractNefPreviews(data, size);
        case RawFormat::ARW:
            return extractArwPreviews(data, size);
        case RawFormat::DNG:
            return extractDngPreviews(data, size);
        case RawFormat::RAF:
            return extractRafPreviews(data, size);
        case RawFormat::ORF:
            return extractOrfPreviews(data, size);
        case RawFormat::RW2:
            return extractRw2Previews(data, size);
        default:
            return {};
    }
}

std::vector<Formats::PreviewInfo> RawExtractor::extractCr2Previews(const uint8_t* data, size_t size) {
    return Formats::Cr2Parser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractCr3Previews(const uint8_t* data, size_t size) {
    return Formats::Cr3Parser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractNefPreviews(const uint8_t* data, size_t size) {
    return Formats::NefParser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractArwPreviews(const uint8_t* data, size_t size) {
    return Formats::ArwParser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractDngPreviews(const uint8_t* data, size_t size) {
    return Formats::DngParser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractRafPreviews(const uint8_t* data, size_t size) {
    return Formats::RafParser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractOrfPreviews(const uint8_t* data, size_t size) {
    return Formats::OrfParser::extractPreviews(data, size);
}

std::vector<Formats::PreviewInfo> RawExtractor::extractRw2Previews(const uint8_t* data, size_t size) {
    return Formats::Rw2Parser::extractPreviews(data, size);
}

Formats::PreviewInfo RawExtractor::selectBestPreview(const std::vector<Formats::PreviewInfo>& previews, 
                                                   const ExtractionOptions& options, RawFormat format) {
    if (previews.empty()) {
        return {};
    }
    
    // First, try format-specific selection
    Formats::PreviewInfo formatBest;
    switch (format) {
        case RawFormat::CR2:
            formatBest = Formats::Cr2Parser::selectBestPreview(previews);
            break;
        case RawFormat::CR3:
            formatBest = Formats::Cr3Parser::selectBestPreview(previews);
            break;
        case RawFormat::NEF:
            formatBest = Formats::NefParser::selectBestPreview(previews);
            break;
        case RawFormat::ARW:
            formatBest = Formats::ArwParser::selectBestPreview(previews);
            break;
        case RawFormat::DNG:
            formatBest = Formats::DngParser::selectBestPreview(previews);
            break;
        case RawFormat::RAF:
            formatBest = Formats::RafParser::selectBestPreview(previews);
            break;
        case RawFormat::ORF:
            formatBest = Formats::OrfParser::selectBestPreview(previews);
            break;
        case RawFormat::RW2:
            formatBest = Formats::Rw2Parser::selectBestPreview(previews);
            break;
        default:
            break;
    }
    
    // If format-specific selection found a good match within our size range, use it
    if (formatBest.size >= options.targetMinSize && formatBest.size <= options.targetMaxSize) {
        return formatBest;
    }
    
    // Otherwise, apply our own selection logic based on options
    std::vector<Formats::PreviewInfo> candidates = previews;
    
    // Filter by size range
    candidates.erase(
        std::remove_if(candidates.begin(), candidates.end(),
            [&options](const Formats::PreviewInfo& p) {
                return p.size < options.targetMinSize || p.size > options.targetMaxSize;
            }),
        candidates.end()
    );
    
    // If no candidates in range, expand the search
    if (candidates.empty()) {
        candidates = previews;
    }
    
    // Sort by preference: quality match, then size (larger is better)
    std::sort(candidates.begin(), candidates.end(),
        [&options](const Formats::PreviewInfo& a, const Formats::PreviewInfo& b) {
            // Prefer matching quality
            bool aQualityMatch = (a.quality == options.preferredQuality);
            bool bQualityMatch = (b.quality == options.preferredQuality);
            
            if (aQualityMatch != bQualityMatch) {
                return aQualityMatch > bQualityMatch;
            }
            
            // Then prefer larger size
            return a.size > b.size;
        });
    
    return candidates.empty() ? Formats::PreviewInfo{} : candidates[0];
}

bool RawExtractor::validatePreview(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview, 
                                   const ExtractionOptions& options) {
    if (preview.offset + preview.size > size) {
        return false;
    }
    
    // Check if preview size exceeds memory limits
    if (!checkMemoryUsage(preview.size, options)) {
        return false;
    }
    
    const uint8_t* jpegData = data + preview.offset;
    
    if (options.strictValidation) {
        // Perform thorough JPEG validation
        return Utils::JpegValidator::isValidJpeg(jpegData, preview.size);
    } else {
        // Basic validation - just check JPEG headers
        return preview.size >= 2 && jpegData[0] == 0xFF && jpegData[1] == 0xD8;
    }
}

std::vector<uint8_t> RawExtractor::extractJpegData(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview) {
    std::vector<uint8_t> result;
    
    if (preview.offset + preview.size > size) {
        return result;
    }
    
    const uint8_t* jpegData = data + preview.offset;
    result.assign(jpegData, jpegData + preview.size);
    
    return result;
}

// Performance optimization implementations
std::string RawExtractor::generateCacheKey(const std::string& filePath, const ExtractionOptions& options) {
    std::ostringstream oss;
    oss << filePath << "|" << options.targetMinSize << "|" << options.targetMaxSize << "|" 
        << static_cast<int>(options.preferredQuality) << "|" << options.strictValidation;
    return oss.str();
}

bool RawExtractor::tryFromCache(const std::string& cacheKey, ExtractionResult& result) {
    // TEMPORARILY DISABLED - cache functionality
    return false;
    // std::vector<uint8_t> cachedData;
    // if (cache_.get(cacheKey, cachedData)) {
    //     result.success = true;
    //     result.jpegData = std::move(cachedData);
    //     // Note: Other preview info would need to be cached separately for full implementation
    //     return true;
    // }
    // return false;
}

void RawExtractor::storeInCache(const std::string& cacheKey, const ExtractionResult& result) {
    // TEMPORARILY DISABLED - cache functionality
}

RawFormat RawExtractor::detectFormatFast(const uint8_t* data, size_t size) {
    if (size < 16) return RawFormat::UNKNOWN;
    
    // Fast checks for most common formats
    
    // TIFF-based formats (CR2, NEF, ARW, DNG) - check magic bytes only
    if ((data[0] == 'I' && data[1] == 'I' && data[2] == 0x2A && data[3] == 0x00) ||
        (data[0] == 'M' && data[1] == 'M' && data[2] == 0x00 && data[3] == 0x2A)) {
        
        // Quick heuristics for specific formats without full parsing
        if (size > 100) {
            // Look for format-specific signatures in first 100 bytes
            for (size_t i = 0; i < std::min(size_t(100), size - 5); i++) {
                if (memcmp(data + i, "Canon", 5) == 0) return RawFormat::CR2;
                if (memcmp(data + i, "NIKON", 5) == 0) return RawFormat::NEF;
                if (memcmp(data + i, "SONY", 4) == 0) return RawFormat::ARW;
            }
        }
        
        // If no specific signature found, assume it's a generic TIFF-based RAW
        return RawFormat::DNG; // Default TIFF-based format
    }
    
    // CR3 format (ISO BMFF)
    if (size >= 20) {
        uint32_t boxSize = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        uint32_t boxType = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
        if (boxType == 0x66747970) { // "ftyp"
            // Check brand for CR3
            uint32_t brand = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11];
            if (brand == 0x63723320 || brand == 0x63727820) { // "cr3 " or "crx "
                return RawFormat::CR3;
            }
        }
    }
    
    // RAF format (Fujifilm)
    if (size >= 16 && memcmp(data, "FUJIFILMCCD-RAW", 15) == 0) {
        return RawFormat::RAF;
    }
    
    return RawFormat::UNKNOWN;
}

bool RawExtractor::isLikelyValidPreview(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview) {
    if (preview.offset + preview.size > size) return false;
    
    const uint8_t* jpegData = data + preview.offset;
    
    // Quick JPEG signature check
    if (preview.size < 4 || jpegData[0] != 0xFF || jpegData[1] != 0xD8) {
        return false;
    }
    
    // Check for JPEG end marker in last few bytes
    if (preview.size >= 4) {
        const uint8_t* end = jpegData + preview.size - 2;
        if (end[0] == 0xFF && end[1] == 0xD9) {
            return true;
        }
    }
    
    // If no end marker found, it might still be valid but truncated
    return preview.size > 1000; // Assume previews should be at least 1KB
}

} // namespace RawExtractor