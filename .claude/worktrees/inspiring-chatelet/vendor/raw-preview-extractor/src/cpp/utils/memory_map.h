#pragma once

#include <string>
#include <cstdint>
#include <cstddef>

#ifdef _WIN32
#include <windows.h>
#endif

namespace RawExtractor {
namespace Utils {

class MemoryMappedFile {
public:
    MemoryMappedFile();
    ~MemoryMappedFile();

    // Disable copy constructor and assignment
    MemoryMappedFile(const MemoryMappedFile&) = delete;
    MemoryMappedFile& operator=(const MemoryMappedFile&) = delete;

    bool open(const std::string& filename);
    void close();
    
    const uint8_t* data() const;
    size_t size() const;
    bool isOpen() const;
    
    // Convenience methods
    const uint8_t* dataAt(size_t offset) const;
    bool readAt(size_t offset, void* buffer, size_t length) const;

private:
    uint8_t* data_;
    size_t size_;
    bool mapped_;

#ifdef _WIN32
    HANDLE fileHandle_;
    HANDLE mapHandle_;
#else
    int fd_;
#endif
};

} // namespace Utils
} // namespace RawExtractor