// Stub <Wire.h> — host -fsyntax-only.
#pragma once
#include <Arduino.h>
class TwoWire : public Stream {
public:
    void begin() {}
    void begin(int, int) {}
    void setTimeOut(uint16_t) {}
    void setClock(uint32_t) {}
    void beginTransmission(uint8_t) {}
    uint8_t endTransmission(void) { return 0; }
    uint8_t endTransmission(uint8_t) { return 0; }
    uint8_t requestFrom(uint8_t, uint8_t) { return 0; }
    size_t write(uint8_t) { return 0; }
    using Print::write;
};
extern TwoWire Wire;
