// ==============================================================
// internal/led_matrix.h
// UNO R4 LED matrix helpers — shows "Pardalote" at boot, then
// scrolls the IP address once WiFi is connected. No-op on other
// platforms so callers don't need to guard.
// ==============================================================

#pragma once

// Call once during PardaloteClass::begin() — starts the matrix and
// scrolls the boot text. No-op on non-UNO R4 platforms.
void ledMatrixBegin();

// Call from PardaloteClass::run() — refreshes the IP scroll each
// time the previous animation finishes. No-op on non-UNO R4.
void ledMatrixLoop();
