// ==============================================================
// UltrasonicExtension.h
// Pardalote Ultrasonic Sensor Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Supports 3-wire (trig+echo on one pin) and 4-wire (HC-SR04 style)
// sensors. Include this file in Pardalote.ino to add support.
//
// Distance is measured on demand — CMD_ULTRASONIC_READ triggers a
// blocking pulseIn() on the Arduino and sends the result back.
// Periodic polling is driven by a JS-side timer.
//
// NOTE: pulseIn() blocks the loop for up to timeoutMs milliseconds.
// Keep the JS poll interval at least 3-4× longer than the timeout,
// e.g. setTimeout(30) with read(150) or setTimeout(40) with read(200).
// Longer timeouts reduce the maximum WebSocket responsiveness.
//
// Response value is distance in tenths of the requested unit
// (e.g. 235 = 23.5 cm, or 23.5 inches). -1 = timeout / no echo.
// ==============================================================

#ifndef ULTRASONIC_EXTENSION_H
#define ULTRASONIC_EXTENSION_H

#include "defs.h"
#include "protocol.h"
#include "extensions.h"

#define MAX_ULTRASONIC 4

class UltrasonicExt {
private:
    static int16_t  _trigPins[MAX_ULTRASONIC];
    static int16_t  _echoPins[MAX_ULTRASONIC];   // -1 = 3-wire
    static uint16_t _timeoutMs[MAX_ULTRASONIC];
    static bool     _attached[MAX_ULTRASONIC];

    static bool validId(int id) { return id >= 0 && id < MAX_ULTRASONIC; }

    // Returns distance in tenths of the requested unit, or -1 on timeout.
    static int32_t measure(int id, uint8_t unit) {
        int trig = _trigPins[id];
        int echo = (_echoPins[id] == -1) ? trig : (int)_echoPins[id];
        unsigned long timeout_us = _timeoutMs[id] * 1000UL;

        // Trigger pulse
        pinMode(trig, OUTPUT);
        digitalWrite(trig, LOW);
        delayMicroseconds(2);
        digitalWrite(trig, HIGH);
        delayMicroseconds(10);
        digitalWrite(trig, LOW);

        // For 3-wire sensors, switch the shared pin to input for echo
        if (_echoPins[id] == -1) pinMode(trig, INPUT);
        else                     pinMode(echo, INPUT);

        unsigned long duration = pulseIn(echo, HIGH, timeout_us);
        if (duration == 0) return -1;

        // Speed of sound: 343 m/s = 0.0343 cm/µs. Round trip ÷ 2, × 10 for tenths:
        //   tenths_cm   = duration × 0.0343 / 2 × 10 = duration × 343  / 2000
        //   tenths_inch = duration × 0.01350 / 2 × 10 = duration × 135 / 2000
        if (unit == UNIT_INCH)
            return (int32_t)(duration * 135L / 2000L);
        else
            return (int32_t)(duration * 343L / 2000L);
    }

public:
    // -------------------------------------------------------------------
    // Main dispatch
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {
        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("Ultrasonic: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            case CMD_ULTRASONIC_ATTACH: {
                if (nparams < 2) return;
                int trig = (int)paramInt(params, 1);
                int echo = (nparams > 2) ? (int)paramInt(params, 2) : -1;

                _trigPins[id]  = (int16_t)trig;
                _echoPins[id]  = (int16_t)echo;
                _timeoutMs[id] = 30;
                _attached[id]  = true;

                Serial.print(F("Ultrasonic ")); Serial.print(id);
                Serial.print(F(" attached: trig=")); Serial.print(trig);
                if (echo != -1) { Serial.print(F(" echo=")); Serial.println(echo); }
                else              Serial.println(F(" (3-wire)"));
                break;
            }

            case CMD_ULTRASONIC_DETACH:
                _attached[id] = false;
                _trigPins[id] = -1;
                _echoPins[id] = -1;
                Serial.print(F("Ultrasonic ")); Serial.print(id);
                Serial.println(F(" detached"));
                break;

            case CMD_ULTRASONIC_READ: {
                if (!_attached[id]) return;
                uint8_t unit = (nparams > 1) ? (uint8_t)paramInt(params, 1) : UNIT_CM;
                int32_t dist = measure(id, unit);

                FrameBuilder fb;
                fb.begin(CMD_ULTRASONIC_READ, DEVICE_ULTRASONIC);
                fb.addInt(id);
                fb.addInt(dist);
                broadcastFrame(fb);
                break;
            }

            case CMD_ULTRASONIC_SET_TIMEOUT: {
                if (!_attached[id] || nparams < 2) return;
                uint16_t t = (uint16_t)constrain((int)paramInt(params, 1), 1, 1000);
                _timeoutMs[id] = t;
                Serial.print(F("Ultrasonic ")); Serial.print(id);
                Serial.print(F(" timeout=")); Serial.println(t);
                break;
            }

            default:
                Serial.print(F("Ultrasonic: unknown cmd 0x"));
                Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Called on each new client connection
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_ULTRASONIC);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_ULTRASONIC);
        sendFrame(clientNum, fb);

        // Send full attach state for any currently attached sensors:
        // pins, and echo timeout.
        for (int i = 0; i < MAX_ULTRASONIC; i++) {
            if (!_attached[i]) continue;

            FrameBuilder fa;
            fa.begin(CMD_ULTRASONIC_ATTACH, DEVICE_ULTRASONIC);
            fa.addInt(i);
            fa.addInt(_trigPins[i]);
            if (_echoPins[i] != -1) fa.addInt(_echoPins[i]);
            sendFrame(clientNum, fa);

            FrameBuilder ft;
            ft.begin(CMD_ULTRASONIC_SET_TIMEOUT, DEVICE_ULTRASONIC);
            ft.addInt(i);
            ft.addInt(_timeoutMs[i]);
            sendFrame(clientNum, ft);
        }
    }
};

// Static member definitions
int16_t  UltrasonicExt::_trigPins[MAX_ULTRASONIC]  = { -1,-1,-1,-1 };
int16_t  UltrasonicExt::_echoPins[MAX_ULTRASONIC]  = { -1,-1,-1,-1 };
uint16_t UltrasonicExt::_timeoutMs[MAX_ULTRASONIC] = { 30,30,30,30 };
bool     UltrasonicExt::_attached[MAX_ULTRASONIC]  = {};

INSTALL_EXTENSION(DEVICE_ULTRASONIC, UltrasonicExt::handle, UltrasonicExt::announce)

#endif
