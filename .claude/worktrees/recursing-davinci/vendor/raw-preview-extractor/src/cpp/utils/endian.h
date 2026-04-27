#pragma once

#include <cstdint>

namespace RawExtractor {
namespace Utils {

class EndianUtils {
public:
    static uint16_t readUInt16(const uint8_t* buffer, bool littleEndian);
    static uint32_t readUInt32(const uint8_t* buffer, bool littleEndian);
    static void writeUInt16(uint8_t* buffer, uint16_t value, bool littleEndian);
    static void writeUInt32(uint8_t* buffer, uint32_t value, bool littleEndian);
    static bool detectEndianness(const uint8_t* buffer);
};

} // namespace Utils
} // namespace RawExtractor