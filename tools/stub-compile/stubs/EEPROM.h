// Stub <EEPROM.h> — host -fsyntax-only.
#pragma once
#include <Arduino.h>
class EEPROMClass {
public:
    void begin(size_t) {}
    uint8_t read(int) { return 0; }
    void write(int, uint8_t) {}
    bool commit() { return true; }
    template<typename T> T& get(int, T& t) { return t; }
    template<typename T> const T& put(int, const T& t) { return t; }
    uint8_t& operator[](int) { static uint8_t x = 0; return x; }
    uint16_t length() { return 512; }
};
extern EEPROMClass EEPROM;
