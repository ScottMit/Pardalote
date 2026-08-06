// ==============================================================
// servo.js
// Pardalote Servo Extension
// Part of Pardalote — version in package.json
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
const CMD_SERVO_GESTURE            = 0x58;  // global: payload = servo channel blocks (segment schedules).
                                            // See pardalote.js CURVE_IDS / GESTURE_FLAG_* and defs.h.

// Board-side cap (PardaloteServo.h MAX_SERVO_SEGMENTS) — mirrored so the JS
// side can warn instead of silently overrunning. Extra segments are dropped.
const MAX_SERVO_SEGMENTS = 16;

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

        // Periodic read registration (board-side).
        // _readThreshold is in degrees; 0 = board default (1 degree).
        // Survives _reset() — it's user-tuned configuration.
        this._readInterval  = 0;
        this._readThreshold = 0;

        // Sweep cancellation
        this._sweepAbort = false;

        // Pending _whenDone() resolvers, drained on the 'done' event
        this._doneResolvers = [];

        // Pending attached() resolvers — entries { resolve, timer }.
        this._attachedResolvers = [];

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
        this._readInterval = 0;  // registration died with the old board — send nothing
        this._resolveDone();     // don't leave awaiters hanging on a board switch
        this._resolveAttached(false);
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
        // Periodic read registrations are per-WS-client on the Arduino
        // (cleared on disconnect), so always re-register if active.
        if (this.isAttached && this._readInterval > 0) this._sendRead();
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
            this._warn('not attached');
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
        if (!this.isAttached) { this._warn('not attached'); return this; }
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
    // gesture(segments, opts?) — play an authored SEGMENT SCHEDULE on-board.
    //
    // A gesture generalises writeTimed(): instead of one eased move it plays
    // an ordered list of eased segments back-to-back, on the board's own
    // clock (no WiFi streaming). Each segment is { dur, curve, and either
    // `by` (relative delta) or `to` (absolute angle) }:
    //
    //   pan.gesture([                       // a nod with follow-through
    //       { by:  25, dur: 250, curve: 'easeOut' },
    //       { by: -25, dur: 400, curve: 'easeInOut' },
    //       { by:   6, dur: 180, curve: 'back' },   // small overshoot settle
    //   ]);
    //   await pan.gesture([...]).whenDone();
    //
    // Reference frame (per gesture): relative by default — the portable
    // primitive, needing no absolute truth (`from` is captured on-board at
    // each segment). Use `to`, or opts.absolute, for absolute targets;
    // servos are absolute-capable so both are allowed. Fires 'done' (and
    // resolves whenDone()) when the last segment lands.
    // -------------------------------------------------------------------
    gesture(segments, opts = {}) {
        const blk = this._gestureBlock(segments, opts);
        if (!blk) return this;
        this.arduino.send(encodeFrame(CMD_SERVO_GESTURE, DEVICE_SERVO, [], blk.bytes));
        return this;
    }

    // Encode ONE gesture channel block — shared by gesture() (wrap + send) and
    // the group adapter _memberGestureEncode() (batched, no send). Arms
    // whenDone(), updates cached angle, emits 'gesture'. Returns { bytes, total }
    // or null when there's nothing to play.
    _gestureBlock(segments, opts = {}) {
        this._sweepAbort = true;
        if (!this.isAttached) { this._warn('not attached (gesture)'); return null; }
        if (!Array.isArray(segments) || segments.length === 0) {
            this._warn('gesture: needs a non-empty array of segments');
            return null;
        }

        const usesTo = segments.some(s => s.to !== undefined);
        const usesBy = segments.some(s => s.by !== undefined || s.value !== undefined);
        const absolute = (opts.absolute !== undefined) ? !!opts.absolute : usesTo;
        if (usesTo && usesBy)
            this._warn(`gesture: mixes 'to' (absolute) and 'by' (relative) — treating whole gesture as ${absolute ? 'absolute' : 'relative'}`);

        if (segments.length > MAX_SERVO_SEGMENTS)
            this._warn(`gesture: ${segments.length} segments exceeds board max ${MAX_SERVO_SEGMENTS} — extra segments dropped`);
        const count = Math.min(segments.length, MAX_SERVO_SEGMENTS);

        const flags = absolute ? GESTURE_FLAG_ABSOLUTE : 0;

        // Encode: [logicalId u8, flags u8, count u8] + count × {curve u8, dur u16, value i32}.
        const bytes = new Uint8Array(3 + count * 7);
        const dv    = new DataView(bytes.buffer);
        dv.setUint8(0, this.logicalId & 0xFF);
        dv.setUint8(1, flags & 0xFF);
        dv.setUint8(2, count & 0xFF);
        let total = 0, rest = this.angle;
        for (let i = 0; i < count; i++) {
            const s   = segments[i];
            const off = 3 + i * 7;
            const dur = Math.max(1, Math.round(s.dur ?? 0));
            // Wire value: absolute → clamped target; relative → raw delta (board clamps the result).
            const val = absolute ? this._clampAngle(Math.round(s.to ?? this.angle))
                                 : Math.round(s.by ?? s.value ?? 0);
            dv.setUint8(off, curveId(s.curve));
            dv.setUint16(off + 1, dur & 0xFFFF, false);
            dv.setInt32(off + 3, val, false);
            total += dur;
            // Predict the resting angle so cached state / memberValue track the gesture.
            rest = absolute ? this._clampAngle(Math.round(s.to ?? rest))
                            : this._clampAngle(rest + Math.round(s.by ?? s.value ?? 0));
        }

        this._armDone(total);
        this.angle          = rest;
        this.micros         = this._angleToMicros(rest);
        this._lastSentAngle = rest;
        this._emit('gesture', { segments: count, absolute, duration: total });
        return { bytes, total };
    }

    // Group adapter (group.gesture()). entries: [[member, segments], ...], all
    // Servos → one CMD_SERVO_GESTURE frame carrying every member's channel
    // block; the board plays them phase-locked on its own clock. Returns
    // frame(s) WITHOUT sending, so the group batches all types into one message.
    _memberGestureEncode(entries) {
        const blocks = [];
        for (const [m, segs] of entries) { const b = m._gestureBlock(segs); if (b) blocks.push(b.bytes); }
        if (!blocks.length) return [];
        const payload = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
        let off = 0;
        for (const b of blocks) { payload.set(b, off); off += b.length; }
        return [encodeFrame(CMD_SERVO_GESTURE, DEVICE_SERVO, [], payload)];
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
    // read(interval?, threshold?)
    // read()             — return cached angle; no network traffic.
    // read(interval)     — board-side periodic poll (ms); 'change' fires
    //                      when the angle moved by threshold+ degrees.
    // read(interval, 2)  — only report changes of 2+ degrees.
    // read(END)          — stop this browser's periodic read.
    // The board runs the poll and gates per browser ;
    // threshold 0 = board default (1 degree). Calling again with the same
    // settings just returns the cached value.
    // -------------------------------------------------------------------
    read(interval, threshold) {
        if (interval === END) {
            this._stopRead();
            return this.angle;
        }
        if (this._readInterval > 0
            && (interval  === undefined || interval  === this._readInterval)
            && (threshold === undefined || threshold === this._readThreshold)) {
            return this.angle;
        }
        this._readInterval = interval ?? this.arduino.defaultInterval;
        if (threshold !== undefined) this._readThreshold = threshold;
        this._sendRead();
        return this.angle;
    }

    // setReadInterval(ms) / setReadThreshold(degrees) — set poll settings
    // directly; applied immediately if polling, stored for read() otherwise.
    setReadInterval(ms) {
        this._readInterval = ms;
        if (this.isAttached && ms > 0) this._sendRead();
        return this;
    }

    setReadThreshold(degrees) {
        this._readThreshold = degrees;
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        return this;
    }

    // Register (or update) this browser's poll with the board.
    _sendRead() {
        this.arduino.send(encodeFrame(CMD_SERVO_READ, DEVICE_SERVO,
            [this.logicalId, this._readInterval,
             Math.max(0, Math.round(this._readThreshold))]));
    }

    _stopRead() {
        if (this._readInterval > 0) {
            this.arduino.send(encodeFrame(CMD_SERVO_READ, DEVICE_SERVO,
                [this.logicalId, END]));   // END = unregister
        }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // attached() — ask the BOARD whether this servo is attached; resolves
    // true/false (false on timeout — dead link or unresponsive board).
    // Query → promise, like busServo.ping(); for the cached mirror, read
    // servo.isAttached.
    //
    //   if (await arduino.pan.attached()) { beginSequence(); }
    // -------------------------------------------------------------------
    attached(timeout = 2000) {
        this.arduino.send(encodeFrame(
            CMD_SERVO_ATTACHED, DEVICE_SERVO,
            [this.logicalId]
        ));
        return new Promise(resolve => {
            const entry = { resolve, timer: setTimeout(() => {
                const i = this._attachedResolvers.indexOf(entry);
                if (i >= 0) this._attachedResolvers.splice(i, 1);
                resolve(false);
            }, timeout) };
            this._attachedResolvers.push(entry);
        });
    }

    // Drain pending attached() promises with the board's answer.
    _resolveAttached(value) {
        this._attachedResolvers.splice(0).forEach(({ resolve, timer }) => {
            clearTimeout(timer);
            resolve(value);
        });
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
            this._warn('not attached');
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
    onChange(fn)   { return this.on('change',   fn); }
    onDone(fn)     { return this.on('done',     fn); }

    // -------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------
    setWriteThrottle(ms) { this.writeThrottle = Math.max(0, ms); return this; }

    // Skip write() calls whose angle changes by less than `degrees` from the
    // last sent angle. Useful for animation loops that produce tiny deltas.
    // Set to 0 to disable. First write after attach is never filtered.
    setWriteThreshold(degrees) { this.writeThreshold = Math.max(0, degrees); return this; }

    // -------------------------------------------------------------------
    // Group member adapter — used by arduino.group(). Returns the frame(s)
    // to write `value` WITHOUT sending, so the group can batch every member
    // into one WebSocket message. Updates local state directly.
    // -------------------------------------------------------------------
    _memberWrite(angle) {
        if (!this.isAttached) { this._warn('not attached (group write)'); return []; }
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
                this._emit('change', { angle: this.angle });
                break;

            case CMD_SERVO_ATTACHED:
                this.isAttached = frame.params[1] === 1;
                this._resolveAttached(this.isAttached);
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
