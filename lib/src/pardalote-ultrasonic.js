// ==============================================================
// ultrasonic.js
// Pardalote Ultrasonic Sensor Extension
// Part of Pardalote — version in package.json
// by Scott Mitchell
// GPL-3.0-or-later License
//
// Supports 3-wire and 4-wire sensors (HC-SR04, JSN-SR04T, etc.)
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('sonar', new Ultrasonic());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.sonar.attach(TRIG, ECHO);
//       arduino.sonar.read(100);            // poll every 100 ms
//       arduino.sonar.read(100, CM, 0.5);   // …reporting changes of 0.5+ cm
//   });
//
//   arduino.sonar.on('change', ({ distance, unit }) => {
//       console.log(distance, unit === CM ? 'cm' : 'in');
//   });
//
// The BOARD runs the poll: one measurement per interval
// regardless of how many browsers are connected, and each browser only
// receives readings that changed by at least its threshold (default
// 0.3 units — the HC-SR04's noise floor).
//
// Distance values travel as tenths of the requested unit on the wire;
// the extension converts to a decimal before emitting.
// A value of -1 means the echo timed out (nothing in range).
// ==============================================================

const DEVICE_ULTRASONIC = 202;

const CMD_ULTRASONIC_ATTACH      = 0x1E;
const CMD_ULTRASONIC_DETACH      = 0x1F;
const CMD_ULTRASONIC_READ        = 0x20;
const CMD_ULTRASONIC_SET_TIMEOUT = 0x21;

const CM   = 0;
const INCH = 1;

class Ultrasonic extends Extension {
    static deviceId = DEVICE_ULTRASONIC;

    constructor() {
        super();

        // Hardware state
        this.trigPin    = -1;
        this.echoPin    = -1;   // -1 = 3-wire (echo on trig pin)
        this.isAttached = false;
        this.timeoutMs  = 30;

        // Reading state
        this.distance   = -1;   // last reading in user units (decimal)
        this.unit       = CM;

        // Periodic read registration (board-side).
        // _readThreshold is in user units (decimal); 0 = board default
        // (0.3 units). Survives _reset() — it's user-tuned configuration.
        this._readInterval  = 0;
        this._readThreshold = 0;

        // Set true when Arduino announces this sensor's attach state on connect.
        // _reRegister() uses this to skip re-sending CMD_ULTRASONIC_ATTACH when
        // the Arduino is already in sync — only replay when it has reset.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Board switch — called by Arduino.connect() to wipe per-board state.
    // -------------------------------------------------------------------
    _reset() {
        this._readInterval       = 0;   // registration died with the old board — send nothing
        this.trigPin             = -1;
        this.echoPin             = -1;
        this.isAttached          = false;
        this.timeoutMs           = 30;
        this.distance            = -1;
        this.unit                = CM;
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Reconnection — restore attach state on HELLO
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached) {
            // Only replay attach if the Arduino didn't announce us (it reset).
            // If announce did sync us, skip — avoids duplicate Serial output
            // and redundant pin reconfiguration.
            if (!this._announcedByArduino) {
                this._sendAttach();
            }
            // Periodic read registrations are per-WS-client on the Arduino
            // (cleared on disconnect), so always re-register if active.
            if (this._readInterval > 0) this._sendRead();
        }
        this._announcedByArduino = false;  // reset for next reconnect cycle
    }

    // -------------------------------------------------------------------
    // attach(trigPin, echoPin?)
    // 4-wire: attach(trig, echo)
    // 3-wire: attach(trig)   — echo on same pin as trig
    // -------------------------------------------------------------------
    attach(trigPin, echoPin) {
        this.trigPin    = this.arduino._resolvePin(trigPin);
        this.echoPin    = (echoPin !== undefined) ? this.arduino._resolvePin(echoPin) : -1;
        this.isAttached = true;
        this._sendAttach();
        return this;
    }

    _sendAttach() {
        const params = (this.echoPin === -1)
            ? [this.logicalId, this.trigPin]
            : [this.logicalId, this.trigPin, this.echoPin];
        this.arduino.send(encodeFrame(CMD_ULTRASONIC_ATTACH, DEVICE_ULTRASONIC, params));
    }

    // -------------------------------------------------------------------
    // detach()
    // -------------------------------------------------------------------
    detach() {
        this._stopRead();
        this.arduino.send(encodeFrame(CMD_ULTRASONIC_DETACH, DEVICE_ULTRASONIC,
            [this.logicalId]));
        this.isAttached = false;
        this.trigPin    = -1;
        this.echoPin    = -1;
        return this;
    }

    // -------------------------------------------------------------------
    // read(interval?, unit?, threshold?)
    // read()                    — return cached distance; start default poll if none running.
    // read(interval)            — start/update a board-side periodic poll (ms).
    // read(interval, unit)      — periodic in CM (default) or INCH.
    // read(interval, CM, 0.5)   — only report changes of 0.5+ units.
    // read(END)                 — stop this browser's periodic read.
    // The board runs the poll and only transmits meaningful changes;
    // threshold is in the sensor's units (decimal; 0 = board default,
    // 0.3 units). Per-browser: other pages keep their own settings.
    // Calling again with the same settings just returns the cached value.
    // -------------------------------------------------------------------
    read(interval, unit = this.unit, threshold) {
        if (!this.isAttached) {
            this._warn('not attached');
            return this.distance;
        }

        if (interval === END) {
            this._stopRead();
            return this.distance;
        }

        // Poll already running with the requested settings — return cached
        if (this._readInterval > 0 && unit === this.unit
            && (interval  === undefined || interval  === this._readInterval)
            && (threshold === undefined || threshold === this._readThreshold)) {
            return this.distance;
        }

        this.unit = unit;
        this._readInterval  = interval ?? this.arduino.defaultInterval;
        if (threshold !== undefined) this._readThreshold = threshold;
        this._sendRead();
        return this.distance;
    }

    // setReadInterval(ms) / setReadThreshold(units) — set poll settings
    // directly; applied immediately if polling, stored for read() otherwise.
    setReadInterval(ms) {
        this._readInterval = ms;
        if (this.isAttached && ms > 0) this._sendRead();
        return this;
    }

    setReadThreshold(units) {
        this._readThreshold = units;
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        return this;
    }

    // Register (or update) this browser's poll with the board.
    // Wire threshold is in tenths of a unit; 0 = board default.
    _sendRead() {
        this.arduino.send(encodeFrame(CMD_ULTRASONIC_READ, DEVICE_ULTRASONIC,
            [this.logicalId, this.unit, this._readInterval,
             Math.max(0, Math.round(this._readThreshold * 10))]));
    }

    _stopRead() {
        if (this._readInterval > 0) {
            this.arduino.send(encodeFrame(CMD_ULTRASONIC_READ, DEVICE_ULTRASONIC,
                [this.logicalId, this.unit, END]));   // END = unregister
        }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // setTimeout(ms)
    // Sets the echo timeout on the Arduino (1–1000 ms).
    // Increase for longer range; decrease to speed up failed reads.
    // -------------------------------------------------------------------
    setTimeout(ms) {
        ms = Math.max(1, Math.min(1000, Math.round(ms)));
        this.timeoutMs = ms;
        this.arduino.send(encodeFrame(CMD_ULTRASONIC_SET_TIMEOUT, DEVICE_ULTRASONIC,
            [this.logicalId, ms]));
        return this;
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino.
    // CMD_ULTRASONIC_ATTACH and CMD_ULTRASONIC_SET_TIMEOUT arrive during
    // announce (state sync) — silent updates, no event emission.
    // CMD_ULTRASONIC_READ is a poll response — updates state and emits.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            case CMD_ULTRASONIC_ATTACH:
                // Sync attach state from Arduino announce. The flag tells
                // _reRegister() to skip its replay — Arduino already knows.
                this.trigPin             = frame.params[1];
                this.echoPin             = frame.params[2] ?? -1;
                this.isAttached          = true;
                this._announcedByArduino = true;
                break;

            case CMD_ULTRASONIC_SET_TIMEOUT:
                // Sync timeout from Arduino announce
                this.timeoutMs = frame.params[1];
                break;

            case CMD_ULTRASONIC_READ: {
                const raw = frame.params[1];   // tenths of unit, or -1
                this.distance = (raw === -1) ? -1 : raw / 10;
                this._emit('change', { distance: this.distance, unit: this.unit });
                break;
            }
        }
    }

    // -------------------------------------------------------------------
    // Callback shortcut — the board only transmits meaningful changes
    // (>= threshold), so the event is 'change'.
    // -------------------------------------------------------------------
    onChange(fn) { return this.on('change', fn); }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:  this.logicalId,
            trigPin:    this.trigPin,
            echoPin:    this.echoPin,
            attached:   this.isAttached,
            timeoutMs:  this.timeoutMs,
            distance:   this.distance,
            unit:       this.unit,
            interval:   this._readInterval,
            threshold:  this._readThreshold,
        };
    }
}

// Let the core materialise an Ultrasonic when the SKETCH creates one
// (PardaloteUltrasonic.attach("front", 7, 8) → CMD_SHARE → arduino.front).
registerExtensionType(Ultrasonic);
