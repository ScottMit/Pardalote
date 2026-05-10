// ==============================================================
// ultrasonic.js
// Pardalote Ultrasonic Sensor Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
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
//       arduino.sonar.read(100);        // poll every 100 ms
//   });
//
//   arduino.sonar.on('read', ({ distance, unit }) => {
//       console.log(distance, unit === CM ? 'cm' : 'in');
//   });
//
// Distance values are returned in tenths of the requested unit
// internally; the extension converts to a decimal before emitting.
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

        // Periodic read timer (JS-side)
        this._readTimer    = null;
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // Reconnection — restore attach state on HELLO
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached) {
            this._sendAttach();
            // Restart periodic read if one was active
            if (this._readInterval > 0) {
                const interval = this._readInterval;
                this._readInterval = 0;   // force re-registration
                this.read(interval, this.unit);
            }
        }
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
    // read(interval?, unit?)
    // read()                 — return cached distance; start default poll if none running.
    // read(interval)         — start/update periodic poll at interval (ms).
    // read(interval, unit)   — periodic in CM (default) or INCH.
    // read(END)              — stop any active periodic read.
    // Calling again with the same interval just returns the cached value.
    // -------------------------------------------------------------------
    read(interval, unit = this.unit) {
        if (!this.isAttached) {
            console.warn(`Ultrasonic ${this.logicalId}: not attached`);
            return this.distance;
        }

        if (interval === END) {
            this._stopRead();
            return this.distance;
        }

        // Poll already running at the requested (or default) interval — return cached
        if (this._readTimer && (interval === undefined || interval === this._readInterval)) {
            return this.distance;
        }

        // Start or restart periodic poll
        this.unit = unit;
        interval ??= this.arduino.defaultInterval;
        this._stopRead();
        this._readInterval = interval;
        this._sendReadRequest();
        this._readTimer = setInterval(() => this._sendReadRequest(), interval);
        return this.distance;
    }

    _sendReadRequest() {
        this.arduino.send(encodeFrame(CMD_ULTRASONIC_READ, DEVICE_ULTRASONIC,
            [this.logicalId, this.unit]));
    }

    _stopRead() {
        if (this._readTimer) { clearInterval(this._readTimer); this._readTimer = null; }
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
                // Sync attach state from Arduino announce
                this.trigPin    = frame.params[1];
                this.echoPin    = frame.params[2] ?? -1;
                this.isAttached = true;
                break;

            case CMD_ULTRASONIC_SET_TIMEOUT:
                // Sync timeout from Arduino announce
                this.timeoutMs = frame.params[1];
                break;

            case CMD_ULTRASONIC_READ: {
                const raw = frame.params[1];   // tenths of unit, or -1
                this.distance = (raw === -1) ? -1 : raw / 10;
                this._emit('read', { distance: this.distance, unit: this.unit });
                break;
            }
        }
    }

    // -------------------------------------------------------------------
    // Callback shortcut
    // -------------------------------------------------------------------
    onRead(fn) { return this.on('read', fn); }

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
        };
    }
}
