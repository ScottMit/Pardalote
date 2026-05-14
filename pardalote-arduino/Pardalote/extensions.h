// ==============================================================
// extensions.h
// Pardalote Extension Registry
// Version v1.0
// ==============================================================
//
// Extensions self-register by placing INSTALL_EXTENSION() at the
// bottom of their header file. Core never needs to know which
// extensions are present.
//
// Adding an extension to a sketch:
//   #include "ServoExtension.h"   // that's it — no setup() changes
//
// ==============================================================

#ifndef EXTENSIONS_H
#define EXTENSIONS_H

#include <Arduino.h>
#include <Wire.h>
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

// Called on each new client connection so the extension can
// announce itself and re-send any persistent state.
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
// Registry — populated at static-init time via INSTALL_EXTENSION.
// -------------------------------------------------------------------
static ExtEntry _extRegistry[MAX_EXTENSIONS];
static uint8_t  _numExtensions  = 0;
static bool     _wireInitialised = false;

inline void registerExtension(uint16_t        deviceId,
                               ExtHandler      handle,
                               ExtAnnouncer    announce,
                               ExtDisconnecter disconnect = nullptr,
                               ExtLooper       loop       = nullptr) {
    if (_numExtensions < MAX_EXTENSIONS) {
        _extRegistry[_numExtensions++] = { deviceId, handle, announce, disconnect, loop };
    } else {
        // Can't use Serial here (may not be initialised yet)
    }
}

// -------------------------------------------------------------------
// Route an incoming extension frame to its handler.
// -------------------------------------------------------------------
inline void dispatchExtension(uint8_t clientNum, uint16_t deviceId,
                               uint8_t cmd, uint16_t typeMask,
                               uint8_t* params, uint8_t nparams,
                               uint8_t* payload, uint16_t payloadLen) {
    for (uint8_t i = 0; i < _numExtensions; i++) {
        if (_extRegistry[i].deviceId == deviceId) {
            _extRegistry[i].handle(clientNum, cmd, typeMask,
                                   params, nparams, payload, payloadLen);
            return;
        }
    }
    Serial.print(F("Unknown extension deviceId: "));
    Serial.println(deviceId);
}

// -------------------------------------------------------------------
// Send HELLO + all extension ANNOUNCE frames to a new client.
// -------------------------------------------------------------------
inline void announceAll(uint8_t clientNum) {
    for (uint8_t i = 0; i < _numExtensions; i++) {
        if (_extRegistry[i].announce) {
            _extRegistry[i].announce(clientNum);
        }
    }
}

// -------------------------------------------------------------------
// Notify all extensions that a client has disconnected.
// -------------------------------------------------------------------
inline void disconnectAll(uint8_t clientNum) {
    for (uint8_t i = 0; i < _numExtensions; i++) {
        if (_extRegistry[i].disconnect) {
            _extRegistry[i].disconnect(clientNum);
        }
    }
}

// -------------------------------------------------------------------
// Run per-loop housekeeping for all extensions.
// -------------------------------------------------------------------
inline void loopAll() {
    for (uint8_t i = 0; i < _numExtensions; i++) {
        if (_extRegistry[i].loop) {
            _extRegistry[i].loop();
        }
    }
}

// -------------------------------------------------------------------
// Call before using Wire.begin() in any extension.
// Prevents double-initialisation when multiple I2C extensions coexist.
// -------------------------------------------------------------------
inline void ensureWire() {
    if (!_wireInitialised) {
        Wire.begin();
        _wireInitialised = true;
    }
}

// -------------------------------------------------------------------
// INSTALL_EXTENSION(deviceId, handlerFn, announcerFn)
//
// Place at the bottom of an extension header file.
// The static bool triggers registerExtension() during static
// initialisation — before setup() runs — so no manual registration
// call is needed in the sketch.
//
// Example (at the bottom of ServoExtension.h):
//   INSTALL_EXTENSION(DEVICE_SERVO, ServoExt::handle, ServoExt::announce)
// -------------------------------------------------------------------
// Variadic so existing 3-argument extensions need no changes:
//   INSTALL_EXTENSION(DEVICE_SERVO, ServoExt::handle, ServoExt::announce)
// Camera passes all four:
//   INSTALL_EXTENSION(DEVICE_CAMERA, ..., CameraExt::disconnect, CameraExt::loop)
#define INSTALL_EXTENSION(deviceId, handlerFn, announcerFn, ...)        \
    static bool _ext_reg_##deviceId =                                   \
        (registerExtension(deviceId, handlerFn, announcerFn,            \
                           ##__VA_ARGS__), true);

#endif
