#include "memory_map.h"
#include <stdexcept>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#endif

namespace RawExtractor {
namespace Utils {

MemoryMappedFile::MemoryMappedFile() : 
    data_(nullptr), 
    size_(0), 
    mapped_(false)
#ifdef _WIN32
    , fileHandle_(INVALID_HANDLE_VALUE), mapHandle_(INVALID_HANDLE_VALUE)
#else
    , fd_(-1)
#endif
{
}

MemoryMappedFile::~MemoryMappedFile() {
    close();
}

bool MemoryMappedFile::open(const std::string& filename) {
    if (mapped_) {
        close();
    }

#ifdef _WIN32
    fileHandle_ = CreateFileA(
        filename.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr
    );

    if (fileHandle_ == INVALID_HANDLE_VALUE) {
        return false;
    }

    LARGE_INTEGER fileSize;
    if (!GetFileSizeEx(fileHandle_, &fileSize)) {
        CloseHandle(fileHandle_);
        fileHandle_ = INVALID_HANDLE_VALUE;
        return false;
    }

    size_ = static_cast<size_t>(fileSize.QuadPart);

    mapHandle_ = CreateFileMappingA(
        fileHandle_,
        nullptr,
        PAGE_READONLY,
        0,
        0,
        nullptr
    );

    if (mapHandle_ == nullptr) {
        CloseHandle(fileHandle_);
        fileHandle_ = INVALID_HANDLE_VALUE;
        return false;
    }

    data_ = static_cast<uint8_t*>(MapViewOfFile(
        mapHandle_,
        FILE_MAP_READ,
        0,
        0,
        0
    ));

    if (data_ == nullptr) {
        CloseHandle(mapHandle_);
        CloseHandle(fileHandle_);
        mapHandle_ = INVALID_HANDLE_VALUE;
        fileHandle_ = INVALID_HANDLE_VALUE;
        return false;
    }

#else
    fd_ = ::open(filename.c_str(), O_RDONLY);
    if (fd_ == -1) {
        return false;
    }

    struct stat st;
    if (fstat(fd_, &st) == -1) {
        ::close(fd_);
        fd_ = -1;
        return false;
    }

    size_ = static_cast<size_t>(st.st_size);

    data_ = static_cast<uint8_t*>(mmap(
        nullptr,
        size_,
        PROT_READ,
        MAP_PRIVATE,
        fd_,
        0
    ));

    if (data_ == MAP_FAILED) {
        ::close(fd_);
        fd_ = -1;
        data_ = nullptr;
        return false;
    }
#endif

    mapped_ = true;
    return true;
}

void MemoryMappedFile::close() {
    if (!mapped_) {
        return;
    }

#ifdef _WIN32
    if (data_) {
        UnmapViewOfFile(data_);
        data_ = nullptr;
    }
    if (mapHandle_ != INVALID_HANDLE_VALUE) {
        CloseHandle(mapHandle_);
        mapHandle_ = INVALID_HANDLE_VALUE;
    }
    if (fileHandle_ != INVALID_HANDLE_VALUE) {
        CloseHandle(fileHandle_);
        fileHandle_ = INVALID_HANDLE_VALUE;
    }
#else
    if (data_ && data_ != MAP_FAILED) {
        munmap(data_, size_);
        data_ = nullptr;
    }
    if (fd_ != -1) {
        ::close(fd_);
        fd_ = -1;
    }
#endif

    size_ = 0;
    mapped_ = false;
}

const uint8_t* MemoryMappedFile::data() const {
    return data_;
}

size_t MemoryMappedFile::size() const {
    return size_;
}

bool MemoryMappedFile::isOpen() const {
    return mapped_;
}

const uint8_t* MemoryMappedFile::dataAt(size_t offset) const {
    if (!mapped_ || offset >= size_) {
        return nullptr;
    }
    return data_ + offset;
}

bool MemoryMappedFile::readAt(size_t offset, void* buffer, size_t length) const {
    if (!mapped_ || offset + length > size_) {
        return false;
    }
    
    std::memcpy(buffer, data_ + offset, length);
    return true;
}

} // namespace Utils
} // namespace RawExtractor