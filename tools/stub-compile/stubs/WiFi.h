// Stub <WiFi.h> — ESP32. host -fsyntax-only.
#pragma once
#include <Arduino.h>
#include <IPAddress.h>
#define WIFI_STA 1
#define WIFI_AP  2
typedef enum { WL_NO_SHIELD = 255, WL_NO_MODULE = 255, WL_IDLE_STATUS = 0,
               WL_NO_SSID_AVAIL, WL_SCAN_COMPLETED, WL_CONNECTED,
               WL_CONNECT_FAILED, WL_CONNECTION_LOST, WL_DISCONNECTED } wl_status_t;
// Values in 0.25 dBm units, as in the ESP32 core.
typedef enum { WIFI_POWER_21dBm = 84, WIFI_POWER_20_5dBm = 82, WIFI_POWER_20dBm = 80,
               WIFI_POWER_19_5dBm = 78, WIFI_POWER_19dBm = 76, WIFI_POWER_18_5dBm = 74,
               WIFI_POWER_17dBm = 68, WIFI_POWER_15dBm = 60, WIFI_POWER_13dBm = 52,
               WIFI_POWER_11dBm = 44, WIFI_POWER_8_5dBm = 34, WIFI_POWER_7dBm = 28,
               WIFI_POWER_5dBm = 20, WIFI_POWER_2dBm = 8, WIFI_POWER_MINUS_1dBm = -4 } wifi_power_t;
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
    bool setTxPower(wifi_power_t) { return true; }
    const char* SSID() { return ""; }
};
extern WiFiClass WiFi;
