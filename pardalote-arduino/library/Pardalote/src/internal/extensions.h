// ==============================================================
// internal/extensions.h
// Pardalote Extension Registry — declarations only.
//
// Storage and function bodies live in extensions.cpp so the
// registry is shared across translation units. The user's .ino
// TU (which #includes extension headers) and the library's
// Pardalote.cpp TU (which calls dispatchExtension) both see the
// same _extRegistry.
//
// Extensions self-register by placing INSTALL_EXTENSION(...) at
// the bottom of their header.
// ==============================================================

#ifndef PARDALOTE_INTERNAL_EXTENSIONS_H
#define PARDALOTE_INTERNAL_EXTENSIONS_H

#include <Arduino.h>
#include "protocol.h"

#define MAX_EXTENSIONS 8

// -------------------------------------------------------------------
// Extension handler signature.
// clientNum  — WebSocket client to reply to
// cmd        — the CMD byte from the received frame
// typeMask   — which params are float32
// params     — raw param bytes (use paramInt / paramFloat to read)
// nparams    — number of params
// payload    — optional blob (strings, bitmaps); may be nullptr
// payloadLen — byte length of payload
// -------------------------------------------------------------------
typedef void (*ExtHandler)(uint8_t clientNum,
                           uint8_t cmd, uint16_t typeMask,
                           uint8_t* params, uint8_t nparams,
                           uint8_t* payload, uint16_t payloadLen);

// Called on each new client connection so the extension can announce
// itself and re-send any persistent state.
typedef void (*ExtAnnouncer)(uint8_t clientNum);

// Called when a WebSocket client disconnects.
typedef void (*ExtDisconnecter)(uint8_t clientNum);

// Called every Arduino loop() iteration for time-based housekeeping.
typedef void (*ExtLooper)();

struct ExtEntry {
    uint16_t        deviceId;
    ExtHandler      handle;
    ExtAnnouncer    announce;
    ExtDisconnecter disconnect;  // nullptr if not needed
    ExtLooper       loop;        // nullptr if not needed
};

// -------------------------------------------------------------------
// Registry API — implementations in extensions.cpp.
// -------------------------------------------------------------------
void registerExtension(uint16_t        deviceId,
                       ExtHandler      handle,
                       ExtAnnouncer    announce,
                       ExtDisconnecter disconnect = nullptr,
                       ExtLooper       loop       = nullptr);

void dispatchExtension(uint8_t clientNum, uint16_t deviceId,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen);

void announceAll(uint8_t clientNum);
void disconnectAll(uint8_t clientNum);
void loopAll();

// Call before Wire.begin() in any extension. Idempotent.
void ensureWire();

// Initialise Wire with custom SDA/SCL pins (ESP32 only). Returns true if
// it actually called Wire.begin(sda, scl), false if Wire was already
// initialised by an earlier ensureWire() / ensureWire(sda, scl) call —
// in which case the existing pins are kept and the caller should fall
// back to whatever the existing pins are.
bool ensureWire(int sda, int scl);

// -------------------------------------------------------------------
// INSTALL_EXTENSION(deviceId, handlerFn, announcerFn,
//                   [disconnectFn], [loopFn])
//
// Place at the bottom of an extension header.
// The static bool triggers registerExtension() during static
// initialisation — before setup() runs.
// -------------------------------------------------------------------
#define INSTALL_EXTENSION(deviceId, handlerFn, announcerFn, ...)        \
    static bool _ext_reg_##deviceId =                                   \
        (registerExtension(deviceId, handlerFn, announcerFn,            \
                           ##__VA_ARGS__), true);

#endif
