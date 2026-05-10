// ==============================================================
// ServoExtension.h
// Pardalote Servo Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Include this file in Pardalote.ino to add servo support.
// No other changes to the sketch are required.
//
// Supports up to MAX_SERVOS simultaneously attached servos.
// Each servo is addressed by a logical instance ID assigned by
// the JS side when calling arduino.add('name', new Servo(arduino)).
// ==============================================================

#ifndef SERVO_EXTENSION_H
#define SERVO_EXTENSION_H

#if defined(ESP32)
  #include <ESP32Servo.h>
#else
  #include <Servo.h>
#endif

#include "defs.h"
#include "protocol.h"
#include "extensions.h"

#define MAX_SERVOS 8

class ServoExt {
private:
    static Servo   _servos[MAX_SERVOS];
    static int16_t _pins[MAX_SERVOS];
    static int16_t _angles[MAX_SERVOS];
    static int16_t _minPulse[MAX_SERVOS];
    static int16_t _maxPulse[MAX_SERVOS];
    static bool    _attached[MAX_SERVOS];

    static bool validId(int id) { return id >= 0 && id < MAX_SERVOS; }

public:
    // -------------------------------------------------------------------
    // Main dispatch — called by the extension registry for every frame
    // whose TARGET == DEVICE_SERVO.
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {
        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("Servo: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            case CMD_SERVO_ATTACH: {
                if (nparams < 2) return;
                int pin  = (int)paramInt(params, 1);
                int minP = (nparams > 2) ? (int)paramInt(params, 2) : 544;
                int maxP = (nparams > 3) ? (int)paramInt(params, 3) : 2400;

                if (_attached[id]) _servos[id].detach();
                _servos[id].attach(pin, minP, maxP);
                _pins[id]     = (int16_t)pin;
                _minPulse[id] = (int16_t)minP;
                _maxPulse[id] = (int16_t)maxP;
                _attached[id] = true;
                _angles[id]   = 90;

                Serial.print(F("Servo ")); Serial.print(id);
                Serial.print(F(" attached to pin ")); Serial.println(pin);
                break;
            }

            case CMD_SERVO_DETACH:
                if (_attached[id]) {
                    _servos[id].detach();
                    _attached[id] = false;
                    _pins[id]     = -1;
                    Serial.print(F("Servo ")); Serial.print(id);
                    Serial.println(F(" detached"));
                }
                break;

            case CMD_SERVO_WRITE: {
                if (!_attached[id] || nparams < 2) return;
                int angle = constrain((int)paramInt(params, 1), 0, 180);
                _servos[id].write(angle);
                _angles[id] = (int16_t)angle;
                break;
            }

            case CMD_SERVO_WRITE_MICROSECONDS: {
                if (!_attached[id] || nparams < 2) return;
                int us = constrain((int)paramInt(params, 1), 544, 2400);
                _servos[id].writeMicroseconds(us);
                break;
            }

            case CMD_SERVO_READ: {
                int angle = _attached[id] ? _servos[id].read() : -1;
                if (_attached[id]) _angles[id] = (int16_t)angle;

                FrameBuilder fb;
                fb.begin(CMD_SERVO_READ, DEVICE_SERVO);
                fb.addInt(id);
                fb.addInt(angle);
                broadcastFrame(fb);
                break;
            }

            case CMD_SERVO_ATTACHED: {
                bool isAttached = _attached[id] && _servos[id].attached();

                FrameBuilder fb;
                fb.begin(CMD_SERVO_ATTACHED, DEVICE_SERVO);
                fb.addInt(id);
                fb.addInt(isAttached ? 1 : 0);
                broadcastFrame(fb);
                break;
            }

            default:
                Serial.print(F("Servo: unknown cmd 0x"));
                Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Called on every new client connection.
    // Sends an ANNOUNCE frame so JS knows this extension is present,
    // then re-sends current attach state so reconnected clients stay
    // in sync.
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_SERVO);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_SERVOS);
        sendFrame(clientNum, fb);

        // Send full attach state for any currently attached servos:
        // pin, pulse range, and last known angle.
        for (int i = 0; i < MAX_SERVOS; i++) {
            if (!_attached[i]) continue;

            FrameBuilder fa;
            fa.begin(CMD_SERVO_ATTACH, DEVICE_SERVO);
            fa.addInt(i);
            fa.addInt(_pins[i]);
            fa.addInt(_minPulse[i]);
            fa.addInt(_maxPulse[i]);
            sendFrame(clientNum, fa);

            FrameBuilder fw;
            fw.begin(CMD_SERVO_WRITE, DEVICE_SERVO);
            fw.addInt(i);
            fw.addInt(_angles[i]);
            sendFrame(clientNum, fw);
        }
    }
};

// Static member definitions
Servo   ServoExt::_servos[MAX_SERVOS];
int16_t ServoExt::_pins[MAX_SERVOS]     = { -1,-1,-1,-1,-1,-1,-1,-1 };
int16_t ServoExt::_angles[MAX_SERVOS]   = { 90,90,90,90,90,90,90,90 };
int16_t ServoExt::_minPulse[MAX_SERVOS] = { 544,544,544,544,544,544,544,544 };
int16_t ServoExt::_maxPulse[MAX_SERVOS] = { 2400,2400,2400,2400,2400,2400,2400,2400 };
bool    ServoExt::_attached[MAX_SERVOS] = {};

// Self-register — runs before setup(), no manual call needed.
INSTALL_EXTENSION(DEVICE_SERVO, ServoExt::handle, ServoExt::announce)

#endif
