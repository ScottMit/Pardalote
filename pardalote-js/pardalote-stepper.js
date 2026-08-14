// ==============================================================
// stepper.js
// Pardalote Stepper Motor Extension
// Part of Pardalote — version in package.json
// by Scott Mitchell
// GPL-3.0-or-later License
//
// Mirrors the AccelStepper API (non-blocking motion). Targets and motion
// profiles are sent to the Arduino, which generates the step pulses on
// board — you never stream individual steps over WiFi.
//
// Works with STEP/DIR drivers (TMC2208/2209, A4988, EasyDriver) and
// 4-wire coil drivers (28BYJ-48 via ULN2003, bipolar via H-bridge).
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('x', new Stepper());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.x.attach(STEP, DIR, EN);   // DRIVER mode (EN optional)
//       arduino.x.setMaxSpeed(1000);       // steps/sec
//       arduino.x.setAcceleration(500);    // steps/sec^2
//       arduino.x.moveTo(2000);            // absolute target
//   });
//
//   arduino.x.on('done', ({ position }) => console.log('arrived at', position));
// ==============================================================

const DEVICE_STEPPER = 205;

const CMD_STEPPER_ATTACH        = 0x33;
const CMD_STEPPER_DETACH        = 0x34;
const CMD_STEPPER_MOVE_TO       = 0x35;
const CMD_STEPPER_MOVE          = 0x36;
const CMD_STEPPER_SET_MAX_SPEED = 0x37;
const CMD_STEPPER_SET_ACCEL     = 0x38;
const CMD_STEPPER_RUN_SPEED     = 0x39;
const CMD_STEPPER_STOP          = 0x3A;
const CMD_STEPPER_SET_POSITION  = 0x3B;
const CMD_STEPPER_ENABLE        = 0x3C;
const CMD_STEPPER_SET_LIMITS    = 0x3D;
const CMD_STEPPER_READ          = 0x3E;
const CMD_STEPPER_DONE          = 0x3F;
const CMD_STEPPER_MOVE_TIMED    = 0x4F;
const CMD_STEPPER_SYNC_MOVE     = 0x50;
const CMD_STEPPER_HOME          = 0x40;  // [id, speed?] — board homing routine (seek switch → back off → travel home)
const CMD_STEPPER_SET_SWITCH    = 0x52;  // [id, which, pin, trigger] — config (0x51 = busservo DONE)
const CMD_STEPPER_LIMIT         = 0x53;  // Ar→JS: [id, which, position] — switch tripped, board hard-stopped
const CMD_STEPPER_SET_SWITCH_POS = 0x54; // [id, which, coord] — coordinate a switch sits at (independent of limits)
const CMD_STEPPER_SET_HOME      = 0x55;  // [id, value?] — re-zero the frame; board echoes shifted pos/limits/switchPos
const CMD_STEPPER_HARD_STOP     = 0x57;  // [id] — instant halt, no decel ramp (0x56 = CMD_SHARE)
const CMD_STEPPER_GESTURE       = 0x59;  // global: payload = stepper channel blocks (segment schedules).
                                         // See pardalote.js CURVE_IDS / GESTURE_FLAG_* and defs.h.

// Board-side cap (PardaloteStepper.h MAX_STEPPER_SEGMENTS) — mirrored so JS
// can warn instead of silently overrunning. Extra segments are dropped.
const MAX_STEPPER_SEGMENTS = 16;

// Interface types — match AccelStepper (and PardaloteStepper.h).
const STEPPER_DRIVER    = 1;   // STEP/DIR
const STEPPER_FULL4WIRE = 4;   // 4 coil pins

class Stepper extends Extension {
    static deviceId = DEVICE_STEPPER;

    constructor() {
        super();

        // Hardware / attach state
        this.interface  = STEPPER_DRIVER;
        this.pins       = [-1, -1, -1, -1];
        this.enPin      = -1;
        this.invertMask = 0x04;          // enable active-LOW by default
        this.isAttached = false;

        // Motion profile
        this.maxSpeed     = 1000;        // steps/sec
        this.acceleration = 500;         // steps/sec^2
        this.stepsPerRev  = 200;         // for degree/revolution helpers

        // Commanded destination (set by moveTo/move; refined from read polls)
        this.target       = 0;

        // Live state (updated by read polls and DONE)
        this.position     = 0;
        this.distanceToGo = 0;
        this.speed        = 0;
        this.isRunning    = false;

        // Hardware limit switches — none/one/two, enforced ON THE BOARD
        // (direction-aware instant stop; the browser just gets told).
        // Entries are null or { pin, trigger }.
        this.switches = { min: null, max: null };
        this.limitHit = null;   // 'min' | 'max' after a trip; cleared by the next move

        // Coordinate each switch physically sits at (steps), independent of the
        // soft limits. Default 0 = the switch is the origin. Homing adopts this
        // value when the switch trips. Board-replayed.
        this.switchPos = { min: 0, max: 0 };

        // Home is always the origin (0) — where home() ends up. setHome()
        // re-zeros the frame so the current spot becomes 0.
        this.homePosition = 0;

        // Soft limits (safety) — enforced on the board.
        this.limitMin     = 0;
        this.limitMax     = 0;
        this.limitEnabled = false;

        // Periodic read registration (board-side).
        // _readThreshold is in steps; 0 = board default (1 step).
        // Survives _reset() — it's user-tuned configuration.
        this._readInterval  = 0;
        this._readThreshold = 0;

        // Pending _whenDone() resolvers, drained on 'done'.
        this._doneResolvers = [];

        // Promise for the most recent move, consumed by whenDone(). Armed by
        // every position move (they all emit 'done' on arrival); cleared by
        // runSpeed (never "arrives"). _moveDuration feeds the default timeout.
        this._movePromise  = null;
        this._moveDuration = 0;

        // Set true when the Arduino announces this stepper's state on connect.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Board switch — wipe per-board state, keep user-tuned config.
    // -------------------------------------------------------------------
    _reset() {
        this._readInterval = 0;  // registration died with the old board — send nothing
        this._resolveDone();             // don't leave awaiters hanging
        this._movePromise  = null;
        this._moveDuration = 0;
        this.interface   = STEPPER_DRIVER;
        this.pins        = [-1, -1, -1, -1];
        this.enPin       = -1;
        this.invertMask  = 0x04;
        this.isAttached  = false;
        this.target       = 0;
        this.position     = 0;
        this.distanceToGo = 0;
        this.speed        = 0;
        this.isRunning    = false;
        this.limitEnabled = false;
        this.switches     = { min: null, max: null };
        this.limitHit     = null;
        this.switchPos    = { min: 0, max: 0 };
        this.homePosition = 0;
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Reconnection — replay state only if the Arduino reset (didn't announce).
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached && !this._announcedByArduino) {
            this._sendAttach();
            this._raw(CMD_STEPPER_SET_MAX_SPEED, [this.logicalId, this.maxSpeed]);
            this._raw(CMD_STEPPER_SET_ACCEL,     [this.logicalId, this.acceleration]);
            if (this.limitEnabled) {
                this._raw(CMD_STEPPER_SET_LIMITS,
                    [this.logicalId, this.limitMin, this.limitMax, 1]);
            }
            for (const key of ['min', 'max']) {
                const sw = this.switches[key];
                if (sw) this._raw(CMD_STEPPER_SET_SWITCH,
                    [this.logicalId, key === 'max' ? 1 : 0, sw.pin, sw.trigger]);
            }
            // Switch coordinates — absolute (NOT a SET_HOME re-zero, which would
            // shift them again). Home is always the origin, so nothing to replay.
            for (const key of ['min', 'max']) {
                if (this.switchPos[key] !== 0)
                    this._raw(CMD_STEPPER_SET_SWITCH_POS,
                        [this.logicalId, key === 'max' ? 1 : 0, this.switchPos[key]]);
            }
            this._raw(CMD_STEPPER_SET_POSITION, [this.logicalId, this.position]);
        }
        // Periodic read registrations are per-WS-client on the Arduino
        // (cleared on disconnect), so always re-register if active.
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // attach(stepPin, dirPin, enPin?, options?)   — STEP/DIR drivers
    // options: { invertDir, invertStep, invertEnable }  (invertEnable defaults true)
    // -------------------------------------------------------------------
    attach(stepPin, dirPin, enPin = -1, options = {}) {
        const { invertDir = false, invertStep = false, invertEnable = true } = options;
        this.interface  = STEPPER_DRIVER;
        this.pins       = [this.arduino._resolvePin(stepPin),
                           this.arduino._resolvePin(dirPin), -1, -1];
        this.enPin      = (enPin === -1) ? -1 : this.arduino._resolvePin(enPin);
        this.invertMask = (invertDir ? 0x01 : 0) |
                          (invertStep ? 0x02 : 0) |
                          (invertEnable ? 0x04 : 0);
        this.isAttached = true;
        this._sendAttach();
        return this;
    }

    // -------------------------------------------------------------------
    // attach4wire(p1, p2, p3, p4)   — 28BYJ-48 / bipolar via H-bridge
    // -------------------------------------------------------------------
    attach4wire(p1, p2, p3, p4) {
        this.interface  = STEPPER_FULL4WIRE;
        this.pins       = [this.arduino._resolvePin(p1), this.arduino._resolvePin(p2),
                           this.arduino._resolvePin(p3), this.arduino._resolvePin(p4)];
        this.enPin      = -1;
        this.isAttached = true;
        this._sendAttach();
        return this;
    }

    _sendAttach() {
        const params = (this.interface === STEPPER_FULL4WIRE)
            ? [this.logicalId, this.interface, ...this.pins]
            : [this.logicalId, this.interface, this.pins[0], this.pins[1],
               this.enPin, this.invertMask];
        this.arduino.send(encodeFrame(CMD_STEPPER_ATTACH, DEVICE_STEPPER, params));
        // Push the current profile so the board matches our cached config.
        this._raw(CMD_STEPPER_SET_MAX_SPEED, [this.logicalId, this.maxSpeed]);
        this._raw(CMD_STEPPER_SET_ACCEL,     [this.logicalId, this.acceleration]);
    }

    detach() {
        this._stopRead();
        this.arduino.send(encodeFrame(CMD_STEPPER_DETACH, DEVICE_STEPPER, [this.logicalId]));
        this.isAttached = false;
        return this;
    }

    // -------------------------------------------------------------------
    // Motion profile
    // -------------------------------------------------------------------
    setMaxSpeed(speed) {
        this.maxSpeed = Math.max(0, speed);
        if (this.isAttached) this._raw(CMD_STEPPER_SET_MAX_SPEED, [this.logicalId, this.maxSpeed]);
        return this;
    }

    setAcceleration(accel) {
        this.acceleration = Math.max(0, accel);
        if (this.isAttached) this._raw(CMD_STEPPER_SET_ACCEL, [this.logicalId, this.acceleration]);
        return this;
    }

    // -------------------------------------------------------------------
    // Position moves (accel-limited). Chainable.
    // -------------------------------------------------------------------
    moveTo(absolute) {
        if (!this._requireAttached('moveTo')) return this;
        this._armDone();
        this.target = Math.round(absolute);
        this.arduino.send(encodeFrame(CMD_STEPPER_MOVE_TO, DEVICE_STEPPER,
            [this.logicalId, this.target]));
        this._emit('move', { target: this.target });
        return this;
    }

    move(relative) {
        if (!this._requireAttached('move')) return this;
        this._armDone();
        const rel = Math.round(relative);
        this.target = this.position + rel;   // estimate; refined by the next read poll
        this.arduino.send(encodeFrame(CMD_STEPPER_MOVE, DEVICE_STEPPER,
            [this.logicalId, rel]));
        this._emit('move', { target: this.target });
        return this;
    }

    // moveToTimed(target, duration) — constant-speed move sized to arrive in
    // ~duration ms. The board computes the speed from its own position. Used
    // by group.writeTimed() for arrive-together; fires 'done' on completion.
    moveToTimed(absolute, duration = 1000) {
        if (!this._requireAttached('moveToTimed')) return this;
        this._armDone(duration);
        this.target = Math.round(absolute);
        this.arduino.send(encodeFrame(CMD_STEPPER_MOVE_TIMED, DEVICE_STEPPER,
            [this.logicalId, this.target, Math.max(0, Math.round(duration))]));
        this._emit('move', { target: this.target });
        return this;
    }

    // -------------------------------------------------------------------
    // gesture(segments, opts?) — play an authored SEGMENT SCHEDULE on-board.
    //
    // The stepper counterpart of servo.gesture(): an ordered list of eased
    // segments the board plays back-to-back on its own clock (MODE_EASED —
    // each tick follows the segment's eased position at a curve-derived
    // speed). Values are in STEPS. Each segment is { dur, curve, and either
    // `by` (relative step delta) or `to` (absolute position) }:
    //
    //   lift.gesture([                       // a lead-screw bounce, no homing
    //       { by:  800, dur: 350, curve: 'easeOut'   },
    //       { by: -800, dur: 550, curve: 'easeInOut' },
    //       { by:  120, dur: 200, curve: 'back'      },  // small overshoot settle
    //   ]);
    //   await lift.gesture([...]).whenDone();
    //
    // Relative by default — the portable primitive, honest on an open-loop
    // stepper (the board captures `from` from its live position at each
    // segment, so nothing accumulates and no absolute truth is needed). Use
    // `to`/opts.absolute for absolute targets (soft limits clamp the ends).
    // An eased move's velocity peaks above its average, so the board briefly
    // raises the speed cap to hit the authored duration, then restores it.
    // Fires 'done' (resolves whenDone()) when the last segment lands.
    // -------------------------------------------------------------------
    gesture(segments, opts = {}) {
        const blk = this._gestureBlock(segments, opts);
        if (!blk) return this;
        this.arduino.send(encodeFrame(CMD_STEPPER_GESTURE, DEVICE_STEPPER, [], blk.bytes));
        return this;
    }

    // Encode ONE gesture channel block — shared by gesture() (wrap + send) and
    // the group adapter _memberGestureEncode() (batched, no send). Arms
    // whenDone(), mirrors the commanded target, emits 'move'. Returns
    // { bytes, total } or null when there's nothing to play.
    _gestureBlock(segments, opts = {}) {
        if (!this._requireAttached('gesture')) return null;
        if (!Array.isArray(segments) || segments.length === 0) {
            this._warn('gesture: needs a non-empty array of segments');
            return null;
        }

        const usesTo = segments.some(s => s.to !== undefined);
        const usesBy = segments.some(s => s.by !== undefined || s.value !== undefined);
        const absolute = (opts.absolute !== undefined) ? !!opts.absolute : usesTo;
        if (usesTo && usesBy)
            this._warn(`gesture: mixes 'to' (absolute) and 'by' (relative) — treating whole gesture as ${absolute ? 'absolute' : 'relative'}`);

        if (segments.length > MAX_STEPPER_SEGMENTS)
            this._warn(`gesture: ${segments.length} segments exceeds board max ${MAX_STEPPER_SEGMENTS} — extra segments dropped`);
        const count = Math.min(segments.length, MAX_STEPPER_SEGMENTS);

        const flags = absolute ? GESTURE_FLAG_ABSOLUTE : 0;

        // Encode: [logicalId u8, flags u8, count u8] + count × {curve u8, dur u16, value i32}.
        const bytes = new Uint8Array(3 + count * 7);
        const dv    = new DataView(bytes.buffer);
        dv.setUint8(0, this.logicalId & 0xFF);
        dv.setUint8(1, flags & 0xFF);
        dv.setUint8(2, count & 0xFF);
        let total = 0, rest = this.position;   // predicted end (board uses its true live position)
        for (let i = 0; i < count; i++) {
            const s   = segments[i];
            const off = 3 + i * 7;
            const dur = Math.max(1, Math.round(s.dur ?? 0));
            const val = absolute ? Math.round(s.to ?? rest)
                                 : Math.round(s.by ?? s.value ?? 0);
            dv.setUint8(off, curveId(s.curve));
            dv.setUint16(off + 1, dur & 0xFFFF, false);
            dv.setInt32(off + 3, val, false);
            total += dur;
            rest = absolute ? Math.round(s.to ?? rest) : rest + Math.round(s.by ?? s.value ?? 0);
        }

        this._armDone(total);
        this.target = rest;   // mirror commanded target; read polls refine position
        this._emit('move', { target: rest });
        return { bytes, total };
    }

    // Group adapter (group.gesture()). entries: [[member, segments], ...], all
    // Steppers → one CMD_STEPPER_GESTURE frame carrying every member's channel
    // block; the board plays them phase-locked on its own clock. Returns
    // frame(s) WITHOUT sending, so the group batches all types into one message.
    _memberGestureEncode(entries) {
        const blocks = [];
        for (const [m, segs] of entries) { const b = m._gestureBlock(segs); if (b) blocks.push(b.bytes); }
        if (!blocks.length) return [];
        const payload = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
        let off = 0;
        for (const b of blocks) { payload.set(b, off); off += b.length; }
        return [encodeFrame(CMD_STEPPER_GESTURE, DEVICE_STEPPER, [], payload)];
    }

    // -------------------------------------------------------------------
    // Velocity mode — continuous rotation at a constant speed (steps/sec).
    // Sign sets direction. stop() ends it.
    // -------------------------------------------------------------------
    runSpeed(speed) {
        if (!this._requireAttached('runSpeed')) return this;
        this.limitHit      = null;   // new motion
        this._movePromise  = null;   // continuous — never "arrives"
        this._moveDuration = 0;
        this.arduino.send(encodeFrame(CMD_STEPPER_RUN_SPEED, DEVICE_STEPPER,
            [this.logicalId, speed]));
        return this;
    }

    stop() {
        if (!this._requireAttached('stop')) return this;
        this.arduino.send(encodeFrame(CMD_STEPPER_STOP, DEVICE_STEPPER, [this.logicalId]));
        return this;
    }

    // hardStop() — instant halt with NO deceleration ramp (unlike stop(),
    // which decelerates). The board zeroes speed and distanceToGo in one
    // call, keeping the current position; a DONE follows so whenDone()
    // settles. Use for an e-stop, or to end a spin without the decel travel.
    hardStop() {
        if (!this._requireAttached('hardStop')) return this;
        this.arduino.send(encodeFrame(CMD_STEPPER_HARD_STOP, DEVICE_STEPPER, [this.logicalId]));
        return this;
    }

    // -------------------------------------------------------------------
    // Zeroing / manual homing — declare the current physical position.
    // -------------------------------------------------------------------
    setPosition(position = 0) {
        position = Math.round(position);
        this.position = position;
        if (this.isAttached) this._raw(CMD_STEPPER_SET_POSITION, [this.logicalId, position]);
        return this;
    }

    // -------------------------------------------------------------------
    // Enable pin — hold torque (enable) or release the coils (disable).
    // -------------------------------------------------------------------
    enable()  { if (this.isAttached) this._raw(CMD_STEPPER_ENABLE, [this.logicalId, 1]); return this; }
    disable() { if (this.isAttached) this._raw(CMD_STEPPER_ENABLE, [this.logicalId, 0]); return this; }

    // -------------------------------------------------------------------
    // Soft limits (safety) — the board clamps every target to [min, max].
    // -------------------------------------------------------------------
    setLimits(min, max) {
        this.limitMin     = Math.round(min);
        this.limitMax     = Math.round(max);
        this.limitEnabled = true;
        if (this.isAttached) {
            this._raw(CMD_STEPPER_SET_LIMITS, [this.logicalId, this.limitMin, this.limitMax, 1]);
        }
        return this;
    }

    clearLimits() {
        this.limitEnabled = false;
        if (this.isAttached) {
            this._raw(CMD_STEPPER_SET_LIMITS, [this.logicalId, this.limitMin, this.limitMax, 0]);
        }
        return this;
    }

    // -------------------------------------------------------------------
    // Hardware limit switches — none, one, or two, one call per switch:
    //   arduino.x.setLimitSwitch(LIMIT_MIN, 9);          // min end, active LOW (pull-up, switch to GND)
    //   arduino.x.setLimitSwitch(LIMIT_MAX, 10, HIGH);   // max end, active HIGH
    //   arduino.x.clearLimitSwitch(LIMIT_MIN);
    //
    // The trip happens ON THE BOARD (direction-aware instant stop; moving
    // away from a pressed switch is always allowed, so you can back off).
    // The browser gets a 'limit' event ({ which, position }), limitHit is
    // set, and the normal 'done' follows — so whenDone() still settles.
    // -------------------------------------------------------------------
    setLimitSwitch(which, pin, trigger = LOW) {
        const key = this._swKey(which);
        if (!key) { this._warn('setLimitSwitch — which must be LIMIT_MIN or LIMIT_MAX'); return this; }
        if (pin === -1 || pin === undefined || pin === null) return this.clearLimitSwitch(which);
        pin     = this.arduino._resolvePin(pin);
        trigger = trigger ? 1 : 0;
        this.switches[key] = { pin, trigger };
        if (this.isAttached) {
            this._raw(CMD_STEPPER_SET_SWITCH, [this.logicalId, key === 'max' ? 1 : 0, pin, trigger]);
        }
        return this;
    }

    clearLimitSwitch(which) {
        const key = this._swKey(which);
        if (!key) { this._warn('clearLimitSwitch — which must be LIMIT_MIN or LIMIT_MAX'); return this; }
        this.switches[key] = null;
        if (this.limitHit === key) this.limitHit = null;
        if (this.isAttached) {
            this._raw(CMD_STEPPER_SET_SWITCH, [this.logicalId, key === 'max' ? 1 : 0, -1, 0]);
        }
        return this;
    }

    _swKey(which) {
        if (which === 1 || which === 'max') return 'max';
        if (which === 0 || which === 'min') return 'min';
        return null;
    }

    // -------------------------------------------------------------------
    // Switch coordinate — where a limit switch physically sits, independent
    // of the soft limits. Homing adopts this coordinate when the switch trips
    // (default 0 = the switch is the origin). Lets home be the origin (0) with
    // the switch somewhere else:
    //   x.setLimitSwitch(LIMIT_MIN, 9);       // min-end switch on pin 9
    //   x.setSwitchPosition(LIMIT_MIN, -500); // it sits 500 steps below home
    //   await x.home().whenDone();            // seeks it, then travels to 0
    // -------------------------------------------------------------------
    setSwitchPosition(which, coord) {
        const key = this._swKey(which);
        if (!key) { this._warn('setSwitchPosition — which must be LIMIT_MIN or LIMIT_MAX'); return this; }
        this.switchPos[key] = Math.round(coord);
        if (this.isAttached) {
            this._raw(CMD_STEPPER_SET_SWITCH_POS,
                [this.logicalId, key === 'max' ? 1 : 0, this.switchPos[key]]);
        }
        return this;
    }

    // -------------------------------------------------------------------
    // Homing — home is the origin (0). setHome() re-zeros the frame so the
    // current spot becomes 0; home() travels back to it.
    //
    //   x.setHome();       // "here is 0" — re-zero: current position → 0, and
    //                      //  the soft limits + switch positions shift with it
    //   await x.home().whenDone({ timeout: 30000 });
    //
    // With a limit switch configured, home() runs a BOARD-SIDE routine: seek
    // the switch (MIN if configured, else MAX) at a homing speed, set the
    // counter to the switch's coordinate (setSwitchPosition, default 0) when it
    // trips, back off until it releases, then travel to the origin (0). Without
    // a switch it's a plain accel move to 0 (counter trusted).
    //
    // setHome(value) re-zeros to `value` instead of 0 (rarely needed): the
    // current spot becomes `value` and everything shifts by the same offset.
    // The board performs the shift and echoes the new position, limits and
    // switch positions — synced silently in handleMessage.
    // -------------------------------------------------------------------
    setHome(value = 0) {
        if (!this._requireAttached('setHome')) return this;
        value = Math.round(value);
        this.position = value;   // optimistic; the board's echoes confirm
        this._raw(CMD_STEPPER_SET_HOME, [this.logicalId, value]);
        return this;
    }

    // home(opts?) — opts: { speed, timeout }.
    //   speed   — seek speed in steps/sec (default maxSpeed/4, board-side).
    //   timeout — ms cap on the seek/back-off legs (default 30 s, board-side).
    //             If the switch never trips or never releases, the board
    //             hard-stops, fires 'home:fail', then 'done' (motion settled).
    // A bare number is ignored (it's a duration when group.home(duration)
    // fans out — the routine has no duration).
    home(opts = {}) {
        if (!this._requireAttached('home')) return this;
        const speed   = (typeof opts === 'number') ? 0 : Math.max(0, Math.round(opts.speed ?? 0));
        const timeout = (typeof opts === 'number') ? 0 : Math.max(0, Math.round(opts.timeout ?? 0));
        this._armDone();   // resolves on the routine's final DONE
        if (this.switches.min || this.switches.max) {
            this.target = this.homePosition;
            this._raw(CMD_STEPPER_HOME, [this.logicalId, speed, timeout]);
            this._emit('move', { target: this.target });
            return this;
        }
        // No switch — plain accel move (re-arms via moveTo).
        return this.moveTo(this.homePosition);
    }

    // -------------------------------------------------------------------
    // read(interval?, threshold?) — poll live state.
    // read()             — return cached position; no network traffic.
    // read(interval)     — board-side periodic poll (ms); 'change' fires
    //                      when the position moved by threshold+ steps.
    // read(interval, 10) — only report changes of 10+ steps.
    // read(END)          — stop this browser's periodic read.
    // The board runs the poll and gates per browser ;
    // threshold 0 = board default (1 step). Calling again with the same
    // settings just returns the cached value.
    // -------------------------------------------------------------------
    read(interval, threshold) {
        if (!this.isAttached) {
            this._warn('not attached');
            return this.position;
        }
        if (interval === END) { this._stopRead(); return this.position; }
        if (this._readInterval > 0
            && (interval  === undefined || interval  === this._readInterval)
            && (threshold === undefined || threshold === this._readThreshold)) {
            return this.position;
        }
        this._readInterval = interval ?? this.arduino.defaultInterval;
        if (threshold !== undefined) this._readThreshold = threshold;
        this._sendRead();
        return this.position;
    }

    // setReadInterval(ms) / setReadThreshold(steps) — set poll settings
    // directly; applied immediately if polling, stored for read() otherwise.
    setReadInterval(ms) {
        this._readInterval = ms;
        if (this.isAttached && ms > 0) this._sendRead();
        return this;
    }

    setReadThreshold(steps) {
        this._readThreshold = steps;
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        return this;
    }

    // Register (or update) this browser's poll with the board.
    _sendRead() {
        this.arduino.send(encodeFrame(CMD_STEPPER_READ, DEVICE_STEPPER,
            [this.logicalId, this._readInterval,
             Math.max(0, Math.round(this._readThreshold))]));
    }

    _stopRead() {
        if (this._readInterval > 0) {
            this.arduino.send(encodeFrame(CMD_STEPPER_READ, DEVICE_STEPPER,
                [this.logicalId, END]));   // END = unregister
        }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // Angle helpers — computed JS-side into raw steps, so the protocol
    // stays in pure steps. setStepsPerRev() must reflect your microstepping
    // (e.g. a 1.8° motor at 16 microsteps = 200 * 16 = 3200).
    // -------------------------------------------------------------------
    setStepsPerRev(steps) { this.stepsPerRev = Math.max(1, steps); return this; }

    moveToDegrees(deg)     { return this.moveTo(deg / 360 * this.stepsPerRev); }
    moveDegrees(deg)       { return this.move(deg / 360 * this.stepsPerRev); }
    moveToRevolutions(rev) { return this.moveTo(rev * this.stepsPerRev); }
    moveRevolutions(rev)   { return this.move(rev * this.stepsPerRev); }

    // -------------------------------------------------------------------
    // Callback shortcuts
    // -------------------------------------------------------------------
    onChange(fn)   { return this.on('change',   fn); }
    onDone(fn)     { return this.on('done',     fn); }
    onMove(fn)     { return this.on('move',     fn); }
    onLimit(fn)    { return this.on('limit',    fn); }
    onHomeFail(fn) { return this.on('home:fail', fn); }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            // ---- announce / state sync (silent — no events) ----
            case CMD_STEPPER_ATTACH:
                this.interface = frame.params[1];
                if (this.interface === STEPPER_FULL4WIRE) {
                    this.pins = [frame.params[2], frame.params[3], frame.params[4], frame.params[5]];
                    this.enPin = -1;
                } else {
                    this.pins = [frame.params[2], frame.params[3], -1, -1];
                    this.enPin      = frame.params[4] ?? -1;
                    this.invertMask = frame.params[5] ?? 0x04;
                }
                this.isAttached          = true;
                this._announcedByArduino = true;
                break;

            case CMD_STEPPER_SET_MAX_SPEED: this.maxSpeed     = frame.params[1]; break;
            case CMD_STEPPER_SET_ACCEL:     this.acceleration = frame.params[1]; break;
            case CMD_STEPPER_SET_POSITION:  this.position     = frame.params[1]; break;
            case CMD_STEPPER_MOVE_TO:       this.target       = frame.params[1]; break;   // reconnect target replay

            case CMD_STEPPER_SET_LIMITS:
                this.limitMin     = frame.params[1];
                this.limitMax     = frame.params[2];
                this.limitEnabled = frame.params[3] === 1;
                break;

            // ---- live updates (emit events) ----
            case CMD_STEPPER_READ:
                this.position     = frame.params[1];
                this.distanceToGo = frame.params[2];
                this.speed        = frame.params[3];
                this.isRunning    = frame.params[4] === 1;
                this.target       = this.position + this.distanceToGo;   // the board's real target
                this._emit('change', {
                    position: this.position, distanceToGo: this.distanceToGo,
                    speed: this.speed, isRunning: this.isRunning,
                });
                break;

            case CMD_STEPPER_DONE:
                this.position     = frame.params[1];
                this.distanceToGo = 0;
                this.isRunning    = false;
                this.target       = this.position;   // arrived
                this._emit('done', { position: this.position });
                this._resolveDone();
                break;

            // ---- limit switches ----
            case CMD_STEPPER_SET_SWITCH: {
                // Announce sync (or sketch-issued config echo) — silent.
                const key = frame.params[1] === 1 ? 'max' : 'min';
                const pin = frame.params[2];
                this.switches[key] = (pin >= 0)
                    ? { pin, trigger: frame.params[3] ? 1 : 0 }
                    : null;
                break;
            }

            case CMD_STEPPER_HOME: {
                // Homing GAVE UP (seek/back-off timeout) — the board hard-
                // stopped where it was. DONE follows, so whenDone() settles;
                // this event is how you learn home was never reached.
                this.position     = frame.params[1];
                this.distanceToGo = 0;
                this.isRunning    = false;
                this.target       = this.position;
                this._emit('home:fail', { position: this.position });
                break;
            }

            case CMD_STEPPER_SET_SWITCH_POS: {
                // Echo / announce sync — silent. The coordinate a switch sits
                // at (also arrives when SET_HOME re-zeros and shifts it).
                const key = frame.params[1] === 1 ? 'max' : 'min';
                this.switchPos[key] = frame.params[2];
                break;
            }

            case CMD_STEPPER_LIMIT: {
                // A switch tripped and the board hard-stopped the motor.
                // CMD_STEPPER_DONE follows (motion ended), so whenDone()
                // still settles; limitHit records that we stopped short.
                const which = frame.params[1] === 1 ? 'max' : 'min';
                this.position     = frame.params[2];
                this.distanceToGo = 0;
                this.isRunning    = false;
                this.target       = this.position;   // the move is over
                this.limitHit     = which;
                this._emit('limit', { which, position: this.position });
                break;
            }
        }
    }

    // -------------------------------------------------------------------
    // Group member adapter — see arduino.group(). Returns frame(s) WITHOUT
    // sending, so the group can batch all members into one message.
    // memberValue reports the last-read position.
    // -------------------------------------------------------------------
    _memberWrite(target) {
        if (!this._requireAttached('group write')) return [];
        this._armDone();
        target = Math.round(target);
        this.target = target;                 // mirror individual moveTo()
        this._emit('move', { target });
        return [encodeFrame(CMD_STEPPER_MOVE_TO, DEVICE_STEPPER, [this.logicalId, target])];
    }

    get memberValue() { return this.position; }

    // -------------------------------------------------------------------
    // Group timed-move hook (group.writeTimed()). Steppers know their own exact
    // position, so the board computes matched speeds from a shared duration —
    // one CMD_STEPPER_SYNC_MOVE with { logicalId, target } records makes the
    // whole bucket arrive together. entries: [[member, target, current], ...].
    // -------------------------------------------------------------------
    _memberSyncKey() { return this.isAttached ? 'stepper' : null; }

    _memberMoveEncode(entries, durationMs) {
        const bytes = new Uint8Array(entries.length * 5);
        const dv = new DataView(bytes.buffer);
        entries.forEach(([m, target], i) => {
            const t = Math.round(target);
            dv.setUint8(i * 5, m.logicalId & 0xFF);
            dv.setInt32(i * 5 + 1, t, false);
            m.target = t;                     // mirror individual moveTo()
            m._armDone(durationMs);
            m._emit('move', { target: t });
        });
        return [encodeFrame(CMD_STEPPER_SYNC_MOVE, DEVICE_STEPPER,
            [Math.max(0, Math.round(durationMs))], bytes)];
    }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:     this.logicalId,
            interface:     this.interface,
            pins:          this.pins.slice(),
            enPin:         this.enPin,
            attached:      this.isAttached,
            maxSpeed:      this.maxSpeed,
            acceleration:  this.acceleration,
            stepsPerRev:   this.stepsPerRev,
            target:        this.target,
            position:      this.position,
            distanceToGo:  this.distanceToGo,
            speed:         this.speed,
            isRunning:     this.isRunning,
            limits:        this.limitEnabled ? { min: this.limitMin, max: this.limitMax } : null,
            switches:      { min: this.switches.min, max: this.switches.max },
            switchPos:     { min: this.switchPos.min, max: this.switchPos.max },
            limitHit:      this.limitHit,
            home:          this.homePosition,
            interval:      this._readInterval,
        };
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------
    _raw(cmd, params) { this.arduino.send(encodeFrame(cmd, DEVICE_STEPPER, params)); }

    _requireAttached(who) {
        if (!this.isAttached) { this._warn(`not attached (${who})`); return false; }
        return true;
    }

    _whenDone() {
        return new Promise(resolve => this._doneResolvers.push(resolve));
    }

    _resolveDone() {
        const resolvers = this._doneResolvers;
        this._doneResolvers = [];
        resolvers.forEach(r => r(this.position));
    }

    // Arm the whenDone() promise for a move that will emit 'done'.
    // Every new move also clears limitHit — it records the LAST motion.
    _armDone(durationMs = 0) {
        this.limitHit      = null;
        this._moveDuration = Math.max(0, durationMs);
        this._movePromise  = this._whenDone();
    }

    // whenDone({ timeout }?) — Promise for the most recent move. Resolves
    // `true` on CMD_STEPPER_DONE (or immediately if no move is pending / it
    // already finished), `false` on the safety timeout. timeout: ms (default
    // max(duration × 2, 10000); 0 = wait forever). Also accepts a bare
    // number: whenDone(5000).
    //
    //   await arduino.x.moveTo(2000).whenDone();
    //   await arduino.x.moveTo(0).whenDone();
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
}

// Let the core materialise a Stepper when the SKETCH creates one
// (PardaloteStepper.attach("x", …) → CMD_SHARE → arduino.x).
registerExtensionType(Stepper);
