// ==============================================================
// Pardalote — Camera diagnostic sketch (bench tool, ESP32 only)
// https://github.com/ScottMit/Pardalote
// Copyright (C) 2026 Scott Mitchell — GPL-3.0-or-later. See LICENSE.
//
// The camera example plus logging for chasing stream/connection
// problems. Serial Monitor shows:
//   [Camera] N fps, N KB/frame, N ms to send (WxH) — every 10 s while streaming
//                                        (built into the library)
//   [stall] Pardalote.run() took N ms  — loop() blocked > 200 ms.
//                                        ~200 ms on attach/disconnect is
//                                        normal (camera init / server stop)
//   [WiFi] disconnected, reason=N      — the board left the network
//                                        (2/4 = AP expired us, 200 = beacon
//                                        timeout, 8 = we left, 15 = handshake)
//
// Browser side: any camera example (camera-stream, camera-posenet).
// The stream paces itself to the network (adaptive). To add a hard cap,
// from the browser console:
//   arduino.cam.setFrameRate(15)   // 0 = no cap
//
// Keep the Serial Monitor open while testing — on native-USB boards
// (S3/C3) printing with nothing reading the port can itself stall loop().
// ==============================================================

// Pick ONE camera board model (same names as the camera-stream example):
#define CAMERA_MODEL_XIAO_ESP32S3
// #define CAMERA_MODEL_WROVER_KIT
// #define CAMERA_MODEL_AI_THINKER

#include <Pardalote.h>
#include <PardaloteCamera.h>

// XIAO ESP32-S3 / C3 boards now default to reduced TX power (8.5 dBm) —
// their antenna misbehaves at full power. To A/B test full power on a
// XIAO, uncomment the setTxPower line below.

void setup() {
    // Log why WiFi drops (before begin, so connect failures show too)
    WiFi.onEvent([](WiFiEvent_t e, WiFiEventInfo_t info) {
        Serial.printf("[WiFi] disconnected, reason=%d\n",
                      info.wifi_sta_disconnected.reason);
    }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);

    // Pardalote.setTxPower(WIFI_POWER_19_5dBm);   // full power (XIAO A/B test)
    Pardalote.begin();
}

void loop() {
    unsigned long s = millis();
    Pardalote.run();
    unsigned long d = millis() - s;
    if (d > 200) Serial.printf("[stall] Pardalote.run() took %lu ms\n", d);
}
