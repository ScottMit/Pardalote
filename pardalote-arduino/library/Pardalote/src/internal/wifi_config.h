// ==============================================================
// internal/wifi_config.h
// WiFi credential manager — declarations.
//
// Two credential sources are supported:
//   1. Compile-time secrets.h in the sketch folder. Pardalote.h
//      detects this via __has_include and a static-init binder
//      populates _pardaloteSecrets from the user's TU.
//   2. EEPROM-stored networks, managed via the Serial config menu.
//
// Implementations live in wifi_config.cpp.
// ==============================================================

#pragma once

#include <Arduino.h>

#define WIFI_MAX_NETS    5
#define SSID_LEN         33   // 32 chars + null
#define PASS_LEN         64   // 63 chars + null

struct WifiEntry {
    bool valid;
    char ssid[SSID_LEN];
    char pass[PASS_LEN];
};

struct WifiStore {
    uint32_t  magic;
    WifiEntry nets[WIFI_MAX_NETS];
};

// Compile-time credentials are funnelled through this struct so they
// can be read by the library at runtime. Pardalote.h has a static-init
// binder that copies SECRET_SSID / SECRET_PASS into it from the user's
// translation unit, which is the only TU that can see secrets.h.
struct PardaloteSecrets {
    const char* ssid;
    const char* pass;
};
extern PardaloteSecrets _pardaloteSecrets;

// Call at the top of setup(), before WiFi.begin().
// Loads stored networks from EEPROM, optionally enters the Serial
// config menu (forced if no networks at all are available).
void wifiConfigInit(WifiStore& s);

// Tries each available network in order:
// secrets.h first (if bound), then EEPROM entries.
// Returns once connected. If all networks fail, drops into the
// Serial config menu so the user can fix credentials, then retries.
void wifiConfigConnect(WifiStore& s);
