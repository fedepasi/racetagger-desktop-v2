#include <napi.h>
#include "raw_extractor.h"
#include "utils/memory_map.h"
#include "formats/nef_parser.h"
#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <algorithm>

// Don't use using namespace to avoid conflicts

// Preview mapping structures for intelligent preview selection
struct PreviewMapping {
    int fullPreviewIndex;
    int mediumPreviewIndex;
    bool useSmartSelection; // true to use size-based selection instead of fixed indices
};

// Nikon model mappings based on camera model
static const std::map<std::string, PreviewMapping> nikonModelMappings = {
    // Serie Z recenti (spesso problematiche con ordine preview)
    {"Z 9", {-1, -2, true}},      // Usa selezione per dimensione
    {"Z 8", {-1, -2, true}},      // Problema noto: prima preview piccola
    {"Z 7II", {-1, -2, true}},
    {"Z 6III", {-1, -2, true}},
    {"Z 6II", {-1, -2, true}},
    {"Z 6", {0, 1, false}},       // Z6 prima gen funziona con ordine tradizionale
    {"Z 5", {-1, -2, true}},
    {"Z fc", {-1, -2, true}},
    {"Z 30", {-1, -2, true}},
    
    // DSLR recenti
    {"D850", {-1, -2, true}},
    {"D780", {-1, -2, true}},
    {"D6", {-1, -2, true}},
    
    // DSLR tradizionali (ordine prevedibile)
    {"D750", {0, 1, false}},
    {"D810", {0, 1, false}},
    {"D610", {0, 1, false}},
    {"D7500", {0, 1, false}},
    {"D7200", {0, 1, false}},
    {"D5600", {0, 1, false}},
    {"D3500", {0, 1, false}}
};

// Format mappings per altri formati RAW
static const std::map<RawExtractor::RawFormat, PreviewMapping> formatMappings = {
    {RawExtractor::RawFormat::ARW, {2, 0, false}},  // Sony: Full=index2, Medium=index0
    {RawExtractor::RawFormat::CR2, {0, 1, false}},  // Canon CR2: tradizionale
    {RawExtractor::RawFormat::CR3, {2, 1, false}},  // Canon CR3: MDAT=2, PRVW=1
    {RawExtractor::RawFormat::DNG, {0, 1, false}},  // Adobe DNG: tradizionale
    {RawExtractor::RawFormat::RAF, {0, 1, false}},  // Fuji: tradizionale
    {RawExtractor::RawFormat::ORF, {0, 1, false}},  // Olympus: tradizionale
    {RawExtractor::RawFormat::RW2, {0, 1, false}}   // Panasonic: tradizionale
};

// Helper function to convert C++ RawFormat to JavaScript string
std::string formatToString(RawExtractor::RawFormat format) {
    switch (format) {
        case RawExtractor::RawFormat::CR2: return "CR2";
        case RawExtractor::RawFormat::CR3: return "CR3";
        case RawExtractor::RawFormat::NEF: return "NEF";
        case RawExtractor::RawFormat::ARW: return "ARW";
        case RawExtractor::RawFormat::DNG: return "DNG";
        case RawExtractor::RawFormat::RAF: return "RAF";
        case RawExtractor::RawFormat::ORF: return "ORF";
        case RawExtractor::RawFormat::PEF: return "PEF";
        case RawExtractor::RawFormat::RW2: return "RW2";
        default: return "UNKNOWN";
    }
}

// Helper function to convert JavaScript quality string to C++ enum
RawExtractor::Utils::PreviewQuality stringToQuality(const std::string& quality) {
    if (quality == "thumbnail") return RawExtractor::Utils::QUALITY_THUMBNAIL;
    if (quality == "preview") return RawExtractor::Utils::QUALITY_PREVIEW;
    if (quality == "full") return RawExtractor::Utils::QUALITY_FULL;
    return RawExtractor::Utils::QUALITY_PREVIEW; // default
}

// Helper function to convert C++ quality to JavaScript string
std::string qualityToString(RawExtractor::Utils::PreviewQuality quality) {
    switch (quality) {
        case RawExtractor::Utils::QUALITY_THUMBNAIL: return "thumbnail";
        case RawExtractor::Utils::QUALITY_PREVIEW: return "preview";
        case RawExtractor::Utils::QUALITY_FULL: return "full";
        default: return "preview";
    }
}

// Helper functions for smart preview selection
RawExtractor::Formats::PreviewInfo getLargestPreview(const std::vector<RawExtractor::Formats::PreviewInfo>& previews) {
    if (previews.empty()) {
        return {};
    }
    
    auto it = std::max_element(previews.begin(), previews.end(),
        [](const RawExtractor::Formats::PreviewInfo& a, const RawExtractor::Formats::PreviewInfo& b) {
            return a.size < b.size;
        });
    return *it;
}

RawExtractor::Formats::PreviewInfo getSecondLargestPreview(const std::vector<RawExtractor::Formats::PreviewInfo>& previews) {
    if (previews.size() <= 1) {
        return previews.empty() ? RawExtractor::Formats::PreviewInfo{} : previews[0];
    }
    
    std::vector<RawExtractor::Formats::PreviewInfo> sorted = previews;
    std::sort(sorted.begin(), sorted.end(),
        [](const RawExtractor::Formats::PreviewInfo& a, const RawExtractor::Formats::PreviewInfo& b) {
            return a.size > b.size; // Sort in descending order
        });
    
    return sorted[1]; // Return second largest
}

// Helper function to get NEF mapping based on camera model
PreviewMapping getNefMapping(const std::string& model) {
    // Look for specific model patterns
    for (const auto& entry : nikonModelMappings) {
        if (model.find(entry.first) != std::string::npos) {
            return entry.second;
        }
    }
    
    // Default for unknown NEF models: use smart selection
    return {-1, -2, true};
}

// Main extraction function exposed to JavaScript
Napi::Value ExtractPreview(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Validate arguments
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "First argument must be a string (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>();
    
    // Parse options if provided
    RawExtractor::ExtractionOptions options;
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object optionsObj = info[1].As<Napi::Object>();
        
        if (optionsObj.Has("targetSize") && optionsObj.Get("targetSize").IsObject()) {
            Napi::Object targetSize = optionsObj.Get("targetSize").As<Napi::Object>();
            if (targetSize.Has("min") && targetSize.Get("min").IsNumber()) {
                options.targetMinSize = targetSize.Get("min").As<Napi::Number>().Uint32Value();
            }
            if (targetSize.Has("max") && targetSize.Get("max").IsNumber()) {
                options.targetMaxSize = targetSize.Get("max").As<Napi::Number>().Uint32Value();
            }
        }
        
        if (optionsObj.Has("preferQuality") && optionsObj.Get("preferQuality").IsString()) {
            std::string quality = optionsObj.Get("preferQuality").As<Napi::String>();
            options.preferredQuality = stringToQuality(quality);
        }
        
        if (optionsObj.Has("cache") && optionsObj.Get("cache").IsBoolean()) {
            options.useCache = optionsObj.Get("cache").As<Napi::Boolean>();
        }
        
        if (optionsObj.Has("timeout") && optionsObj.Get("timeout").IsNumber()) {
            options.timeoutMs = optionsObj.Get("timeout").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("maxMemory") && optionsObj.Get("maxMemory").IsNumber()) {
            options.maxMemoryMb = optionsObj.Get("maxMemory").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("includeMetadata") && optionsObj.Get("includeMetadata").IsBoolean()) {
            options.includeMetadata = optionsObj.Get("includeMetadata").As<Napi::Boolean>();
        }
        
        if (optionsObj.Has("strictValidation") && optionsObj.Get("strictValidation").IsBoolean()) {
            options.strictValidation = optionsObj.Get("strictValidation").As<Napi::Boolean>();
        }
    }
    
    // Create extractor and extract preview
    RawExtractor::RawExtractor extractor;
    RawExtractor::ExtractionResult result = extractor.extractPreview(filePath, options);
    
    // Create result object
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, result.success));
    
    if (!result.success) {
        resultObj.Set("error", Napi::String::New(env, result.error));
        
        // Add structured error information
        if (result.errorInfo.code != RawExtractor::ErrorCode::SUCCESS) {
            Napi::Object errorInfoObj = Napi::Object::New(env);
            errorInfoObj.Set("code", Napi::Number::New(env, static_cast<int>(result.errorInfo.code)));
            errorInfoObj.Set("message", Napi::String::New(env, result.errorInfo.message));
            if (!result.errorInfo.context.empty()) {
                errorInfoObj.Set("context", Napi::String::New(env, result.errorInfo.context));
            }
            resultObj.Set("errorInfo", errorInfoObj);
        }
        
        return resultObj;
    }
    
    // Create preview object
    Napi::Object previewObj = Napi::Object::New(env);
    previewObj.Set("format", Napi::String::New(env, formatToString(result.format)));
    previewObj.Set("width", Napi::Number::New(env, result.preview.width));
    previewObj.Set("height", Napi::Number::New(env, result.preview.height));
    previewObj.Set("size", Napi::Number::New(env, result.preview.size));
    previewObj.Set("quality", Napi::String::New(env, qualityToString(result.preview.quality)));
    previewObj.Set("type", Napi::String::New(env, result.preview.type));
    previewObj.Set("orientation", Napi::Number::New(env, result.preview.orientation));
    
    // Create buffer for JPEG data
    Napi::Buffer<uint8_t> jpegBuffer = Napi::Buffer<uint8_t>::Copy(env, result.jpegData.data(), result.jpegData.size());
    previewObj.Set("data", jpegBuffer);
    
    resultObj.Set("preview", previewObj);
    
    return resultObj;
}

// Buffer extraction function for in-memory data
Napi::Value ExtractPreviewFromBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Validate arguments
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (buffer)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "First argument must be a Buffer").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    const uint8_t* data = buffer.Data();
    size_t size = buffer.Length();
    
    // Parse options if provided
    RawExtractor::ExtractionOptions options;
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object optionsObj = info[1].As<Napi::Object>();
        
        if (optionsObj.Has("targetSize") && optionsObj.Get("targetSize").IsObject()) {
            Napi::Object targetSize = optionsObj.Get("targetSize").As<Napi::Object>();
            if (targetSize.Has("min") && targetSize.Get("min").IsNumber()) {
                options.targetMinSize = targetSize.Get("min").As<Napi::Number>().Uint32Value();
            }
            if (targetSize.Has("max") && targetSize.Get("max").IsNumber()) {
                options.targetMaxSize = targetSize.Get("max").As<Napi::Number>().Uint32Value();
            }
        }
        
        if (optionsObj.Has("preferQuality") && optionsObj.Get("preferQuality").IsString()) {
            std::string quality = optionsObj.Get("preferQuality").As<Napi::String>();
            options.preferredQuality = stringToQuality(quality);
        }
        
        if (optionsObj.Has("cache") && optionsObj.Get("cache").IsBoolean()) {
            options.useCache = optionsObj.Get("cache").As<Napi::Boolean>();
        }
        
        if (optionsObj.Has("timeout") && optionsObj.Get("timeout").IsNumber()) {
            options.timeoutMs = optionsObj.Get("timeout").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("maxMemory") && optionsObj.Get("maxMemory").IsNumber()) {
            options.maxMemoryMb = optionsObj.Get("maxMemory").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("includeMetadata") && optionsObj.Get("includeMetadata").IsBoolean()) {
            options.includeMetadata = optionsObj.Get("includeMetadata").As<Napi::Boolean>();
        }
        
        if (optionsObj.Has("strictValidation") && optionsObj.Get("strictValidation").IsBoolean()) {
            options.strictValidation = optionsObj.Get("strictValidation").As<Napi::Boolean>();
        }
    }
    
    // Create extractor and extract preview
    RawExtractor::RawExtractor extractor;
    RawExtractor::ExtractionResult result = extractor.extractPreviewFromBuffer(data, size, options);
    
    // Create result object (same as above function)
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, result.success));
    
    if (!result.success) {
        resultObj.Set("error", Napi::String::New(env, result.error));
        
        // Add structured error information
        if (result.errorInfo.code != RawExtractor::ErrorCode::SUCCESS) {
            Napi::Object errorInfoObj = Napi::Object::New(env);
            errorInfoObj.Set("code", Napi::Number::New(env, static_cast<int>(result.errorInfo.code)));
            errorInfoObj.Set("message", Napi::String::New(env, result.errorInfo.message));
            if (!result.errorInfo.context.empty()) {
                errorInfoObj.Set("context", Napi::String::New(env, result.errorInfo.context));
            }
            resultObj.Set("errorInfo", errorInfoObj);
        }
        
        return resultObj;
    }
    
    // Create preview object
    Napi::Object previewObj = Napi::Object::New(env);
    previewObj.Set("format", Napi::String::New(env, formatToString(result.format)));
    previewObj.Set("width", Napi::Number::New(env, result.preview.width));
    previewObj.Set("height", Napi::Number::New(env, result.preview.height));
    previewObj.Set("size", Napi::Number::New(env, result.preview.size));
    previewObj.Set("quality", Napi::String::New(env, qualityToString(result.preview.quality)));
    previewObj.Set("type", Napi::String::New(env, result.preview.type));
    previewObj.Set("orientation", Napi::Number::New(env, result.preview.orientation));
    
    // Create buffer for JPEG data
    Napi::Buffer<uint8_t> jpegBuffer = Napi::Buffer<uint8_t>::Copy(env, result.jpegData.data(), result.jpegData.size());
    previewObj.Set("data", jpegBuffer);
    
    resultObj.Set("preview", previewObj);
    
    return resultObj;
}

// Format detection utility function
Napi::Value DetectFormat(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument (filePath or buffer)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    RawExtractor::RawExtractor extractor;
    RawExtractor::RawFormat format;
    
    if (info[0].IsString()) {
        // File path
        std::string filePath = info[0].As<Napi::String>();
        RawExtractor::Utils::MemoryMappedFile mmf;
        if (!mmf.open(filePath)) {
            return Napi::String::New(env, "UNKNOWN");
        }
        format = extractor.detectFormat(mmf.data(), mmf.size());
    } else if (info[0].IsBuffer()) {
        // Buffer
        Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
        format = extractor.detectFormat(buffer.Data(), buffer.Length());
    } else {
        Napi::TypeError::New(env, "Argument must be a string (filePath) or Buffer").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    return Napi::String::New(env, formatToString(format));
}

// Extract medium preview function - selects preview with 'preview' quality
Napi::Value ExtractMediumPreview(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "First argument must be a string (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>();
    
    // Parse optional options
    uint32_t timeoutMs = 5000;
    bool strictValidation = true;
    
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object optionsObj = info[1].As<Napi::Object>();
        
        if (optionsObj.Has("timeout") && optionsObj.Get("timeout").IsNumber()) {
            timeoutMs = optionsObj.Get("timeout").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("strictValidation") && optionsObj.Get("strictValidation").IsBoolean()) {
            strictValidation = optionsObj.Get("strictValidation").As<Napi::Boolean>();
        }
    }
    
    // Extract medium preview using direct position mapping
    RawExtractor::RawExtractor extractor;
    RawExtractor::ExtractionResult result;
    
    // Open and map file
    RawExtractor::Utils::MemoryMappedFile mmf;
    if (!mmf.open(filePath)) {
        result.success = false;
        result.setError(RawExtractor::ErrorCode::FILE_NOT_FOUND, "Failed to open file: " + filePath, filePath);
    } else {
        // Detect format and get all previews
        RawExtractor::RawFormat format = extractor.detectFormat(mmf.data(), mmf.size());
        std::vector<RawExtractor::Formats::PreviewInfo> allPreviews = extractor.getAllPreviews(mmf.data(), mmf.size(), format);
        
        if (allPreviews.empty()) {
            result.success = false;
            result.setError(RawExtractor::ErrorCode::NO_PREVIEWS_FOUND, "No previews found in RAW file");
        } else {
            // Select medium preview using intelligent mapping
            RawExtractor::Formats::PreviewInfo selectedPreview;
            
            if (format == RawExtractor::RawFormat::NEF) {
                // NEF: Use camera model-specific mapping
                std::string model = RawExtractor::Formats::NefParser::extractCameraModel(mmf.data(), mmf.size());
                PreviewMapping mapping = getNefMapping(model);
                
                if (mapping.useSmartSelection || mapping.mediumPreviewIndex == -2) {
                    selectedPreview = getSecondLargestPreview(allPreviews);
                } else if (mapping.mediumPreviewIndex < static_cast<int>(allPreviews.size())) {
                    selectedPreview = allPreviews[mapping.mediumPreviewIndex];
                } else {
                    selectedPreview = allPreviews.size() > 1 ? allPreviews[1] : allPreviews[0]; // Fallback
                }
            } else {
                // Other formats: Use format-specific mapping
                auto it = formatMappings.find(format);
                if (it != formatMappings.end()) {
                    PreviewMapping mapping = it->second;
                    if (mapping.mediumPreviewIndex < static_cast<int>(allPreviews.size())) {
                        selectedPreview = allPreviews[mapping.mediumPreviewIndex];
                    } else {
                        selectedPreview = allPreviews.size() > 1 ? allPreviews[1] : allPreviews[0]; // Fallback
                    }
                } else {
                    // Default behavior: second preview if available, first otherwise
                    selectedPreview = allPreviews.size() > 1 ? allPreviews[1] : allPreviews[0];
                }
            }
            
            // Validate preview bounds
            if (selectedPreview.offset + selectedPreview.size > mmf.size()) {
                result.success = false;
                result.setError(RawExtractor::ErrorCode::CORRUPTED_FILE, "Preview extends beyond file bounds");
            } else {
                // Extract JPEG data
                std::vector<uint8_t> jpegData(mmf.data() + selectedPreview.offset, 
                                              mmf.data() + selectedPreview.offset + selectedPreview.size);
                
                // Create successful result
                result.success = true;
                result.format = format;
                result.preview = selectedPreview;
                result.jpegData = std::move(jpegData);
                result.errorInfo = RawExtractor::ErrorInfo();
                result.error = "";
            }
        }
    }
    
    // Create result object (same structure as ExtractPreview)
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, result.success));
    
    if (!result.success) {
        resultObj.Set("error", Napi::String::New(env, result.error));
        
        if (result.errorInfo.code != RawExtractor::ErrorCode::SUCCESS) {
            Napi::Object errorInfoObj = Napi::Object::New(env);
            errorInfoObj.Set("code", Napi::Number::New(env, static_cast<int>(result.errorInfo.code)));
            errorInfoObj.Set("message", Napi::String::New(env, result.errorInfo.message));
            if (!result.errorInfo.context.empty()) {
                errorInfoObj.Set("context", Napi::String::New(env, result.errorInfo.context));
            }
            resultObj.Set("errorInfo", errorInfoObj);
        }
        
        return resultObj;
    }
    
    // Create preview object
    Napi::Object previewObj = Napi::Object::New(env);
    previewObj.Set("format", Napi::String::New(env, formatToString(result.format)));
    previewObj.Set("width", Napi::Number::New(env, result.preview.width));
    previewObj.Set("height", Napi::Number::New(env, result.preview.height));
    previewObj.Set("size", Napi::Number::New(env, result.preview.size));
    previewObj.Set("quality", Napi::String::New(env, qualityToString(result.preview.quality)));
    previewObj.Set("type", Napi::String::New(env, result.preview.type));
    previewObj.Set("orientation", Napi::Number::New(env, result.preview.orientation));
    
    // Create buffer for JPEG data
    Napi::Buffer<uint8_t> jpegBuffer = Napi::Buffer<uint8_t>::Copy(env, result.jpegData.data(), result.jpegData.size());
    previewObj.Set("data", jpegBuffer);
    
    resultObj.Set("preview", previewObj);
    
    return resultObj;
}

// Extract full/high preview function - selects preview with 'full' quality
Napi::Value ExtractFullPreview(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "First argument must be a string (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>();
    
    // Parse optional options
    uint32_t timeoutMs = 5000;
    bool strictValidation = true;
    
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object optionsObj = info[1].As<Napi::Object>();
        
        if (optionsObj.Has("timeout") && optionsObj.Get("timeout").IsNumber()) {
            timeoutMs = optionsObj.Get("timeout").As<Napi::Number>().Uint32Value();
        }
        
        if (optionsObj.Has("strictValidation") && optionsObj.Get("strictValidation").IsBoolean()) {
            strictValidation = optionsObj.Get("strictValidation").As<Napi::Boolean>();
        }
    }
    
    // Extract full preview using direct position mapping  
    RawExtractor::RawExtractor extractor;
    RawExtractor::ExtractionResult result;
    
    // Open and map file
    RawExtractor::Utils::MemoryMappedFile mmf;
    if (!mmf.open(filePath)) {
        result.success = false;
        result.setError(RawExtractor::ErrorCode::FILE_NOT_FOUND, "Failed to open file: " + filePath, filePath);
    } else {
        // Detect format and get all previews
        RawExtractor::RawFormat format = extractor.detectFormat(mmf.data(), mmf.size());
        std::vector<RawExtractor::Formats::PreviewInfo> allPreviews = extractor.getAllPreviews(mmf.data(), mmf.size(), format);
        
        if (allPreviews.empty()) {
            result.success = false;
            result.setError(RawExtractor::ErrorCode::NO_PREVIEWS_FOUND, "No previews found in RAW file");
        } else {
            // Select full preview using intelligent mapping
            RawExtractor::Formats::PreviewInfo selectedPreview;
            
            if (format == RawExtractor::RawFormat::NEF) {
                // NEF: Use camera model-specific mapping
                std::string model = RawExtractor::Formats::NefParser::extractCameraModel(mmf.data(), mmf.size());
                PreviewMapping mapping = getNefMapping(model);
                
                if (mapping.useSmartSelection || mapping.fullPreviewIndex == -1) {
                    selectedPreview = getLargestPreview(allPreviews);
                } else if (mapping.fullPreviewIndex < static_cast<int>(allPreviews.size())) {
                    selectedPreview = allPreviews[mapping.fullPreviewIndex];
                } else {
                    selectedPreview = allPreviews[0]; // Fallback
                }
            } else {
                // Other formats: Use format-specific mapping
                auto it = formatMappings.find(format);
                if (it != formatMappings.end()) {
                    PreviewMapping mapping = it->second;
                    if (mapping.fullPreviewIndex < static_cast<int>(allPreviews.size())) {
                        selectedPreview = allPreviews[mapping.fullPreviewIndex];
                    } else {
                        selectedPreview = allPreviews[0]; // Fallback
                    }
                } else {
                    selectedPreview = allPreviews[0]; // Default behavior
                }
            }
            
            // Validate preview bounds
            if (selectedPreview.offset + selectedPreview.size > mmf.size()) {
                result.success = false;
                result.setError(RawExtractor::ErrorCode::CORRUPTED_FILE, "Preview extends beyond file bounds");
            } else {
                // Extract JPEG data
                std::vector<uint8_t> jpegData(mmf.data() + selectedPreview.offset, 
                                              mmf.data() + selectedPreview.offset + selectedPreview.size);
                
                // Create successful result
                result.success = true;
                result.format = format;
                result.preview = selectedPreview;
                result.jpegData = std::move(jpegData);
                result.errorInfo = RawExtractor::ErrorInfo();
                result.error = "";
            }
        }
    }
    
    // Create result object (same structure as ExtractPreview)
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, result.success));
    
    if (!result.success) {
        resultObj.Set("error", Napi::String::New(env, result.error));
        
        if (result.errorInfo.code != RawExtractor::ErrorCode::SUCCESS) {
            Napi::Object errorInfoObj = Napi::Object::New(env);
            errorInfoObj.Set("code", Napi::Number::New(env, static_cast<int>(result.errorInfo.code)));
            errorInfoObj.Set("message", Napi::String::New(env, result.errorInfo.message));
            if (!result.errorInfo.context.empty()) {
                errorInfoObj.Set("context", Napi::String::New(env, result.errorInfo.context));
            }
            resultObj.Set("errorInfo", errorInfoObj);
        }
        
        return resultObj;
    }
    
    // Create preview object
    Napi::Object previewObj = Napi::Object::New(env);
    previewObj.Set("format", Napi::String::New(env, formatToString(result.format)));
    previewObj.Set("width", Napi::Number::New(env, result.preview.width));
    previewObj.Set("height", Napi::Number::New(env, result.preview.height));
    previewObj.Set("size", Napi::Number::New(env, result.preview.size));
    previewObj.Set("quality", Napi::String::New(env, qualityToString(result.preview.quality)));
    previewObj.Set("type", Napi::String::New(env, result.preview.type));
    previewObj.Set("orientation", Napi::Number::New(env, result.preview.orientation));
    
    // Create buffer for JPEG data
    Napi::Buffer<uint8_t> jpegBuffer = Napi::Buffer<uint8_t>::Copy(env, result.jpegData.data(), result.jpegData.size());
    previewObj.Set("data", jpegBuffer);
    
    resultObj.Set("preview", previewObj);
    
    return resultObj;
}

// Extract all available previews function exposed to JavaScript
Napi::Value ExtractAllPreviews(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Validate arguments
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsString()) {
        Napi::TypeError::New(env, "First argument must be a string (filePath)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>();
    
    // Create extractor and get all previews
    RawExtractor::RawExtractor extractor;
    
    // First detect format
    RawExtractor::Utils::MemoryMappedFile mmf;
    if (!mmf.open(filePath)) {
        Napi::Object resultObj = Napi::Object::New(env);
        resultObj.Set("success", Napi::Boolean::New(env, false));
        resultObj.Set("error", Napi::String::New(env, "Failed to open file"));
        return resultObj;
    }
    
    RawExtractor::RawFormat format = extractor.detectFormat(mmf.data(), mmf.size());
    std::vector<RawExtractor::Formats::PreviewInfo> previews = extractor.getAllPreviews(mmf.data(), mmf.size(), format);
    
    // Create result object
    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("success", Napi::Boolean::New(env, true));
    resultObj.Set("format", Napi::String::New(env, formatToString(format)));
    
    // Create previews array
    Napi::Array previewsArray = Napi::Array::New(env, previews.size());
    
    for (size_t i = 0; i < previews.size(); i++) {
        const auto& preview = previews[i];
        
        // Extract JPEG data for this preview
        std::vector<uint8_t> jpegData(mmf.data() + preview.offset, mmf.data() + preview.offset + preview.size);
        
        // Create preview object
        Napi::Object previewObj = Napi::Object::New(env);
        previewObj.Set("format", Napi::String::New(env, formatToString(format)));
        previewObj.Set("width", Napi::Number::New(env, preview.width));
        previewObj.Set("height", Napi::Number::New(env, preview.height));
        previewObj.Set("size", Napi::Number::New(env, preview.size));
        previewObj.Set("quality", Napi::String::New(env, qualityToString(preview.quality)));
        previewObj.Set("type", Napi::String::New(env, preview.type));
        previewObj.Set("priority", Napi::Number::New(env, preview.priority));
        previewObj.Set("orientation", Napi::Number::New(env, preview.orientation));
        
        // Set type based on quality and size for CR3
        std::string previewType = "UNKNOWN";
        if (format == RawExtractor::RawFormat::CR3) {
            if (preview.quality == RawExtractor::Utils::QUALITY_THUMBNAIL) {
                previewType = "THMB";
            } else if (preview.quality == RawExtractor::Utils::QUALITY_PREVIEW) {
                previewType = "PRVW";
            } else if (preview.quality == RawExtractor::Utils::QUALITY_FULL) {
                previewType = "MDAT";
            }
        }
        previewObj.Set("type", Napi::String::New(env, previewType));
        
        // Create buffer for JPEG data
        Napi::Buffer<uint8_t> jpegBuffer = Napi::Buffer<uint8_t>::Copy(env, jpegData.data(), jpegData.size());
        previewObj.Set("data", jpegBuffer);
        
        previewsArray[i] = previewObj;
    }
    
    resultObj.Set("previews", previewsArray);
    
    return resultObj;
}

// Initialize the module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("extractPreview", Napi::Function::New(env, ExtractPreview));
    exports.Set("extractPreviewFromBuffer", Napi::Function::New(env, ExtractPreviewFromBuffer));
    exports.Set("extractMediumPreview", Napi::Function::New(env, ExtractMediumPreview));
    exports.Set("extractFullPreview", Napi::Function::New(env, ExtractFullPreview));
    exports.Set("extractAllPreviews", Napi::Function::New(env, ExtractAllPreviews));
    exports.Set("detectFormat", Napi::Function::New(env, DetectFormat));
    
    return exports;
}

NODE_API_MODULE(raw_extractor, Init)