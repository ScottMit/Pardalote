// ==============================================================
// servo.js
// Pardalote Servo Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Mirrors the Arduino Servo library API where possible.
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('servo', new Servo());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.servo.attach(D9);
//       arduino.servo.write(90);
//   });
// ==============================================================

const DEVICE_SERVO = 201;

const CMD_SERVO_ATTACH             = 0x14;
const CMD_SERVO_DETACH             = 0x15;
const CMD_SERVO_WRITE              = 0x16;
const CMD_SERVO_WRITE_MICROSECONDS = 0x17;
const CMD_SERVO_READ               = 0x18;
const CMD_SERVO_ATTACHED           = 0x19;

class Servo extends Extension {
    static deviceId = DEVICE_SERVO;

    constructor() {
        super();

        // Hardware state
        this.pin        = -1;
        this.isAttached = false;
        this.angle      = 90;
        this.micros     = 1500;
        this.minPulse   = 544;
        this.maxPulse   = 2400;

        // Write throttling
        this.writeThrottle  = 20;   // min ms between sends
        this.threshold      = 1;    // min degrees change to send
        this._lastWriteTime = 0;
        this._pendingWrite  = null;
        this._sentAngle     = null; // last angle THIS client actually sent (null = never sent)

        // Periodic read
        this._readTimer    = null;
        this._readInterval = 0;

        // Sweep cancellation
        this._sweepAbort = false;
    }

    // -------------------------------------------------------------------
    // Reconnection — called by Arduino core when HELLO is received.
    // Restores attach state and last known angle on the Arduino.
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached) {
            this._sendAttach();
            this.arduino.send(encodeFrame(CMD_SERVO_WRITE, DEVICE_SERVO,
                [this.logicalId, this.angle]));  // raw send — no event, no throttle update
        }
    }

    // -------------------------------------------------------------------
    // attach(pin, min?, max?)
    // Attach this servo to a pin. Optionally override pulse range.
    // -------------------------------------------------------------------
    attach(pin, min = 544, max = 2400) {
        this.pin      = this.arduino._resolvePin(pin);
        this.minPulse = min;
        this.maxPulse = max;
        this._sendAttach();
        this.isAttached = true;
        return this;
    }

    _sendAttach() {
        this.arduino.send(encodeFrame(
            CMD_SERVO_ATTACH, DEVICE_SERVO,
            [this.logicalId, this.pin, this.minPulse, this.maxPulse]
        ));
    }

    // -------------------------------------------------------------------
    // detach()
    // Release the servo pin.
    // -------------------------------------------------------------------
    detach() {
        this._stopRead();
        this.arduino.send(encodeFrame(
            CMD_SERVO_DETACH, DEVICE_SERVO,
            [this.logicalId]
        ));
        this.isAttached = false;
        this.pin        = -1;
        return this;
    }

    // -------------------------------------------------------------------
    // write(angle)
    // Move servo to angle (0–180°). Respects threshold and throttle.
    // Any call to write() cancels an in-progress sweep.
    // -------------------------------------------------------------------
    write(angle) {
        this._sweepAbort = true;
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId}: not attached`);
            return this;
        }

        angle = Math.max(0, Math.min(180, Math.round(angle)));
        if (this._sentAngle !== null && Math.abs(angle - this._sentAngle) < this.threshold) return this;

        const now = Date.now();
        const wait = this.writeThrottle - (now - this._lastWriteTime);

        if (wait > 0) {
            if (this._pendingWrite) clearTimeout(this._pendingWrite);
            this._pendingWrite = setTimeout(() => {
                this._sendAngle(angle);
                this._pendingWrite = null;
            }, wait);
        } else {
            this._sendAngle(angle);
        }
        return this;
    }

    _sendAngle(angle) {
        angle = Math.max(0, Math.min(180, Math.round(angle)));
        this.arduino.send(encodeFrame(
            CMD_SERVO_WRITE, DEVICE_SERVO,
            [this.logicalId, angle]
        ));
        this.angle          = angle;
        this._sentAngle     = angle;
        this.micros         = this._angleToMicros(angle);
        this._lastWriteTime = Date.now();
        this._emit('write', { angle });
    }

    // -------------------------------------------------------------------
    // writeMicroseconds(us)
    // Fine-grained control via pulse width (544–2400µs).
    // -------------------------------------------------------------------
    writeMicroseconds(us) {
        this._sweepAbort = true;
        if (!this.isAttached) return this;

        us = Math.max(this.minPulse, Math.min(this.maxPulse, Math.round(us)));
        const microThreshold = this.threshold * (this.maxPulse - this.minPulse) / 180;
        if (Math.abs(us - this.micros) < microThreshold) return this;

        this.arduino.send(encodeFrame(
            CMD_SERVO_WRITE_MICROSECONDS, DEVICE_SERVO,
            [this.logicalId, us]
        ));
        this.micros         = us;
        this.angle          = this._microsToAngle(us);
        this._sentAngle     = this.angle;
        this._emit('write', { angle: this.angle, micros: us });
        return this;
    }

    // -------------------------------------------------------------------
    // read(interval?)
    // Returns the locally cached angle immediately.
    // With no argument: one-shot — returns cached angle, no network traffic.
    // With an interval (ms): sets up a periodic poll of the Arduino;
    //   the 'read' event fires each time a response arrives.
    // read(END) or read(0): stops any active periodic poll.
    // -------------------------------------------------------------------
    // read(interval) — start/update periodic poll at interval (ms).
    // read()         — return cached angle; start default poll if none running.
    // read(END)      — stop any active periodic read.
    // Calling again with the same interval just returns the cached value.
    read(interval) {
        if (interval === END) {
            this._stopRead();
            return this.angle;
        }
        if (this._readTimer && (interval === undefined || interval === this._readInterval)) {
            return this.angle;
        }
        interval ??= this.arduino.defaultInterval;
        this._stopRead();
        this._readInterval = interval;
        this._sendReadRequest();
        this._readTimer = setInterval(() => this._sendReadRequest(), interval);
        return this.angle;
    }

    _sendReadRequest() {
        this.arduino.send(encodeFrame(CMD_SERVO_READ, DEVICE_SERVO, [this.logicalId]));
    }

    _stopRead() {
        if (this._readTimer) { clearInterval(this._readTimer); this._readTimer = null; }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // attached()
    // Returns cached attach state and requests confirmation from Arduino.
    // The 'attached' event fires when the response arrives.
    // -------------------------------------------------------------------
    attached() {
        this.arduino.send(encodeFrame(
            CMD_SERVO_ATTACHED, DEVICE_SERVO,
            [this.logicalId]
        ));
        return this.isAttached;
    }

    // -------------------------------------------------------------------
    // Convenience positions
    // -------------------------------------------------------------------
    center() { this._sweepAbort = true; return this.write(90); }
    min()    { this._sweepAbort = true; return this.write(0); }
    max()    { this._sweepAbort = true; return this.write(180); }

    // -------------------------------------------------------------------
    // sweep(startAngle, endAngle, duration, steps)
    // Smoothly move from startAngle to endAngle over duration ms.
    // Any call to write() / center() / min() / max() aborts the sweep.
    // -------------------------------------------------------------------
    async sweep(startAngle = 0, endAngle = 180, duration = 2000, steps = 50) {
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId}: not attached`);
            return;
        }

        this._sweepAbort = false;
        steps = Math.max(1, Math.round(steps));

        const stepDelay = duration / steps;
        const angleStep = (endAngle - startAngle) / steps;

        if (this._pendingWrite) {
            clearTimeout(this._pendingWrite);
            this._pendingWrite = null;
        }

        for (let i = 0; i <= steps; i++) {
            if (this._sweepAbort) break;
            this._sendAngle(Math.round(startAngle + angleStep * i));
            await new Promise(r => setTimeout(r, stepDelay));
        }
    }

    // -------------------------------------------------------------------
    // Callback shortcuts
    // -------------------------------------------------------------------
    onWrite(fn)    { return this.on('write',    fn); }
    onRead(fn)     { return this.on('read',     fn); }
    onAttached(fn) { return this.on('attached', fn); }

    // -------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------
    setThrottle(ms)       { this.writeThrottle = Math.max(0, ms);      return this; }
    setThreshold(degrees) { this.threshold = Math.max(0, degrees);     return this; }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:  this.logicalId,
            pin:        this.pin,
            attached:   this.isAttached,
            angle:      this.angle,
            sentAngle:  this._sentAngle,
            micros:     this.micros,
            minPulse:   this.minPulse,
            maxPulse:   this.maxPulse,
            threshold:  this.threshold,
            throttle:   this.writeThrottle
        };
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino.
    // CMD_SERVO_ATTACH and CMD_SERVO_WRITE arrive during announce (state
    // sync) — they update local state silently with no event emission.
    // CMD_SERVO_READ and CMD_SERVO_ATTACHED are poll responses — they
    // update state and emit events as normal.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            case CMD_SERVO_ATTACH:
                // Sync attach state from Arduino announce
                this.pin        = frame.params[1];
                this.minPulse   = frame.params[2] ?? 544;
                this.maxPulse   = frame.params[3] ?? 2400;
                this.isAttached = true;
                break;

            case CMD_SERVO_WRITE:
                // Sync last known angle from Arduino announce
                this.angle  = frame.params[1];
                this.micros = this._angleToMicros(this.angle);
                break;

            case CMD_SERVO_READ:
                this.angle  = frame.params[1];
                this.micros = this._angleToMicros(this.angle);
                this._emit('read', { angle: this.angle });
                break;

            case CMD_SERVO_ATTACHED:
                this.isAttached = frame.params[1] === 1;
                this._emit('attached', { attached: this.isAttached });
                break;
        }
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------
    _angleToMicros(angle) {
        return this.minPulse + (angle / 180) * (this.maxPulse - this.minPulse);
    }

    _microsToAngle(us) {
        return ((us - this.minPulse) / (this.maxPulse - this.minPulse)) * 180;
    }
}
