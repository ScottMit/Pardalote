// ==============================================================
// wifi_config.h
// WiFi credential manager with EEPROM persistence
// Supports up to WIFI_MAX_NETS networks; survives power cycles.
//
// Also supports optional compile-time credentials via secrets.h:
//   #define SECRET_SSID "YourWiFiName"
//   #define SECRET_PASS "YourWiFiPassword"
// If defined, the secrets.h network is tried first on every boot
// before falling back to EEPROM-stored networks.
// ==============================================================

#pragma once
#include <EEPROM.h>

// Pull in compile-time credentials if secrets.h exists and
// has SECRET_SSID defined. No error if the file is absent.
#if __has_include("secrets.h")
  #include "secrets.h"
#endif

// -------------------------------------------------------------------
// Storage layout
//   Offset  Bytes  Content
//   0       4      Magic number
//   4+n*98  98     Network n: valid(1) + ssid(33) + pass(64)
//   Total for 5 networks: 494 bytes
// -------------------------------------------------------------------
#define WIFI_MAGIC       0xAB12CD34UL
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

// -------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------
static void _wifiSave(const WifiStore& s) {
    EEPROM.put(0, s);
#ifdef PLATFORM_ESP32
    EEPROM.commit();
#endif
}

static int _wifiCount(const WifiStore& s) {
    int n = 0;
    for (int i = 0; i < WIFI_MAX_NETS; i++) if (s.nets[i].valid) n++;
    return n;
}

static void _wifiShow(const WifiStore& s) {
    bool any = false;
    for (int i = 0; i < WIFI_MAX_NETS; i++) {
        if (!s.nets[i].valid) continue;
        if (!any) { Serial.println(F("Stored networks:")); any = true; }
        Serial.print(F("  "));
        Serial.print(i + 1);
        Serial.print(F(". "));
        Serial.println(s.nets[i].ssid);
    }
    if (!any) Serial.println(F("No networks stored."));
}

// Read a line from Serial with echo. Password mode echoes '*'.
// Supports backspace. Returns false on timeout.
static bool _wifiReadLine(char* buf, int maxLen,
                          bool masked = false,
                          unsigned long timeoutMs = 30000) {
    int pos = 0;
    buf[0] = '\0';
    unsigned long deadline = millis() + timeoutMs;
    while (millis() < deadline) {
        if (!Serial.available()) continue;
        char c = Serial.read();
        if (c == '\r') continue;
        if (c == '\n') {
            if (pos > 0) { buf[pos] = '\0'; Serial.println(); return true; }
            continue;
        }
        if (c == '\b' || c == 127) {
            if (pos > 0) { pos--; Serial.print(F("\b \b")); }
            continue;
        }
        if (pos < maxLen - 1) {
            buf[pos++] = c;
            Serial.print(masked ? '*' : c);
        }
    }
    Serial.println(F("\nTimeout."));
    return false;
}

static char _wifiReadChar() {
    char c;
    do {
        while (!Serial.available());
        c = Serial.read();
    } while (c == '\r' || c == '\n' || c == ' ');
    Serial.println(c);
    return c;
}

// -------------------------------------------------------------------
// Configuration menu — returns on exit.
// -------------------------------------------------------------------
static void _wifiEnterConfig(WifiStore& s) {
    Serial.println(F("\n=== WiFi Configuration ==="));

    for (;;) {
        Serial.println(F("\n[a]dd  [d]elete  [c]lear all  [s]how  [x] exit"));
        Serial.print(F("> "));
        char cmd = _wifiReadChar();

        // ── Add ──
        if (cmd == 'a') {
            int slot = -1;
            if (_wifiCount(s) >= WIFI_MAX_NETS) {
                Serial.println(F("All 5 slots full."));
                _wifiShow(s);
                Serial.print(F("Replace which? (1-5, 0 = cancel): "));
                int n = _wifiReadChar() - '0';
                if (n < 1 || n > WIFI_MAX_NETS) { Serial.println(F("Cancelled.")); continue; }
                slot = n - 1;
            } else {
                for (int i = 0; i < WIFI_MAX_NETS; i++) {
                    if (!s.nets[i].valid) { slot = i; break; }
                }
            }
            char ssid[SSID_LEN], pass[PASS_LEN];
            Serial.print(F("SSID: "));
            if (!_wifiReadLine(ssid, sizeof(ssid)))         continue;
            Serial.print(F("Password: "));
            if (!_wifiReadLine(pass, sizeof(pass), true))   continue;
            s.nets[slot].valid = true;
            strncpy(s.nets[slot].ssid, ssid, SSID_LEN - 1);
            s.nets[slot].ssid[SSID_LEN - 1] = '\0';
            strncpy(s.nets[slot].pass, pass, PASS_LEN - 1);
            s.nets[slot].pass[PASS_LEN - 1] = '\0';
            _wifiSave(s);
            Serial.print(F("Saved: "));
            Serial.println(ssid);

        // ── Delete one ──
        } else if (cmd == 'd') {
            if (_wifiCount(s) == 0) { Serial.println(F("No networks stored.")); continue; }
            _wifiShow(s);
            Serial.print(F("Delete which? (0 = cancel): "));
            int n = _wifiReadChar() - '0';
            if (n < 1 || n > WIFI_MAX_NETS || !s.nets[n - 1].valid) {
                Serial.println(F("Cancelled.")); continue;
            }
            Serial.print(F("Delete '"));
            Serial.print(s.nets[n - 1].ssid);
            Serial.print(F("'? (y/n): "));
            if (_wifiReadChar() == 'y') {
                s.nets[n - 1].valid = false;
                _wifiSave(s);
                Serial.println(F("Deleted."));
            } else {
                Serial.println(F("Cancelled."));
            }

        // ── Clear all ──
        } else if (cmd == 'c') {
            Serial.print(F("Clear all networks? (y/n): "));
            if (_wifiReadChar() == 'y') {
                for (int i = 0; i < WIFI_MAX_NETS; i++) s.nets[i].valid = false;
                _wifiSave(s);
                Serial.println(F("Cleared."));
            } else {
                Serial.println(F("Cancelled."));
            }

        // ── Show ──
        } else if (cmd == 's') {
            _wifiShow(s);

        // ── Exit ──
        } else if (cmd == 'x') {
            return;
        }
    }
}

// -------------------------------------------------------------------
// wifiConfigInit — call at the top of setup(), before WiFi.begin().
//
// Loads stored networks from EEPROM. If none are stored, enters
// config mode immediately. Otherwise shows a 5-second window:
// press 'w' to configure, or wait to proceed to connection.
// -------------------------------------------------------------------
void wifiConfigInit(WifiStore& s) {
#ifdef PLATFORM_ESP32
    EEPROM.begin(sizeof(WifiStore));
#endif
    EEPROM.get(0, s);
    if (s.magic != WIFI_MAGIC) {
        s.magic = WIFI_MAGIC;
        for (int i = 0; i < WIFI_MAX_NETS; i++) s.nets[i].valid = false;
        _wifiSave(s);
    }

    // On UNO R4, native USB Serial needs the host to open the port.
    // Wait briefly so startup messages aren't lost.
    unsigned long t = millis();
    while (!Serial && millis() - t < 2000);

    Serial.println(F("\n=== Pardalote ==="));

#ifdef SECRET_SSID
    Serial.print(F("Network (secrets.h): "));
    Serial.println(F(SECRET_SSID));
#endif

    // Loop until at least one network is available.
    // If SECRET_SSID is defined we always have at least one option,
    // so skip the forced config loop even when EEPROM is empty.
    bool cameFromConfig = false;
#ifdef SECRET_SSID
    if (_wifiCount(s) == 0) {
        Serial.println(F("No EEPROM networks stored."));
    }
#else
    while (_wifiCount(s) == 0) {
        Serial.println(F("No WiFi networks stored."));
        _wifiEnterConfig(s);
        cameFromConfig = true;
    }
#endif

    _wifiShow(s);

    // Skip the config window if we just came from it.
    if (!cameFromConfig) {
        Serial.println(F("Press 'w' within 5 seconds to configure WiFi..."));
        t = millis();
        while (millis() - t < 5000) {
            if (Serial.available() && Serial.read() == 'w') {
                _wifiEnterConfig(s);
                break;
            }
            delay(50);
        }
    }
}

// -------------------------------------------------------------------
// wifiConfigConnect — tries each stored network in order.
//
// Returns once connected. If all networks fail, drops into config
// so the user can add or fix credentials, then retries.
// -------------------------------------------------------------------
void wifiConfigConnect(WifiStore& s) {
#ifdef PLATFORM_UNO_R4
    if (WiFi.status() == WL_NO_MODULE) {
        Serial.println(F("WiFi module not found"));
        while (true) delay(1000);
    }
#endif

    for (;;) {

#ifdef SECRET_SSID
        // Try compile-time credentials first
        {
            Serial.print(F("Trying (secrets.h): "));
            Serial.println(F(SECRET_SSID));
#ifdef SECRET_PASS
            WiFi.begin(SECRET_SSID, SECRET_PASS);
#else
            WiFi.begin(SECRET_SSID);
#endif
            unsigned long t = millis() + 10000;
            while (WiFi.status() != WL_CONNECTED && millis() < t) delay(500);
            if (WiFi.status() == WL_CONNECTED) return;
            Serial.println(F("Failed."));
            WiFi.disconnect();
            delay(200);
        }
#endif

        // Try EEPROM-stored networks in order
        bool anyStored = false;
        for (int i = 0; i < WIFI_MAX_NETS; i++) {
            if (!s.nets[i].valid) continue;
            anyStored = true;
            Serial.print(F("Trying: "));
            Serial.println(s.nets[i].ssid);
            WiFi.begin(s.nets[i].ssid, s.nets[i].pass);
            unsigned long t = millis() + 10000;
            while (WiFi.status() != WL_CONNECTED && millis() < t) delay(500);
            if (WiFi.status() == WL_CONNECTED) return;
            Serial.println(F("Failed."));
            WiFi.disconnect();
            delay(200);
        }

        Serial.println(F("Could not connect to any network."));
        _wifiEnterConfig(s);
    }
}
