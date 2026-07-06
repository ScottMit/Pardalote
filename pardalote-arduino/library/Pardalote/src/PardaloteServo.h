// ==============================================================
// PardaloteServo.h
// Pardalote Servo Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Add #include <PardaloteServo.h> to your sketch — the extension
// self-registers, no further setup is required.
//
// Supports up to MAX_SERVOS simultaneously attached servos.
// Each servo is addressed by a logical instance ID assigned by
// the JS side when calling arduino.add('name', new Servo(arduino)).
// ==============================================================

#ifndef PARDALOTE_SERVO_H
#define PARDALOTE_SERVO_H

#if defined(ESP32)
  #include <ESP32Servo.h>
#else
  #include <Servo.h>
#endif

#include "Pardalote.h"

#define MAX_SERVOS 8

class ServoExt {
private:
    inline static Servo   _servos[MAX_SERVOS];
    inline static int16_t _pins[MAX_SERVOS]     = { -1,-1,-1,-1,-1,-1,-1,-1 };
    inline static int16_t _angles[MAX_SERVOS]   = { 90,90,90,90,90,90,90,90 };
    inline static int16_t _minPulse[MAX_SERVOS] = { 544,544,544,544,544,544,544,544 };
    inline static int16_t _maxPulse[MAX_SERVOS] = { 2400,2400,2400,2400,2400,2400,2400,2400 };
    inline static bool    _attached[MAX_SERVOS] = {};

    // On-board timed-move interpolation state (see loop()).
    inline static bool     _moving[MAX_SERVOS]     = {};
    inline static int16_t  _fromAngle[MAX_SERVOS]  = {};
    inline static int16_t  _toAngle[MAX_SERVOS]    = {};
    inline static uint32_t _startMs[MAX_SERVOS]    = {};
    inline static uint32_t _durMs[MAX_SERVOS]      = {};
    inline static uint32_t _lastStepMs[MAX_SERVOS] = {};

    // Min ms between interpolation writes — servos refresh PWM at ~50 Hz, so
    // writing faster is wasted loop time. Angle is always from true elapsed
    // time (millis()), so loop jitter never desynchronises a group move.
    static const uint32_t STEP_MS = 20;

    static bool validId(int id) { return id >= 0 && id < MAX_SERVOS; }

    // Begin (or immediately apply, if dur == 0) a timed move to `angle`.
    static void startTimed(int id, int angle, uint32_t dur, uint32_t now) {
        angle = constrain(angle, 0, 180);
        if (dur == 0) {
            _servos[id].write(angle);
            _angles[id] = (int16_t)angle;
            _moving[id] = false;
            broadcastDone(id, angle);
            return;
        }
        _fromAngle[id]  = _angles[id];
        _toAngle[id]    = (int16_t)angle;
        _startMs[id]    = now;
        _durMs[id]      = dur;
        _lastStepMs[id] = 0;          // force a write on the first tick
        _moving[id]     = true;
    }

    static void broadcastDone(int id, int angle) {
        FrameBuilder fb;
        fb.begin(CMD_SERVO_DONE, DEVICE_SERVO);
        fb.addInt(id);
        fb.addInt(angle);
        Pardalote.broadcastFrame(fb);
    }

public:
    // -------------------------------------------------------------------
    // Sketch-facing read accessors (used by the PardaloteServo object).
    // -------------------------------------------------------------------
    static int  readAngle(int id)  { return (validId(id) && _attached[id]) ? _angles[id] : -1; }
    static bool isMovingId(int id) { return validId(id) && _attached[id] && _moving[id]; }
    static bool attachedId(int id) { return validId(id) && _attached[id]; }
    static int  listAttached(int* out, int max) {
        int n = 0;
        for (int i = 0; i < MAX_SERVOS && n < max; i++) if (_attached[i]) out[n++] = i;
        return n;
    }
    // Echo a sketch-issued write to the browser so it sets its cached angle
    // exactly as if the browser had written it (CMD_SERVO_WRITE — silent sync).
    static void echoAngle(int id, int angle) {
        if (!validId(id) || !_attached[id]) return;
        FrameBuilder fb;
        fb.begin(CMD_SERVO_WRITE, DEVICE_SERVO);
        fb.addInt(id);
        fb.addInt(constrain(angle, 0, 180));
        Pardalote.broadcastFrame(fb);
    }

    // -------------------------------------------------------------------
    // Main dispatch — called by the extension registry for every frame
    // whose TARGET == DEVICE_SERVO.
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {

        // Global (multi-servo) command — handled before per-instance id read.
        if (cmd == CMD_SERVO_SYNC_TIMED) {
            uint32_t dur = (nparams >= 1) ? (uint32_t)paramInt(params, 0) : 0;
            uint32_t now = millis();
            int count = payloadLen / 2;                 // { logicalId u8, angle u8 }
            for (int i = 0; i < count; i++) {
                int sid = payload[i * 2];
                int ang = payload[i * 2 + 1];
                if (validId(sid) && _attached[sid]) startTimed(sid, ang, dur, now);
            }
            return;
        }

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

                // Skip the detach/attach cycle (and the Serial print) when the
                // state is already what was requested. JS's reconnect logic and
                // 'ready' handlers can both call attach() with identical params;
                // treating those as no-ops avoids redundant PWM glitches and
                // duplicate Serial output.
                bool stateChanged = !_attached[id]
                                    || _pins[id]     != pin
                                    || _minPulse[id] != minP
                                    || _maxPulse[id] != maxP;
                if (!stateChanged) break;

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
                _moving[id] = false;   // an immediate write cancels a timed move
                int angle = constrain((int)paramInt(params, 1), 0, 180);
                _servos[id].write(angle);
                _angles[id] = (int16_t)angle;
                break;
            }

            case CMD_SERVO_WRITE_MICROSECONDS: {
                if (!_attached[id] || nparams < 2) return;
                _moving[id] = false;   // an immediate write cancels a timed move
                int us = constrain((int)paramInt(params, 1), 544, 2400);
                _servos[id].writeMicroseconds(us);
                break;
            }

            case CMD_SERVO_WRITE_TIMED: {
                if (!_attached[id] || nparams < 3) return;
                int angle    = (int)paramInt(params, 1);
                uint32_t dur = (uint32_t)paramInt(params, 2);
                startTimed(id, angle, dur, millis());
                break;
            }

            case CMD_SERVO_STOP:
                if (_attached[id]) _moving[id] = false;   // hold current angle
                break;

            case CMD_SERVO_READ: {
                // Delegate to the underlying Servo library's read().
                //   - Arduino Servo (UNO R4): returns the last written angle
                //   - ESP32Servo: reads back from the LEDC PWM duty register
                // The ESP32 path can return values slightly different from
                // the commanded angle — that's the library's actual behavior
                // and we forward it faithfully. Sketches that just want to
                // know "what did I last command?" should track that locally
                // (or read arduino.myServo.angle on the JS side) instead of
                // round-tripping through read().
                int angle = _attached[id] ? _servos[id].read() : -1;
                if (_attached[id]) _angles[id] = (int16_t)angle;

                FrameBuilder fb;
                fb.begin(CMD_SERVO_READ, DEVICE_SERVO);
                fb.addInt(id);
                fb.addInt(angle);
                Pardalote.broadcastFrame(fb);
                break;
            }

            case CMD_SERVO_ATTACHED: {
                bool isAttached = _attached[id] && _servos[id].attached();

                FrameBuilder fb;
                fb.begin(CMD_SERVO_ATTACHED, DEVICE_SERVO);
                fb.addInt(id);
                fb.addInt(isAttached ? 1 : 0);
                Pardalote.broadcastFrame(fb);
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
        Pardalote.sendFrame(clientNum, fb);

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
            Pardalote.sendFrame(clientNum, fa);

            FrameBuilder fw;
            fw.begin(CMD_SERVO_WRITE, DEVICE_SERVO);
            fw.addInt(i);
            fw.addInt(_angles[i]);
            Pardalote.sendFrame(clientNum, fw);
        }
    }

    // -------------------------------------------------------------------
    // Loop hook — runs every Pardalote.run(). Advances any in-progress
    // timed moves. The angle is computed from true elapsed time (millis()),
    // so a group of servos sharing one duration stays in phase regardless of
    // loop-rate jitter, and they all finish on the same tick.
    // -------------------------------------------------------------------
    static void loop() {
        uint32_t now = millis();
        for (int i = 0; i < MAX_SERVOS; i++) {
            if (!_attached[i] || !_moving[i]) continue;
            uint32_t elapsed = now - _startMs[i];
            if (elapsed >= _durMs[i]) {
                _servos[i].write(_toAngle[i]);
                _angles[i] = _toAngle[i];
                _moving[i] = false;
                broadcastDone(i, _toAngle[i]);
            } else if (now - _lastStepMs[i] >= STEP_MS) {
                float t   = (float)elapsed / (float)_durMs[i];       // 0..1 (linear)
                int   ang = _fromAngle[i] + (int)((_toAngle[i] - _fromAngle[i]) * t);
                _servos[i].write(ang);
                _angles[i]     = (int16_t)ang;
                _lastStepMs[i] = now;
            }
        }
    }
};

// -------------------------------------------------------------------
// PardaloteServo — sketch-facing "bus" of PWM servos. Read the actuators
// the browser configured, addressed by logical id:
//   int ids[8];
//   int n = PardaloteServo.scan(ids, 8);      // attached servos → their ids
//   int angle = PardaloteServo.read(ids[0]);  // current angle (0–180), −1 if none
// -------------------------------------------------------------------
class PardaloteServoAccess {
public:
    int  scan(int* out, int max) const { return ServoExt::listAttached(out, max); }
    int  read(int id)            const { return ServoExt::readAngle(id); }
    bool isMoving(int id)        const { return ServoExt::isMovingId(id); }
    bool attached(int id)        const { return ServoExt::attachedId(id); }

    // Writes — routed through the same handler the browser uses.
    // Writes — command the servo, then echo the angle to the browser so its
    // record matches, exactly as if the browser had issued the write.
    void write(int id, int angle)              const { Pardalote.command(DEVICE_SERVO, CMD_SERVO_WRITE, id, angle);            ServoExt::echoAngle(id, angle); }
    void writeTimed(int id, int angle, int ms) const { Pardalote.command(DEVICE_SERVO, CMD_SERVO_WRITE_TIMED, id, angle, ms); ServoExt::echoAngle(id, angle); }
    void stop(int id)                          const { Pardalote.command(DEVICE_SERVO, CMD_SERVO_STOP, id); }
};
inline PardaloteServoAccess PardaloteServo;

// Self-register — runs before setup(). Passes nullptr for the disconnect
// hook and ServoExt::loop for the per-iteration interpolation.
INSTALL_EXTENSION(DEVICE_SERVO, ServoExt::handle, ServoExt::announce,
                  nullptr, ServoExt::loop)

#endif
