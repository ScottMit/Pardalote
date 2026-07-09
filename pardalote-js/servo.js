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
//
// Servos created BY THE SKETCH (PardaloteServo.attach("pan", 9)) appear
// automatically as arduino.pan — a full Servo instance like any other.
// It exists by the time 'ready' fires; no arduino.add() needed.
// ==============================================================

const DEVICE_SERVO = 201;

const CMD_SERVO_ATTACH             = 0x14;
const CMD_SERVO_DETACH             = 0x15;
const CMD_SERVO_WRITE              = 0x16;
const CMD_SERVO_WRITE_MICROSECONDS = 0x17;
const CMD_SERVO_READ               = 0x18;
const CMD_SERVO_ATTACHED           = 0x19;
const CMD_SERVO_WRITE_TIMED        = 0x1A;
const CMD_SERVO_SYNC_TIMED         = 0x1B;
const CMD_SERVO_STOP               = 0x1C;
const CMD_SERVO_DONE               = 0x1D;
const CMD_SERVO_SET_LIMITS         = 0x54;  // [id, min, max, enabled] — board-clamped soft angle limits
                                            // (numbered after the stepper switch block; 0x14–0x1D was full)

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

        // Soft angle limits (safety) — enforced on the board; mirrored here
        // so cached state matches what the board actually applied.
        this.limitMin     = 0;
        this.limitMax     = 180;
        this.limitEnabled = false;

        // Home angle — where home() goes. Default: centre. JS-side only
        // (a PWM servo's angle is command-equals-state; nothing to re-zero).
        this.homeAngle = 90;

        // Write throttling
        this.writeThrottle  = 20;   // min ms between sends
        this._lastWriteTime = 0;
        this._pendingWrite  = null;

        // Write threshold — skip sends below this many degrees of change.
        // First send after attach always goes through (_lastSentAngle starts null)
        // so the servo physically moves to its initial position.
        this.writeThreshold = 1;
        this._lastSentAngle = null;

        // Periodic read
        this._readTimer    = null;
        this._readInterval = 0;

        // Sweep cancellation
        this._sweepAbort = false;

        // Pending _whenDone() resolvers, drained on the 'done' event
        this._doneResolvers = [];

        // Promise for the most recent move, consumed by whenDone(). Armed by
        // moves that will produce a 'done' (writeTimed, group timed moves);
        // cleared (null) by moves that won't (plain write). _moveDuration is
        // the last timed move's ms, used for whenDone's default timeout.
        this._movePromise  = null;
        this._moveDuration = 0;

        // Set to true when the Arduino announces this servo's attach state
        // on connect. _reRegister() uses this to skip re-sending CMD_SERVO_ATTACH
        // when the Arduino is already in sync — only replay when it has reset.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Board switch — called by Arduino.connect() to wipe per-board state
    // while preserving user-tuned configuration (throttle, threshold).
    // -------------------------------------------------------------------
    _reset() {
        if (this._pendingWrite) { clearTimeout(this._pendingWrite); this._pendingWrite = null; }
        this._stopRead();
        this._resolveDone();     // don't leave awaiters hanging on a board switch
        this._movePromise        = null;
        this._moveDuration       = 0;
        this._sweepAbort         = true;
        this.pin                 = -1;
        this.isAttached          = false;
        this.angle               = 90;
        this.micros              = 1500;
        this.minPulse            = 544;
        this.maxPulse            = 2400;
        this._lastSentAngle      = null;
        this._lastWriteTime      = 0;
        this.limitMin            = 0;
        this.limitMax            = 180;
        this.limitEnabled        = false;
        this.homeAngle           = 90;
        this._announcedByArduino = false;
    }

    // Clamp an angle to 0–180 and, if set, the soft limits — mirrors the
    // board's clampAngle() so cached state never disagrees with hardware.
    _clampAngle(angle) {
        angle = Math.max(0, Math.min(180, Math.round(angle)));
        if (this.limitEnabled) angle = Math.max(this.limitMin, Math.min(this.limitMax, angle));
        return angle;
    }

    // -------------------------------------------------------------------
    // Reconnection — called by Arduino core after CMD_SYNC_COMPLETE.
    //
    // Two cases:
    //   Arduino reset  (_announcedByArduino = false):
    //     Arduino has no record of this servo. Replay attach + last angle.
    //   Arduino running (_announcedByArduino = true):
    //     announce() already synced our state from the Arduino — skip the
    //     replay (avoids the duplicate detach/attach cycle and Serial noise).
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached && !this._announcedByArduino) {
            this._sendAttach();
            if (this.limitEnabled) {
                this.arduino.send(encodeFrame(CMD_SERVO_SET_LIMITS, DEVICE_SERVO,
                    [this.logicalId, this.limitMin, this.limitMax, 1]));
            }
            this.arduino.send(encodeFrame(CMD_SERVO_WRITE, DEVICE_SERVO,
                [this.logicalId, this.angle]));  // raw send — no event, no throttle update
        }
        // Reset for next disconnect/reconnect cycle.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // attach(pin, min?, max?)
    // Attach this servo to a pin. Optionally override pulse range.
    // -------------------------------------------------------------------
    attach(pin, min = 544, max = 2400) {
        this.pin      = this.arduino._resolvePin(pin);
        this.minPulse = min;
        this.maxPulse = max;
        this._lastSentAngle = null;   // first write after (re-)attach always sends
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
        this.isAttached     = false;
        this.pin            = -1;
        this._lastSentAngle = null;
        return this;
    }

    // -------------------------------------------------------------------
    // write(angle)
    // Move servo to angle (0–180°). Respects throttle.
    // Any call to write() cancels an in-progress sweep.
    // -------------------------------------------------------------------
    write(angle) {
        this._sweepAbort   = true;
        this._movePromise  = null;   // instant move — nothing to await
        this._moveDuration = 0;
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId}: not attached`);
            return this;
        }

        angle = this._clampAngle(angle);

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
        angle = this._clampAngle(angle);
        if (this._lastSentAngle !== null &&
            Math.abs(angle - this._lastSentAngle) < this.writeThreshold) {
            return;
        }
        this.arduino.send(encodeFrame(
            CMD_SERVO_WRITE, DEVICE_SERVO,
            [this.logicalId, angle]
        ));
        this.angle          = angle;
        this.micros         = this._angleToMicros(angle);
        this._lastWriteTime = Date.now();
        this._lastSentAngle = angle;
        this._emit('write', { angle });
    }

    // -------------------------------------------------------------------
    // writeMicroseconds(us)
    // Fine-grained control via pulse width (544–2400µs).
    // -------------------------------------------------------------------
    writeMicroseconds(us) {
        this._sweepAbort   = true;
        this._movePromise  = null;   // instant move — nothing to await
        this._moveDuration = 0;
        if (!this.isAttached) return this;

        us = Math.max(this.minPulse, Math.min(this.maxPulse, Math.round(us)));
        if (this.limitEnabled) {
            // Translate the angle limits into the pulse domain (mirrors the board).
            const span = this.maxPulse - this.minPulse;
            const usMin = this.minPulse + this.limitMin / 180 * span;
            const usMax = this.minPulse + this.limitMax / 180 * span;
            us = Math.round(Math.max(usMin, Math.min(usMax, us)));
        }

        this.arduino.send(encodeFrame(
            CMD_SERVO_WRITE_MICROSECONDS, DEVICE_SERVO,
            [this.logicalId, us]
        ));
        this.micros = us;
        this.angle  = this._microsToAngle(us);
        this._emit('write', { angle: this.angle, micros: us });
        return this;
    }

    // -------------------------------------------------------------------
    // writeTimed(angle, duration)
    // Move to `angle` over `duration` ms — the Arduino interpolates on-board
    // (smooth, no WiFi streaming). Fires 'done' when it arrives.
    // -------------------------------------------------------------------
    writeTimed(angle, duration = 1000) {
        this._sweepAbort = true;
        if (!this.isAttached) { console.warn(`Servo ${this.logicalId}: not attached`); return this; }
        angle = this._clampAngle(angle);
        this._armDone(duration);
        this.arduino.send(encodeFrame(CMD_SERVO_WRITE_TIMED, DEVICE_SERVO,
            [this.logicalId, angle, Math.max(0, Math.round(duration))]));
        this.angle          = angle;
        this.micros         = this._angleToMicros(angle);
        this._lastSentAngle = angle;
        this._emit('write', { angle });
        return this;
    }

    // -------------------------------------------------------------------
    // Soft angle limits (safety) — same shape as stepper.setLimits().
    // Enforced ON THE BOARD (browser and sketch writes alike) and mirrored
    // here, so an LLM or a buggy sketch can't push a joint past the range.
    // -------------------------------------------------------------------
    setLimits(min, max) {
        min = Math.max(0, Math.min(180, Math.round(min)));
        max = Math.max(0, Math.min(180, Math.round(max)));
        this.limitMin     = Math.min(min, max);
        this.limitMax     = Math.max(min, max);
        this.limitEnabled = true;
        if (this.isAttached) {
            this.arduino.send(encodeFrame(CMD_SERVO_SET_LIMITS, DEVICE_SERVO,
                [this.logicalId, this.limitMin, this.limitMax, 1]));
        }
        return this;
    }

    clearLimits() {
        this.limitEnabled = false;
        if (this.isAttached) {
            this.arduino.send(encodeFrame(CMD_SERVO_SET_LIMITS, DEVICE_SERVO,
                [this.logicalId, this.limitMin, this.limitMax, 0]));
        }
        return this;
    }

    // -------------------------------------------------------------------
    // Home — setHome() declares the home angle (no-arg: "here is home");
    // home() goes there, home(duration) goes there smoothly. Same pair as
    // the stepper and bus servo.
    //   arduino.pan.setHome(45);
    //   await arduino.pan.home(1000).whenDone();
    // -------------------------------------------------------------------
    setHome(angle) {
        this.homeAngle = Math.max(0, Math.min(180,
            Math.round(angle === undefined ? this.angle : angle)));
        return this;
    }

    home(duration) {
        return (duration > 0) ? this.writeTimed(this.homeAngle, duration)
                              : this.write(this.homeAngle);
    }

    // stop() — cancel an in-progress timed move, hold the current angle.
    // The board just halts interpolation (no 'done' frame), so settle any
    // whenDone() awaiter locally.
    stop() {
        this._sweepAbort = true;
        if (this.isAttached) this.arduino.send(encodeFrame(CMD_SERVO_STOP, DEVICE_SERVO, [this.logicalId]));
        this._resolveDone();
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
    onDone(fn) { return this.on('done', fn); }

    // -------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------
    setThrottle(ms) { this.writeThrottle = Math.max(0, ms); return this; }

    // Skip write() calls whose angle changes by less than `degrees` from the
    // last sent angle. Useful for animation loops that produce tiny deltas.
    // Set to 0 to disable. First write after attach is never filtered.
    setThreshold(degrees) { this.writeThreshold = Math.max(0, degrees); return this; }

    // -------------------------------------------------------------------
    // Group member adapter — used by arduino.group(). Returns the frame(s)
    // to write `value` WITHOUT sending, so the group can batch every member
    // into one WebSocket message. Updates local state directly.
    // -------------------------------------------------------------------
    _memberWrite(angle) {
        if (!this.isAttached) { console.warn(`Servo ${this.logicalId}: not attached (group write)`); return []; }
        this._sweepAbort    = true;
        this._movePromise   = null;   // instant move — nothing to await
        this._moveDuration  = 0;
        angle               = this._clampAngle(angle);
        this.angle          = angle;
        this.micros         = this._angleToMicros(angle);
        this._lastSentAngle = angle;
        this._emit('write', { angle });
        return [encodeFrame(CMD_SERVO_WRITE, DEVICE_SERVO, [this.logicalId, angle])];
    }

    get memberValue() { return this.angle; }

    // -------------------------------------------------------------------
    // Group timed-move hook (used by group.writeTimed()). PWM servos have no
    // speed input, so arrive-together is done by on-board interpolation:
    // all servos in the bucket share one CMD_SERVO_SYNC_TIMED with the same
    // duration and interpolate from their own current angle → they finish
    // together. entries: [[member, targetAngle, current], ...] of one series.
    // -------------------------------------------------------------------
    _memberSyncKey() { return this.isAttached ? 'servo' : null; }

    _memberMoveEncode(entries, durationMs) {
        const bytes = new Uint8Array(entries.length * 2);
        entries.forEach(([m, target], i) => {
            const angle = m._clampAngle(target);
            bytes[i * 2]     = m.logicalId & 0xFF;
            bytes[i * 2 + 1] = angle & 0xFF;
            m.angle          = angle;         // update commanded state
            m.micros         = m._angleToMicros(angle);
            m._lastSentAngle = angle;
            m._sweepAbort    = true;
            m._armDone(durationMs);
            m._emit('write', { angle });
        });
        return [encodeFrame(CMD_SERVO_SYNC_TIMED, DEVICE_SERVO,
            [Math.max(0, Math.round(durationMs))], bytes)];
    }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:  this.logicalId,
            pin:        this.pin,
            attached:   this.isAttached,
            angle:      this.angle,
            micros:     this.micros,
            minPulse:   this.minPulse,
            maxPulse:   this.maxPulse,
            limits:     this.limitEnabled ? { min: this.limitMin, max: this.limitMax } : null,
            home:       this.homeAngle,
            throttle:   this.writeThrottle,
            threshold:  this.writeThreshold,
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
                // Sync attach state from Arduino announce. The flag tells
                // _reRegister() to skip its replay — Arduino already knows.
                this.pin                 = frame.params[1];
                this.minPulse            = frame.params[2] ?? 544;
                this.maxPulse            = frame.params[3] ?? 2400;
                this.isAttached          = true;
                this._announcedByArduino = true;
                break;

            case CMD_SERVO_WRITE:
                // Sync last known angle from Arduino announce
                this.angle  = frame.params[1];
                this.micros = this._angleToMicros(this.angle);
                break;

            case CMD_SERVO_SET_LIMITS:
                // Sync soft-limit state from Arduino announce — silent.
                this.limitMin     = frame.params[1];
                this.limitMax     = frame.params[2];
                this.limitEnabled = frame.params[3] === 1;
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

            case CMD_SERVO_DONE:
                this.angle  = frame.params[1];
                this.micros = this._angleToMicros(this.angle);
                this._emit('done', { angle: this.angle });
                this._resolveDone();
                break;
        }
    }

    // Resolves when the servo's timed move completes (CMD_SERVO_DONE).
    _whenDone() { return new Promise(resolve => this._doneResolvers.push(resolve)); }
    _resolveDone() {
        const resolvers = this._doneResolvers;
        this._doneResolvers = [];
        resolvers.forEach(r => r(this.angle));
    }

    // Arm the whenDone() promise for a move that will emit 'done'.
    _armDone(durationMs = 0) {
        this._moveDuration = Math.max(0, durationMs);
        this._movePromise  = this._whenDone();
    }

    // whenDone({ timeout }?) — Promise for the most recent move. Resolves
    // `true` on the servo's 'done' (or immediately if no move is pending /
    // it already finished), `false` on the safety timeout. timeout: ms
    // (default max(duration × 2, 10000); 0 = wait forever). Also accepts a
    // bare number: whenDone(5000).
    //
    //   await servo.writeTimed(90, 1000).whenDone();
    whenDone(opts = {}) {
        const t = (typeof opts === 'number') ? opts : opts.timeout;
        const timeout = t ?? Math.max(this._moveDuration * 2, 10000);
        if (!this._movePromise) return Promise.resolve(true);
        const done = this._movePromise.then(() => true);
        if (!timeout) return done;
        return Promise.race([
            done,
            new Promise(res => setTimeout(() => res(false), timeout)),
        ]);
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

// Let the core materialise a Servo when the SKETCH creates one
// (PardaloteServo.attach("pan", 9) → CMD_SHARE → arduino.pan).
registerExtensionType(Servo);
