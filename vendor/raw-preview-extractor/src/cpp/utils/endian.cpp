#include "endian.h"
#include <cstring>

namespace RawExtractor {
namespace Utils {

uint16_t EndianUtils::readUInt16(const uint8_t* buffer, bool littleEndian) {
    uint16_t value;
    if (littleEndian) {
        value = static_cast<uint16_t>(buffer[0]) | 
                (static_cast<uint16_t>(buffer[1]) << 8);
    } else {
        value = (static_cast<uint16_t>(buffer[0]) << 8) | 
                static_cast<uint16_t>(buffer[1]);
    }
    return value;
}

uint32_t EndianUtils::readUInt32(const uint8_t* buffer, bool littleEndian) {
    uint32_t value;
    if (littleEndian) {
        value = static_cast<uint32_t>(buffer[0]) |
                (static_cast<uint32_t>(buffer[1]) << 8) |
                (static_cast<uint32_t>(buffer[2]) << 16) |
                (static_cast<uint32_t>(buffer[3]) << 24);
    } else {
        value = (static_cast<uint32_t>(buffer[0]) << 24) |
                (static_cast<uint32_t>(buffer[1]) << 16) |
                (static_cast<uint32_t>(buffer[2]) << 8) |
                static_cast<uint32_t>(buffer[3]);
    }
    return value;
}

void EndianUtils::writeUInt16(uint8_t* buffer, uint16_t value, bool littleEndian) {
    if (littleEndian) {
        buffer[0] = static_cast<uint8_t>(value & 0xFF);
        buffer[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
    } else {
        buffer[0] = static_cast<uint8_t>((value >> 8) & 0xFF);
        buffer[1] = static_cast<uint8_t>(value & 0xFF);
    }
}

void EndianUtils::writeUInt32(uint8_t* buffer, uint32_t value, bool littleEndian) {
    if (littleEndian) {
        buffer[0] = static_cast<uint8_t>(value & 0xFF);
        buffer[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
        buffer[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
        buffer[3] = static_cast<uint8_t>((value >> 24) & 0xFF);
    } else {
        buffer[0] = static_cast<uint8_t>((value >> 24) & 0xFF);
        buffer[1] = static_cast<uint8_t>((value >> 16) & 0xFF);
        buffer[2] = static_cast<uint8_t>((value >> 8) & 0xFF);
        buffer[3] = static_cast<uint8_t>(value & 0xFF);
    }
}

bool EndianUtils::detectEndianness(const uint8_t* buffer) {
    if (buffer[0] == 0x49 && buffer[1] == 0x49) {
        return true; // Little endian ("II")
    } else if (buffer[0] == 0x4D && buffer[1] == 0x4D) {
        return false; // Big endian ("MM")
    }
    return true; // Default to little endian
}

} // namespace Utils
} // namespace RawExtractor