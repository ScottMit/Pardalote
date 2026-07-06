// ==============================================================
// PardaloteStepper.h
// Pardalote Stepper Motor Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Add #include <PardaloteStepper.h> to your sketch — the extension
// self-registers, no further setup is required.
//
// Requires the AccelStepper library (by Mike McCauley):
//   Arduino IDE → Tools → Manage Libraries → search "AccelStepper".
//
// Supports up to MAX_STEPPERS simultaneously attached steppers driven
// by STEP/DIR drivers (TMC2208/2209, A4988, EasyDriver, ...) or by
// 4-wire coil drivers (28BYJ-48 via ULN2003, bipolar via H-bridge).
//
// Motion runs ON THE BOARD: JS sends targets and motion profiles, and
// AccelStepper::run() / runSpeed() generate the step pulses inside the
// extension loop hook. This is why we mirror AccelStepper (non-blocking)
// rather than the built-in Stepper library (whose step() blocks and
// would stall Pardalote.run(), dropping WebSocket frames mid-move).
//
// Each stepper is addressed by a logical instance ID assigned by the JS
// side when calling arduino.add('name', new Stepper()).
// ==============================================================

#ifndef PARDALOTE_STEPPER_H
#define PARDALOTE_STEPPER_H

#include <AccelStepper.h>
#include "Pardalote.h"

#define MAX_STEPPERS 6

class StepperExt {
private:
    // Motion mode per instance.
    //   POSITION — accel-limited moveTo (run()).
    //   VELOCITY — continuous constant speed (runSpeed()).
    //   TIMED    — constant-speed move to a target sized to arrive in a set
    //              duration (runSpeedToPosition()); used for group arrive-together.
    enum Mode : uint8_t { MODE_POSITION = 0, MODE_VELOCITY = 1, MODE_TIMED = 2 };

    inline static AccelStepper* _steppers[MAX_STEPPERS] = {};
    inline static bool          _attached[MAX_STEPPERS] = {};
    inline static Mode          _mode[MAX_STEPPERS]     = {};
    inline static bool          _wasRunning[MAX_STEPPERS] = {};

    // Stored attach params so announce() can replay them to a fresh client.
    inline static int16_t _interface[MAX_STEPPERS] = {};
    inline static int16_t _pins[MAX_STEPPERS][4]   = {};
    inline static int16_t _enPin[MAX_STEPPERS]     = { -1,-1,-1,-1,-1,-1 };
    inline static int16_t _invert[MAX_STEPPERS]    = {};

    // Motion profile (kept so we can replay it on announce).
    inline static float _maxSpeed[MAX_STEPPERS] = { 1000,1000,1000,1000,1000,1000 };
    inline static float _accel[MAX_STEPPERS]    = { 500,500,500,500,500,500 };

    // Soft position limits (safety).
    inline static bool    _limitEnabled[MAX_STEPPERS] = {};
    inline static int32_t _limitMin[MAX_STEPPERS]     = {};
    inline static int32_t _limitMax[MAX_STEPPERS]     = {};

    static bool validId(int id) { return id >= 0 && id < MAX_STEPPERS; }

    // Read a numeric param as float regardless of how JS encoded it.
    // encodeFrame() sends whole numbers as int32 and only non-integers as
    // float32, so speed/accel can arrive as either type — decode per mask.
    static float paramNum(uint8_t* params, uint16_t typeMask, int i) {
        return paramIsFloat(typeMask, i) ? paramFloat(params, i)
                                         : (float)paramInt(params, i);
    }

    // Clamp an absolute target to the soft limits if they're enabled.
    static int32_t clampTarget(int id, int32_t target) {
        if (_limitEnabled[id]) {
            if (target < _limitMin[id]) target = _limitMin[id];
            if (target > _limitMax[id]) target = _limitMax[id];
        }
        return target;
    }

    static bool isRunning(int id) {
        AccelStepper* s = _steppers[id];
        if (!s) return false;
        return (_mode[id] == MODE_VELOCITY) ? (s->speed() != 0.0f)
                                            : (s->distanceToGo() != 0);
    }

    // Start a constant-speed move to `target` sized to finish in ~durationMs.
    // The board knows its own exact position, so it computes the matched speed
    // itself — a group sharing one duration arrives together. AccelStepper's
    // setSpeed() is clamped to maxSpeed(), so raise the cap for this move.
    static void startTimedMove(int id, int32_t target, uint32_t durationMs) {
        AccelStepper* s = _steppers[id];
        if (!s) return;
        target = clampTarget(id, target);
        long  distance = (long)target - s->currentPosition();
        float durSec   = (durationMs > 0) ? (durationMs / 1000.0f) : 0.001f;
        float speed    = fabs((float)distance) / durSec;
        if (speed < 1.0f) speed = 1.0f;                  // never 0 (would never step)
        if (s->maxSpeed() < speed) s->setMaxSpeed(speed);
        s->moveTo(target);
        s->setSpeed(distance >= 0 ? speed : -speed);
        _mode[id] = MODE_TIMED;
    }

public:
    // -------------------------------------------------------------------
    // Sketch-facing read accessors (used by the PardaloteStepper object).
    // -------------------------------------------------------------------
    static long positionId(int id)     { return (validId(id) && _steppers[id]) ? _steppers[id]->currentPosition() : 0; }
    static long distanceToGoId(int id) { return (validId(id) && _steppers[id]) ? _steppers[id]->distanceToGo() : 0; }
    static bool runningId(int id)      { return validId(id) && _attached[id] && isRunning(id); }
    static bool attachedId(int id)     { return validId(id) && _attached[id]; }
    static int  listAttached(int* out, int max) {
        int n = 0;
        for (int i = 0; i < MAX_STEPPERS && n < max; i++) if (_attached[i]) out[n++] = i;
        return n;
    }
    // Echo the board's current target to the browser so it sets its cached
    // target exactly as if the browser had issued the move.
    static void echoTarget(int id) {
        if (!validId(id) || !_steppers[id]) return;
        FrameBuilder fb;
        fb.begin(CMD_STEPPER_MOVE_TO, DEVICE_STEPPER);
        fb.addInt(id);
        fb.addInt(_steppers[id]->targetPosition());
        Pardalote.broadcastFrame(fb);
    }

    // -------------------------------------------------------------------
    // Main dispatch — called by the extension registry for every frame
    // whose TARGET == DEVICE_STEPPER.
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {

        // Global (multi-stepper) command — handled before per-instance id read.
        if (cmd == CMD_STEPPER_SYNC_MOVE) {
            uint32_t dur = (nparams >= 1) ? (uint32_t)paramInt(params, 0) : 0;
            const int REC = 5;                          // { logicalId u8, target i32 }
            int count = payloadLen / REC;
            for (int i = 0; i < count; i++) {
                uint8_t* r = payload + i * REC;
                int sid = r[0];
                int32_t target = (int32_t)(((uint32_t)r[1] << 24) | ((uint32_t)r[2] << 16) |
                                           ((uint32_t)r[3] <<  8) |  (uint32_t)r[4]);
                if (validId(sid) && _attached[sid] && _steppers[sid]) startTimedMove(sid, target, dur);
            }
            return;
        }

        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("Stepper: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            case CMD_STEPPER_ATTACH: {
                if (nparams < 4) return;
                int iface = (int)paramInt(params, 1);

                // Tear down any previous instance on this id.
                if (_steppers[id]) { delete _steppers[id]; _steppers[id] = nullptr; }

                int p1 = (int)paramInt(params, 2);
                int p2 = (int)paramInt(params, 3);
                int p3 = (nparams > 4) ? (int)paramInt(params, 4) : -1;
                int p4 = (nparams > 5) ? (int)paramInt(params, 5) : -1;

                if (iface == STEPPER_FULL4WIRE) {
                    _steppers[id] = new AccelStepper(AccelStepper::FULL4WIRE, p1, p2, p3, p4);
                    _enPin[id]  = -1;
                    _invert[id] = 0;
                    _pins[id][0] = p1; _pins[id][1] = p2; _pins[id][2] = p3; _pins[id][3] = p4;
                } else {
                    // STEPPER_DRIVER (default): p1=STEP, p2=DIR.
                    _steppers[id] = new AccelStepper(AccelStepper::DRIVER, p1, p2);
                    int enPin  = (nparams > 4) ? (int)paramInt(params, 4) : -1;
                    int invert = (nparams > 5) ? (int)paramInt(params, 5) : 0x04; // enable active-LOW
                    _enPin[id]  = (int16_t)enPin;
                    _invert[id] = (int16_t)invert;
                    _pins[id][0] = p1; _pins[id][1] = p2; _pins[id][2] = -1; _pins[id][3] = -1;

                    bool invDir = invert & 0x01, invStep = invert & 0x02, invEn = invert & 0x04;
                    _steppers[id]->setPinsInverted(invDir, invStep, invEn);
                    if (enPin >= 0) {
                        _steppers[id]->setEnablePin(enPin);
                        _steppers[id]->enableOutputs();
                    }
                }

                _interface[id] = (int16_t)iface;
                _steppers[id]->setMaxSpeed(_maxSpeed[id]);
                _steppers[id]->setAcceleration(_accel[id]);
                _mode[id]       = MODE_POSITION;
                _wasRunning[id] = false;
                _attached[id]   = true;

                Serial.print(F("Stepper ")); Serial.print(id);
                Serial.print(F(" attached (iface ")); Serial.print(iface);
                Serial.println(F(")"));
                break;
            }

            case CMD_STEPPER_DETACH:
                if (_attached[id]) {
                    if (_steppers[id]) {
                        _steppers[id]->disableOutputs();
                        delete _steppers[id];
                        _steppers[id] = nullptr;
                    }
                    _attached[id]   = false;
                    _limitEnabled[id] = false;
                    Serial.print(F("Stepper ")); Serial.print(id);
                    Serial.println(F(" detached"));
                }
                break;

            case CMD_STEPPER_MOVE_TO: {
                if (!_attached[id] || nparams < 2) return;
                int32_t target = clampTarget(id, (int32_t)paramInt(params, 1));
                _mode[id] = MODE_POSITION;
                _steppers[id]->setMaxSpeed(_maxSpeed[id]);   // restore cap (a timed move may have raised it)
                _steppers[id]->moveTo(target);
                break;
            }

            case CMD_STEPPER_MOVE: {
                if (!_attached[id] || nparams < 2) return;
                int32_t rel    = (int32_t)paramInt(params, 1);
                int32_t target = clampTarget(id, _steppers[id]->currentPosition() + rel);
                _mode[id] = MODE_POSITION;
                _steppers[id]->setMaxSpeed(_maxSpeed[id]);   // restore cap (a timed move may have raised it)
                _steppers[id]->moveTo(target);
                break;
            }

            case CMD_STEPPER_MOVE_TIMED: {
                if (!_attached[id] || nparams < 3) return;
                int32_t target = (int32_t)paramInt(params, 1);
                uint32_t dur   = (uint32_t)paramInt(params, 2);
                startTimedMove(id, target, dur);
                break;
            }

            case CMD_STEPPER_SET_MAX_SPEED: {
                if (!_attached[id] || nparams < 2) return;
                float v = paramNum(params, typeMask, 1);
                _maxSpeed[id] = v;
                _steppers[id]->setMaxSpeed(v);
                break;
            }

            case CMD_STEPPER_SET_ACCEL: {
                if (!_attached[id] || nparams < 2) return;
                float a = paramNum(params, typeMask, 1);
                _accel[id] = a;
                _steppers[id]->setAcceleration(a);
                break;
            }

            case CMD_STEPPER_RUN_SPEED: {
                if (!_attached[id] || nparams < 2) return;
                float v = paramNum(params, typeMask, 1);
                _mode[id] = MODE_VELOCITY;
                _steppers[id]->setSpeed(v);
                break;
            }

            case CMD_STEPPER_STOP:
                if (!_attached[id]) return;
                // Decelerate to a stop using the current speed/accel profile.
                // stop() sets a position target, so switch to position mode
                // and let run() ramp it down in the loop hook.
                _mode[id] = MODE_POSITION;
                _steppers[id]->stop();
                break;

            case CMD_STEPPER_SET_POSITION: {
                if (!_attached[id] || nparams < 2) return;
                _steppers[id]->setCurrentPosition((int32_t)paramInt(params, 1));
                _wasRunning[id] = false;
                break;
            }

            case CMD_STEPPER_ENABLE: {
                if (!_attached[id] || nparams < 2) return;
                bool en = paramInt(params, 1) != 0;
                if (en) _steppers[id]->enableOutputs();
                else    _steppers[id]->disableOutputs();
                break;
            }

            case CMD_STEPPER_SET_LIMITS: {
                if (!_attached[id] || nparams < 4) return;
                _limitMin[id]     = (int32_t)paramInt(params, 1);
                _limitMax[id]     = (int32_t)paramInt(params, 2);
                _limitEnabled[id] = paramInt(params, 3) != 0;
                break;
            }

            case CMD_STEPPER_READ: {
                if (!_attached[id]) return;
                sendRead(id);
                break;
            }

            default:
                Serial.print(F("Stepper: unknown cmd 0x"));
                Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Loop hook — runs every Pardalote.run() iteration. This is where the
    // step pulses are actually generated. Also detects position-mode
    // target completion and broadcasts CMD_STEPPER_DONE once per move.
    // -------------------------------------------------------------------
    static void loop() {
        for (int id = 0; id < MAX_STEPPERS; id++) {
            if (!_attached[id] || !_steppers[id]) continue;
            AccelStepper* s = _steppers[id];

            if (_mode[id] == MODE_VELOCITY) {
                // Enforce soft limits by stopping at the boundary.
                if (_limitEnabled[id]) {
                    int32_t pos = s->currentPosition();
                    float   spd = s->speed();
                    if ((spd > 0 && pos >= _limitMax[id]) ||
                        (spd < 0 && pos <= _limitMin[id])) {
                        _mode[id] = MODE_POSITION;
                        s->moveTo(pos);   // hold here
                    }
                }
                s->runSpeed();
            } else if (_mode[id] == MODE_TIMED) {
                s->runSpeedToPosition();   // constant speed to target (arrive-together)
            } else {
                s->run();
            }

            bool running = isRunning(id);
            if (_wasRunning[id] && !running &&
                (_mode[id] == MODE_POSITION || _mode[id] == MODE_TIMED)) {
                // Target reached — tell the browser once.
                FrameBuilder fb;
                fb.begin(CMD_STEPPER_DONE, DEVICE_STEPPER);
                fb.addInt(id);
                fb.addInt(s->currentPosition());
                Pardalote.broadcastFrame(fb);
            }
            _wasRunning[id] = running;
        }
    }

    // -------------------------------------------------------------------
    // Poll response — current position, remaining distance, speed, state.
    // -------------------------------------------------------------------
    static void sendRead(int id) {
        AccelStepper* s = _steppers[id];
        FrameBuilder fb;
        fb.begin(CMD_STEPPER_READ, DEVICE_STEPPER);
        fb.addInt(id);
        fb.addInt(s->currentPosition());
        fb.addInt(s->distanceToGo());
        fb.addFloat(s->speed());
        fb.addInt(isRunning(id) ? 1 : 0);
        Pardalote.broadcastFrame(fb);
    }

    // -------------------------------------------------------------------
    // Called on every new client connection. Announces the extension,
    // then replays each attached stepper's full state so a browser joining
    // a running system sees true configuration and live position.
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_STEPPER);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_STEPPERS);
        Pardalote.sendFrame(clientNum, fb);

        for (int i = 0; i < MAX_STEPPERS; i++) {
            if (!_attached[i] || !_steppers[i]) continue;

            // Replay attach (interface + pins + enable + invert).
            FrameBuilder fa;
            fa.begin(CMD_STEPPER_ATTACH, DEVICE_STEPPER);
            fa.addInt(i);
            fa.addInt(_interface[i]);
            if (_interface[i] == STEPPER_FULL4WIRE) {
                fa.addInt(_pins[i][0]); fa.addInt(_pins[i][1]);
                fa.addInt(_pins[i][2]); fa.addInt(_pins[i][3]);
            } else {
                fa.addInt(_pins[i][0]); fa.addInt(_pins[i][1]);
                fa.addInt(_enPin[i]);   fa.addInt(_invert[i]);
            }
            Pardalote.sendFrame(clientNum, fa);

            // Replay motion profile.
            FrameBuilder fs; fs.begin(CMD_STEPPER_SET_MAX_SPEED, DEVICE_STEPPER);
            fs.addInt(i); fs.addFloat(_maxSpeed[i]); Pardalote.sendFrame(clientNum, fs);

            FrameBuilder fac; fac.begin(CMD_STEPPER_SET_ACCEL, DEVICE_STEPPER);
            fac.addInt(i); fac.addFloat(_accel[i]); Pardalote.sendFrame(clientNum, fac);

            // Replay soft limits if set.
            if (_limitEnabled[i]) {
                FrameBuilder fl; fl.begin(CMD_STEPPER_SET_LIMITS, DEVICE_STEPPER);
                fl.addInt(i); fl.addInt(_limitMin[i]); fl.addInt(_limitMax[i]); fl.addInt(1);
                Pardalote.sendFrame(clientNum, fl);
            }

            // Sync live position.
            FrameBuilder fp; fp.begin(CMD_STEPPER_SET_POSITION, DEVICE_STEPPER);
            fp.addInt(i); fp.addInt(_steppers[i]->currentPosition());
            Pardalote.sendFrame(clientNum, fp);

            // If mid-move, replay the current target so the client knows the goal.
            if (_mode[i] == MODE_POSITION && _steppers[i]->distanceToGo() != 0) {
                FrameBuilder ft; ft.begin(CMD_STEPPER_MOVE_TO, DEVICE_STEPPER);
                ft.addInt(i); ft.addInt(_steppers[i]->targetPosition());
                Pardalote.sendFrame(clientNum, ft);
            }
        }
    }
};

// -------------------------------------------------------------------
// PardaloteStepper — sketch-facing "bus" of steppers, addressed by
// logical id:
//   int ids[6];
//   int n = PardaloteStepper.scan(ids, 6);      // attached steppers → their ids
//   long pos = PardaloteStepper.read(ids[0]);   // current step position
// -------------------------------------------------------------------
class PardaloteStepperAccess {
public:
    int  scan(int* out, int max) const { return StepperExt::listAttached(out, max); }
    long read(int id)            const { return StepperExt::positionId(id); }     // steps
    long position(int id)        const { return StepperExt::positionId(id); }     // alias
    long distanceToGo(int id)    const { return StepperExt::distanceToGoId(id); }
    bool isRunning(int id)       const { return StepperExt::runningId(id); }
    bool attached(int id)        const { return StepperExt::attachedId(id); }

    // Writes — routed through the same handler the browser uses.
    // Writes — command the move, then echo the resulting target to the browser
    // so its record matches, exactly as if the browser had issued the move.
    void moveTo(int id, long target) const { Pardalote.command(DEVICE_STEPPER, CMD_STEPPER_MOVE_TO, id, (int32_t)target); StepperExt::echoTarget(id); }
    void move(int id, long rel)      const { Pardalote.command(DEVICE_STEPPER, CMD_STEPPER_MOVE, id, (int32_t)rel);       StepperExt::echoTarget(id); }
    void stop(int id)                const { Pardalote.command(DEVICE_STEPPER, CMD_STEPPER_STOP, id); }
};
inline PardaloteStepperAccess PardaloteStepper;

// Self-register — runs before setup(). Passes nullptr for the disconnect
// hook and StepperExt::loop for the per-iteration loop hook.
INSTALL_EXTENSION(DEVICE_STEPPER, StepperExt::handle, StepperExt::announce,
                  nullptr, StepperExt::loop)

#endif
