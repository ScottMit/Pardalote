// Stub <IPAddress.h> — shared so WiFi.h and WebSocketsServer.h agree on one type.
#pragma once
#include <Arduino.h>
class IPAddress {
public:
    IPAddress() {}
    IPAddress(uint8_t, uint8_t, uint8_t, uint8_t) {}
    IPAddress(uint32_t) {}
    uint8_t operator[](int) const { return 0; }
    String toString() const { return String(); }
    operator uint32_t() const { return 0; }
    bool operator==(const IPAddress&) const { return false; }
};
