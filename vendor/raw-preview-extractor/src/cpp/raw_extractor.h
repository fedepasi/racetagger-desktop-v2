#pragma once

#include <string>
#include <vector>
#include <memory>
#include <chrono>
#include "cr2_parser.h" // For PreviewInfo definition
// #include "utils/cache.h" // Temporarily disabled due to C++ stdlib issues

namespace RawExtractor {

enum class RawFormat {
    UNKNOWN = 0,
    CR2,
    CR3,
    NEF,
    ARW,
    DNG,
    RAF,
    ORF,
    PEF,
    RW2
};

struct ExtractionOptions {
    size_t targetMinSize = 200 * 1024;     // 200KB
    size_t targetMaxSize = 3 * 1024 * 1024; // 3MB
    Utils::PreviewQuality preferredQuality = Utils::QUALITY_PREVIEW;
    bool useCache = false;
    uint32_t timeoutMs = 5000;              // 5 seconds default timeout
    size_t maxMemoryMb = 100;               // 100MB memory limit
    bool includeMetadata = false;           // Extract EXIF metadata
    bool strictValidation = true;           // Strict JPEG validation
    
    ExtractionOptions() = default;
};

enum class ErrorCode {
    SUCCESS = 0,
    FILE_NOT_FOUND,
    FILE_ACCESS_DENIED,
    INVALID_FORMAT,
    CORRUPTED_FILE,
    TIMEOUT_EXCEEDED,
    MEMORY_LIMIT_EXCEEDED,
    NO_PREVIEWS_FOUND,
    VALIDATION_FAILED,
    UNKNOWN_ERROR
};

struct ErrorInfo {
    ErrorCode code = ErrorCode::SUCCESS;
    std::string message;
    std::string context;
    
    ErrorInfo() = default;
    ErrorInfo(ErrorCode c, const std::string& msg, const std::string& ctx = "") 
        : code(c), message(msg), context(ctx) {}
};

struct ExtractionResult {
    bool success = false;
    ErrorInfo errorInfo;
    std::string error;  // Legacy field for backward compatibility
    RawFormat format = RawFormat::UNKNOWN;
    Formats::PreviewInfo preview;
    std::vector<uint8_t> jpegData;
    
    ExtractionResult() = default;
    
    void setError(ErrorCode code, const std::string& message, const std::string& context = "") {
        errorInfo = ErrorInfo(code, message, context);
        error = message; // Keep backward compatibility
        success = false;
    }
};

class RawExtractor {
public:
    RawExtractor();
    ~RawExtractor();
    
    // Main extraction methods
    ExtractionResult extractPreview(const std::string& filePath, const ExtractionOptions& options = {});
    ExtractionResult extractPreviewFromBuffer(const uint8_t* data, size_t size, const ExtractionOptions& options = {});
    
    // Utility methods
    RawFormat detectFormat(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> getAllPreviews(const uint8_t* data, size_t size, RawFormat format);
    
private:
    bool initialized_;
    // Utils::PreviewCache cache_; // Temporarily disabled
    
    // Timeout and memory management
    class TimeoutManager {
    public:
        TimeoutManager(uint32_t timeoutMs);
        bool isExpired() const;
        void reset();
    private:
        uint32_t timeoutMs_;
        std::chrono::steady_clock::time_point startTime_;
    };
    
    bool checkMemoryUsage(size_t currentMemory, const ExtractionOptions& options);
    ErrorCode validateFile(const uint8_t* data, size_t size);
    
    // Performance optimizations
    std::string generateCacheKey(const std::string& filePath, const ExtractionOptions& options);
    bool tryFromCache(const std::string& cacheKey, ExtractionResult& result);
    void storeInCache(const std::string& cacheKey, const ExtractionResult& result);
    
    // Fast format detection optimizations
    RawFormat detectFormatFast(const uint8_t* data, size_t size);
    bool isLikelyValidPreview(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview);
    
    // Format-specific extraction
    std::vector<Formats::PreviewInfo> extractCr2Previews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractCr3Previews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractNefPreviews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractArwPreviews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractDngPreviews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractRafPreviews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractOrfPreviews(const uint8_t* data, size_t size);
    std::vector<Formats::PreviewInfo> extractRw2Previews(const uint8_t* data, size_t size);
    
    Formats::PreviewInfo selectBestPreview(const std::vector<Formats::PreviewInfo>& previews, 
                                         const ExtractionOptions& options, RawFormat format);
    
    bool validatePreview(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview, 
                        const ExtractionOptions& options);
    std::vector<uint8_t> extractJpegData(const uint8_t* data, size_t size, const Formats::PreviewInfo& preview);
};

} // namespace RawExtractor