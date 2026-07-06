// ==============================================================
// PardaloteBusServo.h
// Pardalote Serial Bus Servo Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Add #include <PardaloteBusServo.h> to your sketch — the extension
// self-registers, no further setup is required.
//
// Serial-bus smart servos: Feetech ST / SMS series (0–4095 counts, e.g.
// STS3215 — the servo used in the LeRobot SO-100/SO-101 arms) and SC / SCS
// series (0–1023 counts). Driven over a single half-duplex UART, typically
// via a Waveshare Serial Bus Servo Driver board.
//
// Requires the Feetech / Waveshare SCServo library, which provides the
// SMS_STS and SCSCL classes. It handles the packet protocol, half-duplex
// direction switching, and — importantly — the sign-magnitude encoding of
// the offset and wheel-speed registers, a classic source of bugs if you
// hand-roll the protocol.
//
// -------------------------------------------------------------------
// UNLIKE THE PWM SERVO EXTENSION: every bus servo shares ONE UART and is
// addressed by a hardware servo ID (1–253). A Pardalote instance therefore
// binds a logical id to a servo ID; the bus itself is a single shared
// resource configured once (CMD_BUSSERVO_BUS_CONFIG, or lazily on first
// attach at 1 Mbps on Serial1).
// -------------------------------------------------------------------
//
// NOTE: this targets the standard Feetech/Waveshare SCServo API. Method
// names are stable across the common library versions, but bring this up
// on hardware and confirm your board's wiring and library build before
// relying on it in a studio. The ST series is the primary tested path.
// ==============================================================

#ifndef PARDALOTE_BUSSERVO_H
#define PARDALOTE_BUSSERVO_H

#include <SCServo.h>       // Feetech / Waveshare: provides SMS_STS and SCSCL
#include "Pardalote.h"

#define MAX_BUS_SERVOS      16
#define BUSSERVO_DEF_BAUD   1000000UL

// STS/SMS EEPROM register addresses (for ops the high-level API doesn't wrap).
#define BUSSERVO_ADDR_MODE      33
#define BUSSERVO_ADDR_MIN_LIMIT  9
#define BUSSERVO_ADDR_MAX_LIMIT 11

// One servo's live feedback (returned by PardaloteBusServo.feedback()).
struct PardaloteBusServoReading {
    int  position;      // counts
    int  velocity;
    int  load;
    int  voltage;       // decivolts (e.g. 74 = 7.4 V)
    int  temperature;   // °C
    int  current;       // raw units (ST only)
    bool ok;            // false if the servo didn't answer
};

class BusServoExt {
private:
    // ---- shared bus ----
    inline static SMS_STS _st;      // ST / SMS series
    inline static SCSCL   _sc;      // SC / SCS series
    inline static bool    _busConfigured = false;
    inline static int     _serialIndex   = 1;
    inline static uint32_t _baud         = BUSSERVO_DEF_BAUD;
    inline static int     _rxPin         = -1;
    inline static int     _txPin         = -1;

    // ---- per-instance state (indexed by logical id) ----
    inline static uint8_t _servoId[MAX_BUS_SERVOS]  = {};
    inline static uint8_t _series[MAX_BUS_SERVOS]   = {};
    inline static bool    _attached[MAX_BUS_SERVOS] = {};
    inline static uint8_t _mode[MAX_BUS_SERVOS]     = {};   // 0=position, 1=wheel
    inline static bool    _torque[MAX_BUS_SERVOS]   = {};
    inline static bool    _limitSet[MAX_BUS_SERVOS] = {};
    inline static int16_t _minPos[MAX_BUS_SERVOS]   = {};
    inline static int16_t _maxPos[MAX_BUS_SERVOS]   = {};

    // Arrival tracking — the bus can't push a "done", so after a position write
    // the board polls the servo's Moving flag in loop() and emits CMD_BUSSERVO_DONE
    // when it settles. Makes bus servos look like steppers/servos to the browser.
    inline static bool     _awaitDone[MAX_BUS_SERVOS]      = {};
    inline static uint32_t _awaitStartMs[MAX_BUS_SERVOS]   = {};
    inline static uint32_t _lastMovePollMs[MAX_BUS_SERVOS] = {};
    inline static uint32_t _lastRespMs[MAX_BUS_SERVOS]     = {};
    static const uint32_t MOVE_POLL_MS    = 33;     // ~30 Hz, like LeRobot
    static const uint32_t MOVE_STARTUP_MS = 40;     // let it start moving before first poll
    static const uint32_t MOVE_NO_RESP_MS = 1000;   // give up if the servo stops answering
    static const uint32_t MOVE_MAX_MS     = 30000;  // absolute ceiling on one move

    static void beginAwaitDone(int id) {
        if (!validId(id) || !_attached[id]) return;
        uint32_t now        = millis();
        _awaitDone[id]      = true;
        _awaitStartMs[id]   = now;
        _lastRespMs[id]     = now;
        _lastMovePollMs[id] = 0;
    }

    static bool validId(int id) { return id >= 0 && id < MAX_BUS_SERVOS; }
    static bool isSC(int id)    { return _series[id] == BUSSERVO_SERIES_SC; }

    static HardwareSerial* busSerial() {
#if defined(PLATFORM_ESP32)
        return (_serialIndex == 2) ? &Serial2 : &Serial1;
#else
        return &Serial1;   // UNO R4 WiFi: Serial1 on D0/D1
#endif
    }

    // Bring up the shared UART and point both servo classes at it. Idempotent.
    static void ensureBus() {
        if (_busConfigured) return;
        HardwareSerial* s = busSerial();
#if defined(PLATFORM_ESP32)
        if (_rxPin >= 0 && _txPin >= 0) s->begin(_baud, SERIAL_8N1, _rxPin, _txPin);
        else                            s->begin(_baud);
#else
        s->begin(_baud);
#endif
        _st.pSerial = s;
        _sc.pSerial = s;
        _busConfigured = true;
        Serial.print(F("BusServo: bus up on Serial")); Serial.print(_serialIndex);
        Serial.print(F(" @ ")); Serial.print(_baud); Serial.println(F(" baud"));
    }

    // ---- series-routed primitives ----
    static void writePos(int id, int pos, int speed, int acc) {
        uint8_t sid = _servoId[id];
        if (isSC(id)) _sc.WritePos(sid, pos, 0, speed);
        else          _st.WritePosEx(sid, pos, speed, acc);
    }

    static void writeSpeed(int id, int speed, int acc) {
        uint8_t sid = _servoId[id];
        if (isSC(id)) _sc.WriteSpe(sid, speed, acc);
        else          _st.WriteSpe(sid, speed, acc);
    }

    static void setTorque(int id, bool en) {
        uint8_t sid = _servoId[id];
        if (isSC(id)) _sc.EnableTorque(sid, en ? 1 : 0);
        else          _st.EnableTorque(sid, en ? 1 : 0);
        _torque[id] = en;
    }

    static void setMode(int id, uint8_t mode) {
        uint8_t sid = _servoId[id];
        if (mode == BUSSERVO_MODE_WHEEL) {
            if (isSC(id)) _sc.WheelMode(sid);
            else          _st.WheelMode(sid);
        } else {
            // Return to position mode: mode register lives in EEPROM, so
            // unlock → write → lock. (WheelMode() set it to 1 for us.)
            if (isSC(id)) {
                _sc.unLockEprom(sid); _sc.writeByte(sid, BUSSERVO_ADDR_MODE, 0); _sc.LockEprom(sid);
            } else {
                _st.unLockEprom(sid); _st.writeByte(sid, BUSSERVO_ADDR_MODE, 0); _st.LockEprom(sid);
            }
        }
        _mode[id] = mode;
    }

public:
    // -------------------------------------------------------------------
    // Sketch-facing bus read accessors (used by the PardaloteBusServo
    // object). Addressed by HARDWARE servo ID — the number scan() returns.
    // These do live, blocking bus transactions.
    // -------------------------------------------------------------------
    // Series of a known-attached servo, else default ST.
    static int busSeriesForId(uint8_t servoId) {
        for (int i = 0; i < MAX_BUS_SERVOS; i++)
            if (_attached[i] && _servoId[i] == servoId) return _series[i];
        return BUSSERVO_SERIES_ST;
    }

    // Logical instance bound to a hardware servo ID, or -1 if none is.
    static int logicalForServoId(uint8_t servoId) {
        for (int i = 0; i < MAX_BUS_SERVOS; i++)
            if (_attached[i] && _servoId[i] == servoId) return i;
        return -1;
    }

    // Ping a range of IDs; fill out[] with those that respond, return count.
    static int scanBus(uint8_t* out, int max, int first, int last) {
        ensureBus();
        int n = 0;
        for (int sid = first; sid <= last && n < max; sid++)
            if (_st.Ping(sid) != -1 || _sc.Ping(sid) != -1) out[n++] = (uint8_t)sid;
        return n;
    }

    // Present position (counts) for one servo ID, or -1 if it doesn't answer.
    static int readPos(uint8_t servoId) {
        ensureBus();
        bool sc = (busSeriesForId(servoId) == BUSSERVO_SERIES_SC);
        int rc = sc ? _sc.FeedBack(servoId) : _st.FeedBack(servoId);
        if (rc == -1) return -1;
        return sc ? _sc.ReadPos(-1) : _st.ReadPos(-1);
    }

    // Full feedback in one bus transaction.
    static PardaloteBusServoReading readFeedback(uint8_t servoId) {
        ensureBus();
        PardaloteBusServoReading r = { -1, 0, 0, 0, 0, 0, false };
        bool sc = (busSeriesForId(servoId) == BUSSERVO_SERIES_SC);
        int rc = sc ? _sc.FeedBack(servoId) : _st.FeedBack(servoId);
        if (rc == -1) return r;
        r.ok = true;
        if (sc) {
            r.position    = _sc.ReadPos(-1);   r.velocity = _sc.ReadSpeed(-1);
            r.load        = _sc.ReadLoad(-1);  r.voltage  = _sc.ReadVoltage(-1);
            r.temperature = _sc.ReadTemper(-1);
        } else {
            r.position    = _st.ReadPos(-1);   r.velocity = _st.ReadSpeed(-1);
            r.load        = _st.ReadLoad(-1);  r.voltage  = _st.ReadVoltage(-1);
            r.temperature = _st.ReadTemper(-1); r.current = _st.ReadCurrent(-1);
        }
        return r;
    }

    // The servo's own Moving flag (its "am I still moving?" — accounts for
    // deadband/settling). One bus read. Returns 1 = moving, 0 = arrived/idle,
    // -1 if the servo didn't answer.
    static int readMoving(uint8_t servoId) {
        ensureBus();
        bool sc = (busSeriesForId(servoId) == BUSSERVO_SERIES_SC);
        return sc ? _sc.ReadMove(servoId) : _st.ReadMove(servoId);
    }

    // Sketch-facing writes — direct bus commands by HARDWARE servo ID.
    static void writePosById(uint8_t servoId, int position, int speed, int acc) {
        ensureBus();
        if (busSeriesForId(servoId) == BUSSERVO_SERIES_SC) _sc.WritePos(servoId, position, 0, speed);
        else                                               _st.WritePosEx(servoId, position, speed, acc);
    }
    static void setTorqueId(uint8_t servoId, bool on) {
        ensureBus();
        if (busSeriesForId(servoId) == BUSSERVO_SERIES_SC) _sc.EnableTorque(servoId, on ? 1 : 0);
        else                                               _st.EnableTorque(servoId, on ? 1 : 0);
    }

    // Echo a sketch-issued write to the browser instance bound to this hardware
    // ID, so it sets its cached target exactly as if the browser had written it.
    static void echoTarget(uint8_t servoId, int position) {
        int lid = logicalForServoId(servoId);
        if (lid < 0) return;   // no browser instance is bound to this servo
        FrameBuilder fb;
        fb.begin(CMD_BUSSERVO_WRITE, DEVICE_BUSSERVO);
        fb.addInt(lid);
        fb.addInt(position);
        Pardalote.broadcastFrame(fb);
    }

    // -------------------------------------------------------------------
    // Main dispatch — TARGET == DEVICE_BUSSERVO.
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {

        // ---- global (busless) commands handled before id validation ----
        if (cmd == CMD_BUSSERVO_BUS_CONFIG) {
            if (nparams >= 1) _serialIndex = (int)paramInt(params, 0);
            if (nparams >= 2) _baud        = (uint32_t)paramInt(params, 1);
            if (nparams >= 3) _rxPin       = (int)paramInt(params, 2);
            if (nparams >= 4) _txPin       = (int)paramInt(params, 3);
            _busConfigured = false;   // force re-begin with the new settings
            ensureBus();
            return;
        }
        if (cmd == CMD_BUSSERVO_SCAN) {
            ensureBus();
            int first = (nparams >= 1) ? (int)paramInt(params, 0) : 1;
            int last  = (nparams >= 2) ? (int)paramInt(params, 1) : 20;
            scan(first, last);
            return;
        }
        if (cmd == CMD_BUSSERVO_SYNC_WRITE) {
            ensureBus();
            if (nparams < 1 || payloadLen < 6) return;
            int series = (int)paramInt(params, 0);
            const int REC = 6;                    // servoId(1) pos(2) speed(2) acc(1)
            int count = payloadLen / REC;
            static uint8_t  ids[MAX_BUS_SERVOS];
            static int16_t  positions[MAX_BUS_SERVOS];
            static uint16_t speeds[MAX_BUS_SERVOS];
            static uint8_t  accs[MAX_BUS_SERVOS];
            int n = 0;
            for (int i = 0; i < count && n < MAX_BUS_SERVOS; i++) {
                uint8_t* r   = payload + i * REC;
                ids[n]       = r[0];
                positions[n] = (int16_t)(((uint16_t)r[1] << 8) | r[2]);
                speeds[n]    = (uint16_t)(((uint16_t)r[3] << 8) | r[4]);
                accs[n]      = r[5];
                n++;
            }
            if (n == 0) return;
            if (series == BUSSERVO_SERIES_SC) {
                // SCSCL has no SyncWritePosEx — write individually (still one frame).
                for (int i = 0; i < n; i++) _sc.WritePos(ids[i], positions[i], 0, speeds[i]);
            } else {
                _st.SyncWritePosEx(ids, n, positions, speeds, accs);
            }
            for (int i = 0; i < n; i++) beginAwaitDone(logicalForServoId(ids[i]));
            return;
        }

        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("BusServo: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            case CMD_BUSSERVO_ATTACH: {
                if (nparams < 2) return;
                ensureBus();
                _servoId[id] = (uint8_t)paramInt(params, 1);
                _series[id]  = (nparams > 2) ? (uint8_t)paramInt(params, 2) : BUSSERVO_SERIES_ST;
                _attached[id] = true;

                // Sensible defaults: position mode, torque on.
                setMode(id, BUSSERVO_MODE_POSITION);
                setTorque(id, true);

                int found = isSC(id) ? _sc.Ping(_servoId[id]) : _st.Ping(_servoId[id]);
                Serial.print(F("BusServo ")); Serial.print(id);
                Serial.print(F(" → servo ID ")); Serial.print(_servoId[id]);
                Serial.print(isSC(id) ? F(" (SC) ") : F(" (ST) "));
                Serial.println(found != -1 ? F("[found]") : F("[NO RESPONSE — check wiring/ID/baud]"));
                break;
            }

            case CMD_BUSSERVO_DETACH:
                if (_attached[id]) {
                    setTorque(id, false);
                    _attached[id]  = false;
                    _awaitDone[id] = false;
                    Serial.print(F("BusServo ")); Serial.print(id); Serial.println(F(" detached"));
                }
                break;

            case CMD_BUSSERVO_WRITE: {
                if (!_attached[id] || nparams < 2) return;
                int pos   = (int)paramInt(params, 1);
                int speed = (nparams > 2) ? (int)paramInt(params, 2) : 2400;
                int acc   = (nparams > 3) ? (int)paramInt(params, 3) : 50;
                if (_limitSet[id]) pos = constrain(pos, _minPos[id], _maxPos[id]);
                writePos(id, pos, speed, acc);
                beginAwaitDone(id);            // poll for arrival → emit CMD_BUSSERVO_DONE
                break;
            }

            case CMD_BUSSERVO_WRITE_SPEED: {
                if (!_attached[id] || nparams < 2) return;
                int speed = (int)paramInt(params, 1);
                int acc   = (nparams > 2) ? (int)paramInt(params, 2) : 50;
                writeSpeed(id, speed, acc);
                _awaitDone[id] = false;        // wheel mode never "arrives"
                break;
            }

            case CMD_BUSSERVO_SET_MODE:
                if (!_attached[id] || nparams < 2) return;
                setMode(id, (uint8_t)paramInt(params, 1));
                break;

            case CMD_BUSSERVO_TORQUE:
                if (!_attached[id] || nparams < 2) return;
                setTorque(id, paramInt(params, 1) != 0);
                break;

            case CMD_BUSSERVO_READ:
                if (!_attached[id]) return;
                sendRead(id);
                break;

            case CMD_BUSSERVO_SET_LIMITS: {
                if (!_attached[id] || nparams < 3) return;
                _minPos[id]   = (int16_t)paramInt(params, 1);
                _maxPos[id]   = (int16_t)paramInt(params, 2);
                _limitSet[id] = true;
                // Also write the servo's own limit registers (EEPROM) so the
                // servo enforces them even without the browser in the loop.
                uint8_t sid = _servoId[id];
                bool wasOn = _torque[id];
                if (isSC(id)) {
                    _sc.unLockEprom(sid);
                    _sc.writeWord(sid, BUSSERVO_ADDR_MIN_LIMIT, _minPos[id]);
                    _sc.writeWord(sid, BUSSERVO_ADDR_MAX_LIMIT, _maxPos[id]);
                    _sc.LockEprom(sid);
                } else {
                    _st.unLockEprom(sid);
                    _st.writeWord(sid, BUSSERVO_ADDR_MIN_LIMIT, _minPos[id]);
                    _st.writeWord(sid, BUSSERVO_ADDR_MAX_LIMIT, _maxPos[id]);
                    _st.LockEprom(sid);
                }
                setTorque(id, wasOn);
                break;
            }

            case CMD_BUSSERVO_CALIBRATE: {
                if (!_attached[id]) return;
                // Declare the current physical position as centre. Feetech's
                // CalibrationOfs() writes the homing offset so present position
                // reads ~half-scale here (2048 for ST, 512 for SC) — mirrors
                // LeRobot's "centre on resolution/2" calibration.
                uint8_t sid = _servoId[id];
                if (isSC(id)) _sc.CalibrationOfs(sid);
                else          _st.CalibrationOfs(sid);
                Serial.print(F("BusServo ")); Serial.print(id); Serial.println(F(" centred"));
                break;
            }

            case CMD_BUSSERVO_SET_ID: {
                if (!_attached[id] || nparams < 2) return;
                uint8_t oldId = _servoId[id];
                uint8_t newId = (uint8_t)paramInt(params, 1);
                // ID lives in EEPROM: unlock → write → lock. Only safe with a
                // single servo on the bus (otherwise every servo takes the ID).
                if (isSC(id)) {
                    _sc.unLockEprom(oldId); _sc.writeByte(oldId, SCSCL_ID, newId); _sc.LockEprom(newId);
                } else {
                    _st.unLockEprom(oldId); _st.writeByte(oldId, SMS_STS_ID, newId); _st.LockEprom(newId);
                }
                _servoId[id] = newId;
                Serial.print(F("BusServo ")); Serial.print(id);
                Serial.print(F(" servo ID ")); Serial.print(oldId);
                Serial.print(F(" → ")); Serial.println(newId);
                break;
            }

            case CMD_BUSSERVO_PING: {
                if (nparams < 2) return;
                uint8_t sid = (uint8_t)paramInt(params, 1);
                bool sc = _attached[id] ? isSC(id) : false;
                int found = sc ? _sc.Ping(sid) : _st.Ping(sid);
                FrameBuilder fb;
                fb.begin(CMD_BUSSERVO_PING, DEVICE_BUSSERVO);
                fb.addInt(id); fb.addInt(sid); fb.addInt(found != -1 ? 1 : 0);
                Pardalote.broadcastFrame(fb);
                break;
            }

            default:
                Serial.print(F("BusServo: unknown cmd 0x")); Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Poll response — one FeedBack() bus transaction, then read the cached
    // present values (passing -1 reads from the latched feedback packet).
    // -------------------------------------------------------------------
    static void sendRead(int id) {
        uint8_t sid = _servoId[id];
        int pos = -1, speed = 0, load = 0, voltage = 0, temp = 0, current = 0;
        bool sc = isSC(id);
        int rc = sc ? _sc.FeedBack(sid) : _st.FeedBack(sid);
        if (rc != -1) {
            if (sc) {
                pos     = _sc.ReadPos(-1);
                speed   = _sc.ReadSpeed(-1);
                load    = _sc.ReadLoad(-1);
                voltage = _sc.ReadVoltage(-1);
                temp    = _sc.ReadTemper(-1);
            } else {
                pos     = _st.ReadPos(-1);
                speed   = _st.ReadSpeed(-1);
                load    = _st.ReadLoad(-1);
                voltage = _st.ReadVoltage(-1);
                temp    = _st.ReadTemper(-1);
                current = _st.ReadCurrent(-1);
            }
        }
        FrameBuilder fb;
        fb.begin(CMD_BUSSERVO_READ, DEVICE_BUSSERVO);
        fb.addInt(id);
        fb.addInt(pos);
        fb.addInt(speed);
        fb.addInt(load);
        fb.addInt(voltage);
        fb.addInt(temp);
        fb.addInt(current);
        Pardalote.broadcastFrame(fb);
    }

    // -------------------------------------------------------------------
    // Bus scan — ping a range of IDs and report which respond. Reports the
    // first up-to-15 found in a single frame [count, id1, ...].
    // -------------------------------------------------------------------
    static void scan(int first, int last) {
        FrameBuilder fb;
        fb.begin(CMD_BUSSERVO_SCAN, DEVICE_BUSSERVO);
        uint8_t found[15];
        int n = 0;
        for (int sid = first; sid <= last && n < 15; sid++) {
            // Try ST first, then SC — either responding means the ID is live.
            if (_st.Ping(sid) != -1 || _sc.Ping(sid) != -1) found[n++] = (uint8_t)sid;
        }
        fb.addInt(n);
        for (int i = 0; i < n; i++) fb.addInt(found[i]);
        Pardalote.broadcastFrame(fb);
        Serial.print(F("BusServo: scan found ")); Serial.print(n); Serial.println(F(" servo(s)"));
    }

    // -------------------------------------------------------------------
    // Loop hook — polls the Moving flag of any servo awaiting arrival (after
    // a position write) at ~30 Hz, and broadcasts CMD_BUSSERVO_DONE when it
    // settles (or after a timeout). Reading doesn't interrupt the servo's
    // motion — it's a status query, run concurrently with its control loop.
    // -------------------------------------------------------------------
    static void loop() {
        uint32_t now = millis();
        for (int id = 0; id < MAX_BUS_SERVOS; id++) {
            if (!_attached[id] || !_awaitDone[id]) continue;
            if (now - _awaitStartMs[id]   < MOVE_STARTUP_MS) continue;   // let it start moving
            if (now - _lastMovePollMs[id] < MOVE_POLL_MS)    continue;   // ~30 Hz
            _lastMovePollMs[id] = now;

            int mv = readMoving(_servoId[id]);            // 1=moving, 0=settled, -1=no answer
            if (mv == 0 || mv == 1) _lastRespMs[id] = now;   // a valid answer keeps a long move alive

            bool arrived = (mv == 0);
            bool lost    = (now - _lastRespMs[id]   > MOVE_NO_RESP_MS);   // servo stopped answering
            bool tooLong = (now - _awaitStartMs[id] > MOVE_MAX_MS);       // absolute ceiling
            if (!arrived && !lost && !tooLong) continue;

            _awaitDone[id] = false;
            int pos = readPos(_servoId[id]);
            FrameBuilder fb;
            fb.begin(CMD_BUSSERVO_DONE, DEVICE_BUSSERVO);
            fb.addInt(id);
            fb.addInt(pos);
            Pardalote.broadcastFrame(fb);
        }
    }

    // -------------------------------------------------------------------
    // Announce — tell a new client the bus config and replay each binding.
    // Present position is live on the servo, so it's read on demand, not
    // replayed here.
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_BUSSERVO);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_BUS_SERVOS);
        Pardalote.sendFrame(clientNum, fb);

        if (_busConfigured) {
            FrameBuilder fc;
            fc.begin(CMD_BUSSERVO_BUS_CONFIG, DEVICE_BUSSERVO);
            fc.addInt(_serialIndex); fc.addInt((int32_t)_baud);
            fc.addInt(_rxPin); fc.addInt(_txPin);
            Pardalote.sendFrame(clientNum, fc);
        }

        for (int i = 0; i < MAX_BUS_SERVOS; i++) {
            if (!_attached[i]) continue;

            FrameBuilder fa;
            fa.begin(CMD_BUSSERVO_ATTACH, DEVICE_BUSSERVO);
            fa.addInt(i); fa.addInt(_servoId[i]); fa.addInt(_series[i]);
            Pardalote.sendFrame(clientNum, fa);

            FrameBuilder fm;
            fm.begin(CMD_BUSSERVO_SET_MODE, DEVICE_BUSSERVO);
            fm.addInt(i); fm.addInt(_mode[i]);
            Pardalote.sendFrame(clientNum, fm);

            FrameBuilder ft;
            ft.begin(CMD_BUSSERVO_TORQUE, DEVICE_BUSSERVO);
            ft.addInt(i); ft.addInt(_torque[i] ? 1 : 0);
            Pardalote.sendFrame(clientNum, ft);

            if (_limitSet[i]) {
                FrameBuilder fl;
                fl.begin(CMD_BUSSERVO_SET_LIMITS, DEVICE_BUSSERVO);
                fl.addInt(i); fl.addInt(_minPos[i]); fl.addInt(_maxPos[i]);
                Pardalote.sendFrame(clientNum, fl);
            }
        }
    }
};

// -------------------------------------------------------------------
// PardaloteBusServo — sketch-facing bus object. Discover servos and read
// them by HARDWARE ID (the number scan() returns):
//   uint8_t ids[16];
//   int n = PardaloteBusServo.scan(ids, 16);          // who's on the bus?
//   int pos = PardaloteBusServo.read(ids[0]);         // position, −1 if no answer
//   PardaloteBusServoReading r = PardaloteBusServo.feedback(ids[0]);  // all in one read
// A scan is blocking (a ping timeout per silent ID) — call it in setup()
// or on demand, not in a tight loop.
// -------------------------------------------------------------------
class PardaloteBusServoAccess {
public:
    int scan(uint8_t* out, int max, int first = 1, int last = 30) const {
        return BusServoExt::scanBus(out, max, first, last);
    }
    int read(int id)     const { return BusServoExt::readPos((uint8_t)id); }     // position (counts)
    int position(int id) const { return BusServoExt::readPos((uint8_t)id); }     // alias
    PardaloteBusServoReading feedback(int id) const { return BusServoExt::readFeedback((uint8_t)id); }

    // Arrival check — one bus read of the servo's own Moving flag. Opt-in
    // (the servo can't notify you; you ask). Both false if it didn't answer.
    bool isMoving(int id) const { return BusServoExt::readMoving((uint8_t)id) == 1; }
    bool arrived(int id)  const { return BusServoExt::readMoving((uint8_t)id) == 0; }

    // Writes — direct bus commands by hardware servo ID. write() also echoes
    // the target to the browser so its record matches (like a browser write).
    void write(int id, int position, int speed = 2400, int acc = 50) const {
        BusServoExt::writePosById((uint8_t)id, position, speed, acc);
        BusServoExt::echoTarget((uint8_t)id, position);
        BusServoExt::beginAwaitDone(BusServoExt::logicalForServoId((uint8_t)id));
    }
    void torque(int id, bool on) const { BusServoExt::setTorqueId((uint8_t)id, on); }
};
inline PardaloteBusServoAccess PardaloteBusServo;

// Self-register — runs before setup().
INSTALL_EXTENSION(DEVICE_BUSSERVO, BusServoExt::handle, BusServoExt::announce,
                  nullptr, BusServoExt::loop)

#endif
