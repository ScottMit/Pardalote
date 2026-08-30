// Stub <WiFi.h> — ESP32. host -fsyntax-only.
#pragma once
#include <Arduino.h>
#include <IPAddress.h>
#define WIFI_STA 1
#define WIFI_AP  2
typedef enum { WL_NO_SHIELD = 255, WL_NO_MODULE = 255, WL_IDLE_STATUS = 0,
               WL_NO_SSID_AVAIL, WL_SCAN_COMPLETED, WL_CONNECTED,
               WL_CONNECT_FAILED, WL_CONNECTION_LOST, WL_DISCONNECTED } wl_status_t;
class WiFiClass {
public:
    int begin(const char*, const char*) { return 0; }
    int begin(const char*) { return 0; }
    int begin() { return 0; }
    void mode(int) {}
    void disconnect(bool = false) {}
    wl_status_t status() { return WL_CONNECTED; }
    IPAddress localIP() { return IPAddress(); }
    IPAddress softAPIP() { return IPAddress(); }
    bool softAP(const char*, const char* = nullptr) { return true; }
    String macAddress() { return String(); }
    int RSSI() { return 0; }
    void setSleep(bool) {}
    const char* SSID() { return ""; }
};
extern WiFiClass WiFi;
