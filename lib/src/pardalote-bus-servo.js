// ==============================================================
// busServo.js
// Pardalote Serial Bus Servo Extension
// Part of Pardalote — version in package.json
// by Scott Mitchell
// GPL-3.0-or-later License
//
// Serial-bus smart servos on a shared half-duplex UART:
//   - Feetech ST / SMS series (0–4095 counts) — e.g. STS3215, the servo in
//     the LeRobot SO-100/SO-101 arms.
//   - Feetech SC / SCS series (0–1023 counts) — e.g. SCS15.
//
// Unlike PWM servos, every bus servo shares one UART, so the inside/outside
// boundary is per-BUS, not per-servo: a serial bus is either a Pardalote bus
// (every servo on it is Pardalote hardware) or it isn't (private, driven by
// the sketch on a separate UART — Pardalote never touches it). A servo's
// hardware ID (1–253) is its ADDRESS ON THE BUS, passed to attach(); after
// that you drive it through this instance (arduino.<name>), never by raw id.
// Positions are RAW ENCODER COUNTS, not degrees.
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('shoulder', new BusServo());
//   arduino.add('elbow',    new BusServo());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.shoulder.attach(1);      // bus id 1 (ST series by default)
//       arduino.elbow.attach(2);
//       arduino.shoulder.center();       // → 2048
//       arduino.elbow.write(3000);       // raw counts
//   });
// ==============================================================

const DEVICE_BUSSERVO = 206;

const CMD_BUSSERVO_BUS_CONFIG  = 0x41;
const CMD_BUSSERVO_ATTACH      = 0x42;
const CMD_BUSSERVO_DETACH      = 0x43;
const CMD_BUSSERVO_WRITE       = 0x44;
const CMD_BUSSERVO_WRITE_SPEED = 0x45;
const CMD_BUSSERVO_SET_MODE    = 0x46;
const CMD_BUSSERVO_TORQUE      = 0x47;
const CMD_BUSSERVO_READ        = 0x48;
const CMD_BUSSERVO_SET_LIMITS  = 0x49;
const CMD_BUSSERVO_CALIBRATE   = 0x4A;
const CMD_BUSSERVO_SET_ID      = 0x4B;
const CMD_BUSSERVO_PING        = 0x4C;
const CMD_BUSSERVO_SCAN        = 0x4D;
const CMD_BUSSERVO_SYNC_WRITE  = 0x4E;
const CMD_BUSSERVO_DONE        = 0x51;
const CMD_BUSSERVO_READ_LIMITS = 0x62;  // read the servo's EEPROM angle-limit registers (firmware limits).
const CMD_BUSSERVO_PRESENT     = 0x63;  // Ar→JS: did the servo answer the attach-time ping?
const CMD_BUSSERVO_GESTURE     = 0x5A;  // global: payload = bus-servo channel blocks (segment schedules).
                                        // See pardalote.js CURVE_IDS / GESTURE_FLAG_* and defs.h.

// Board-side cap (PardaloteBusServo.h MAX_BUS_SERVO_SEGMENTS) — mirrored so
// JS can warn instead of silently overrunning. Extra segments are dropped.
const MAX_BUS_SERVO_SEGMENTS = 12;

const BUSSERVO_SERIES_ST = 0;   // 0–4095
const BUSSERVO_SERIES_SC = 1;   // 0–1023

const BUSSERVO_MODE_POSITION = 0;
const BUSSERVO_MODE_WHEEL    = 1;

class BusServo extends Extension {
    static deviceId = DEVICE_BUSSERVO;

    constructor() {
        super();

        // Binding
        this.servoId    = 0;
        this.series     = BUSSERVO_SERIES_ST;
        this.isAttached = false;

        // Position model — raw counts. ST: 0–4095, SC: 0–1023.
        this.resolution  = 4096;   // counts over the full range
        this.spanDegrees = 360;    // nominal angular span for degree helpers

        // Runtime state
        this.mode        = BUSSERVO_MODE_POSITION;
        this.torqueOn    = true;

        // Default move speed/acc used by group set() and sync-write.
        this.defaultSpeed = 2400;
        this.defaultAcc   = 50;
        this.maxMoveSpeed = 4095;   // speed cap used by group.moveTo() matching

        // Commanded destination (set by write; position is feedback)
        this.target      = 0;
        // Whether `target` is a LIVE goal. A position write/gesture sets it;
        // releasing torque (free mode) or entering wheel mode clears it — a
        // freed servo isn't holding a target. `target` keeps its last number
        // for reference; `hasTarget` says whether it currently means anything.
        this.hasTarget   = false;

        // Feedback (from read polls)
        this.position    = 0;
        this.velocity    = 0;
        this.load        = 0;
        this.voltage     = 0;      // volts
        this.temperature = 0;      // °C
        this.current     = 0;      // raw units (ST only)

        // Soft limits (mirrored into the servo's own registers)
        this.limitMin     = 0;
        this.limitMax     = 0;
        this.limitEnabled = false;

        // The servo's OWN firmware angle limits (read from EEPROM by the board
        // at attach, replayed on reconnect). null = not yet read / servo didn't
        // answer. { min, max, enabled } otherwise — enabled is false when the
        // servo reports min==max==0 (Feetech's "limits off / multi-turn").
        // Read-only mirror of the servo; distinct from the soft limits above.
        this.firmwareLimits = null;

        // Is the servo answering? true = found, false = no response (check
        // wiring / ID / baud), null = not yet attached / unknown. Seeded by the
        // board's attach-time ping (CMD_BUSSERVO_PRESENT), then kept LIVE from
        // read() feedback (position -1 = no answer) — so a servo powered up or
        // unplugged mid-session flips it. Fires the 'presence' event on change.
        this.present = null;

        // Periodic read registration (board-side).
        // _readThreshold is in counts; 0 = board default (2 counts).
        // Survives _reset() — it's user-tuned configuration.
        this._readInterval  = 0;
        this._readThreshold = 0;

        // Pending scan()/ping()/done/firmware-limit promise resolvers
        this._scanResolvers = [];
        this._pingResolvers = [];
        this._doneResolvers = [];
        this._fwLimitResolvers = [];

        // Home position (counts) — where home() goes; null = centre of range.
        this.homePosition = null;

        // Promise for the most recent move, consumed by whenDone(). Armed by
        // every position write (the board polls the Moving flag and emits
        // 'done' when it settles); cleared by runSpeed (wheel mode — no
        // arrival). _moveDuration feeds the default timeout.
        this._movePromise  = null;
        this._moveDuration = 0;

        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Board switch / reconnection
    // -------------------------------------------------------------------
    _reset() {
        this._readInterval = 0;  // registration died with the old board — send nothing
        this._drain(this._scanResolvers, []);
        this._drain(this._pingResolvers, null);
        this._drain(this._doneResolvers, this.position);
        this._drain(this._fwLimitResolvers, null);
        this.firmwareLimits = null;   // announce() replays it fresh from the board
        this.present = null;          // announce() replays presence too
        this._movePromise  = null;
        this._moveDuration = 0;
        this.homePosition  = null;
        this.servoId     = 0;
        this.isAttached  = false;
        this.mode        = BUSSERVO_MODE_POSITION;
        this.torqueOn    = true;
        this.target      = 0;
        this.hasTarget   = false;
        this.limitEnabled = false;
        this._announcedByArduino = false;
    }

    _reRegister() {
        if (this.isAttached && !this._announcedByArduino) {
            this._sendAttach();
            this._raw(CMD_BUSSERVO_SET_MODE, [this.logicalId, this.mode]);
            this._raw(CMD_BUSSERVO_TORQUE,   [this.logicalId, this.torqueOn ? 1 : 0]);
            if (this.limitEnabled) {
                this._raw(CMD_BUSSERVO_SET_LIMITS, [this.logicalId, this.limitMin, this.limitMax, 1]);
            }
        }
        // Periodic read registrations are per-WS-client on the Arduino
        // (cleared on disconnect), so always re-register if active.
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // configureBus({ serial, baud, rxPin, txPin }) — one-time bus setup.
    // Affects ALL bus servos (they share the UART). Optional: defaults to
    // Serial1 at 1 Mbps, begun lazily on first attach.
    //   serial : 1 or 2 (ESP32 only for 2)
    //   rxPin/txPin : ESP32 only; -1 = board default
    // -------------------------------------------------------------------
    configureBus({ serial = 1, baud = 1000000, rxPin = -1, txPin = -1 } = {}) {
        this._raw(CMD_BUSSERVO_BUS_CONFIG, [serial, baud, rxPin, txPin]);
        return this;
    }

    // -------------------------------------------------------------------
    // attach(servoId, series?)   series: 'ST' (default) or 'SC'
    // -------------------------------------------------------------------
    attach(servoId, series = 'ST') {
        this.servoId = servoId;
        this.series  = (String(series).toUpperCase() === 'SC')
            ? BUSSERVO_SERIES_SC : BUSSERVO_SERIES_ST;
        this.resolution  = (this.series === BUSSERVO_SERIES_SC) ? 1024 : 4096;
        this.spanDegrees = (this.series === BUSSERVO_SERIES_SC) ? 300 : 360;
        this.maxMoveSpeed = (this.series === BUSSERVO_SERIES_SC) ? 1023 : 4095;
        this.isAttached  = true;
        this._sendAttach();
        return this;
    }

    _sendAttach() {
        this.arduino.send(encodeFrame(CMD_BUSSERVO_ATTACH, DEVICE_BUSSERVO,
            [this.logicalId, this.servoId, this.series]));
    }

    detach() {
        this._stopRead();
        this._raw(CMD_BUSSERVO_DETACH, [this.logicalId]);
        this.isAttached = false;
        return this;
    }

    // -------------------------------------------------------------------
    // Position moves (position mode). Raw counts. Chainable.
    // write(counts, { speed, acc })
    // -------------------------------------------------------------------
    write(position, { speed = 2400, acc = 50 } = {}) {
        if (!this._requireAttached('write')) return this;
        this._armDone();          // the board polls Moving and emits 'done'
        position = this._clampPos(Math.round(position));
        this.target = position;                     // commanded goal; position is feedback
        this.hasTarget = true;                      // now a live goal (until freed)
        this.arduino.send(encodeFrame(CMD_BUSSERVO_WRITE, DEVICE_BUSSERVO,
            [this.logicalId, position, speed, acc]));
        this._emit('write', { position });
        return this;
    }

    // Go to the centre of range (2048 for ST, 512 for SC).
    center(opts) { return this.write(Math.round(this.resolution / 2), opts); }

    // Degree helpers — accurate for ST (4096/360°); nominal for SC.
    writeDegrees(deg, opts) {
        return this.write(deg / this.spanDegrees * this.resolution, opts);
    }
    get positionDegrees() {
        return this.position / this.resolution * this.spanDegrees;
    }

    // -------------------------------------------------------------------
    // writeTimed(position, duration) — reach `position` in about `duration`
    // ms. The servo does its own motion, so we pick the speed from the move
    // distance (measured from the last-read position). This is what group
    // moveTo() does per member; here it's exposed for a single servo.
    // -------------------------------------------------------------------
    writeTimed(position, duration = 1000) {
        if (!this._requireAttached('writeTimed')) return this;
        position = this._clampPos(Math.round(position));   // clamp BEFORE sizing the speed
        const distance = Math.abs(position - this.position);   // last-read position
        const speed = Math.min(this.maxMoveSpeed,
                               Math.max(1, Math.round(distance / Math.max(0.001, duration / 1000))));
        this.write(position, { speed });             // arms whenDone()
        this._moveDuration = Math.max(0, duration);  // better default timeout
        return this;
    }

    // -------------------------------------------------------------------
    // gesture(segments, opts?) — play an authored SEGMENT SCHEDULE on-board.
    //
    // The bus-servo counterpart of servo.gesture() / stepper.gesture(). A bus
    // servo runs its OWN motion, so — unlike the PWM servo — the per-segment
    // `curve` is NOT rendered inside a segment: each segment is one position
    // write at a distance/duration-matched speed, and the board advances to
    // the next when the servo's Moving flag settles (real arrival feedback,
    // not a timer). Expression comes from decomposing the move into segments
    // (and, in a group, lane overlap). Values are in servo COUNTS. Each
    // segment is { dur, curve?, and either `by` (relative) or `to` (absolute) }:
    //
    //   grip.gesture([                       // reach out, ease back, small settle
    //       { by:  600, dur: 400 },
    //       { by: -600, dur: 600 },
    //       { by:   80, dur: 200 },
    //   ]);
    //   await grip.gesture([...]).whenDone();
    //
    // Relative by default (the board captures live start position, then chains
    // from each target); `to`/opts.absolute for absolute targets (soft limits
    // clamp the ends). The authored `dur` sizes each segment's speed; if that
    // exceeds the servo's max the segment simply takes longer and the next
    // still fires on true arrival. Fires one 'done' after the last segment.
    // -------------------------------------------------------------------
    gesture(segments, opts = {}) {
        const blk = this._gestureBlock(segments, opts);
        if (!blk) return this;
        this.arduino.send(encodeFrame(CMD_BUSSERVO_GESTURE, DEVICE_BUSSERVO, [], blk.bytes));
        return this;
    }

    // Encode ONE gesture channel block — shared by gesture() (wrap + send) and
    // the group adapter _memberGestureEncode() (batched, no send). Arms
    // whenDone(), mirrors the commanded target, emits 'write'. Returns
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

        if (segments.length > MAX_BUS_SERVO_SEGMENTS)
            this._warn(`gesture: ${segments.length} segments exceeds board max ${MAX_BUS_SERVO_SEGMENTS} — extra segments dropped`);
        const count = Math.min(segments.length, MAX_BUS_SERVO_SEGMENTS);

        const flags = absolute ? GESTURE_FLAG_ABSOLUTE : 0;

        // Encode: [logicalId u8, flags u8, count u8] + count × {curve u8, dur u16, value i32}.
        const bytes = new Uint8Array(3 + count * 7);
        const dv    = new DataView(bytes.buffer);
        dv.setUint8(0, this.logicalId & 0xFF);
        dv.setUint8(1, flags & 0xFF);
        dv.setUint8(2, count & 0xFF);
        let total = 0, rest = this.position;   // predicted end (board uses its live read)
        for (let i = 0; i < count; i++) {
            const s   = segments[i];
            const off = 3 + i * 7;
            const dur = Math.max(1, Math.round(s.dur ?? 0));
            const val = absolute ? this._clampPos(Math.round(s.to ?? rest))
                                 : Math.round(s.by ?? s.value ?? 0);
            dv.setUint8(off, curveId(s.curve));
            dv.setUint16(off + 1, dur & 0xFFFF, false);
            dv.setInt32(off + 3, val, false);
            total += dur;
            rest = absolute ? this._clampPos(Math.round(s.to ?? rest))
                            : this._clampPos(rest + Math.round(s.by ?? s.value ?? 0));
        }

        this._armDone(total);
        this.target = rest;   // mirror commanded target; read polls refine position
        this.hasTarget = true;
        this._emit('write', { position: rest });
        return { bytes, total };
    }

    // Group adapter (group.gesture()). entries: [[member, segments], ...], all
    // BusServos → one CMD_BUSSERVO_GESTURE frame carrying every member's channel
    // block; the board sequences each locally. Returns frame(s) WITHOUT sending,
    // so the group batches all types into one message.
    _memberGestureEncode(entries) {
        const blocks = [];
        for (const [m, segs] of entries) { const b = m._gestureBlock(segs); if (b) blocks.push(b.bytes); }
        if (!blocks.length) return [];
        const payload = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
        let off = 0;
        for (const b of blocks) { payload.set(b, off); off += b.length; }
        return [encodeFrame(CMD_BUSSERVO_GESTURE, DEVICE_BUSSERVO, [], payload)];
    }

    // stop() — halt motion: hold the last-read position (or zero speed in
    // wheel mode). Matches servo.stop() / stepper.stop().
    stop() {
        if (!this._requireAttached('stop')) return this;
        if (this.mode === BUSSERVO_MODE_WHEEL) this.runSpeed(0);
        else this.write(this.position);
        return this;
    }

    // -------------------------------------------------------------------
    // Continuous rotation (wheel mode). Sign of speed sets direction.
    // Call setMode('wheel') first, or just call runSpeed — the servo is
    // put in wheel mode on the board when it receives a speed command.
    // Named to match stepper.runSpeed() (the Feetech lib calls it WriteSpe).
    // -------------------------------------------------------------------
    runSpeed(speed, { acc = 50 } = {}) {
        if (!this._requireAttached('runSpeed')) return this;
        this._movePromise  = null;   // continuous — never "arrives"
        this._moveDuration = 0;
        this.hasTarget     = false;  // wheel mode has no position goal
        if (this.mode !== BUSSERVO_MODE_WHEEL) this.setMode('wheel');
        this.arduino.send(encodeFrame(CMD_BUSSERVO_WRITE_SPEED, DEVICE_BUSSERVO,
            [this.logicalId, Math.round(speed), acc]));
        return this;
    }

    setMode(mode) {
        const m = (String(mode).toLowerCase() === 'wheel')
            ? BUSSERVO_MODE_WHEEL : BUSSERVO_MODE_POSITION;
        this.mode = m;
        if (this.isAttached) this._raw(CMD_BUSSERVO_SET_MODE, [this.logicalId, m]);
        return this;
    }

    // -------------------------------------------------------------------
    // Torque — disable to hand-pose a joint then read it back (teaching by
    // demonstration), enable to hold position.
    // -------------------------------------------------------------------
    torque(on)      { this.torqueOn = !!on;
                      if (!this.torqueOn) this.hasTarget = false;   // freed → no live target
                      if (this.isAttached) this._raw(CMD_BUSSERVO_TORQUE, [this.logicalId, on ? 1 : 0]);
                      return this; }
    enableTorque()  { return this.torque(true); }
    disableTorque() { return this.torque(false); }

    // -------------------------------------------------------------------
    // read(interval?, threshold?) — poll present state.
    // read()             — return cached position; no network traffic.
    // read(interval)     — board-side periodic poll (ms): ONE bus
    //                      transaction per tick regardless of how many
    //                      browsers are connected; 'change' fires when the
    //                      position moved by threshold+ counts.
    // read(interval, 10) — only report changes of 10+ counts.
    // read(END)          — stop this browser's periodic read.
    // The board runs the poll and gates per browser ;
    // threshold 0 = board default (2 counts — encoder noise floor).
    // Calling again with the same settings just returns the cached value.
    // -------------------------------------------------------------------
    read(interval, threshold) {
        if (!this.isAttached) { this._warn('not attached'); return this.position; }
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

    // setReadInterval(ms) / setReadThreshold(counts) — set poll settings
    // directly; applied immediately if polling, stored for read() otherwise.
    setReadInterval(ms) {
        this._readInterval = ms;
        if (this.isAttached && ms > 0) this._sendRead();
        return this;
    }

    setReadThreshold(counts) {
        this._readThreshold = counts;
        if (this.isAttached && this._readInterval > 0) this._sendRead();
        return this;
    }

    // Register (or update) this browser's poll with the board.
    _sendRead() {
        this._raw(CMD_BUSSERVO_READ, [this.logicalId, this._readInterval,
            Math.max(0, Math.round(this._readThreshold))]);
    }

    _stopRead() {
        if (this._readInterval > 0) this._raw(CMD_BUSSERVO_READ, [this.logicalId, END]);
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // Soft limits (safety) — same shape as stepper/servo setLimits().
    // Clamped in board RAM on every write path (browser, sketch, group
    // SyncWrite) and mirrored here. Deliberately software-only: does NOT
    // write the servo's EEPROM limit registers (no wear, no unverified
    // unLockEprom path). Limits therefore live on the board, not in the
    // servo — the board re-applies them; a bare servo on another bus won't.
    // -------------------------------------------------------------------
    setLimits(min, max) {
        min = Math.round(min);
        max = Math.round(max);
        this.limitMin = Math.min(min, max);
        this.limitMax = Math.max(min, max);
        this.limitEnabled = true;
        if (this.isAttached) this._raw(CMD_BUSSERVO_SET_LIMITS, [this.logicalId, this.limitMin, this.limitMax, 1]);
        return this;
    }

    clearLimits() {
        this.limitEnabled = false;
        if (this.isAttached) this._raw(CMD_BUSSERVO_SET_LIMITS, [this.logicalId, this.limitMin, this.limitMax, 0]);
        return this;
    }

    // -------------------------------------------------------------------
    // readFirmwareLimits() — force a fresh read of the servo's OWN EEPROM
    // angle-limit registers on the board, and resolve with the result. Also
    // updates the cached `firmwareLimits` property (the board reads these once
    // at attach, so `firmwareLimits` is usually already populated — call this
    // only to re-read after changing them on the servo).
    //
    // Resolves { min, max, enabled } (counts), or null if the servo didn't
    // answer. enabled is false when min==max==0 (Feetech "limits off").
    //   const fw = await arduino.shoulder.readFirmwareLimits();
    // Read the cached value directly (no round-trip) with .firmwareLimits.
    // -------------------------------------------------------------------
    readFirmwareLimits() {
        if (!this._requireAttached('readFirmwareLimits')) return Promise.resolve(null);
        this._raw(CMD_BUSSERVO_READ_LIMITS, [this.logicalId]);
        return new Promise(resolve => this._fwLimitResolvers.push(resolve));
    }

    // Mirror the board's clamp so cached target matches what it applied:
    // physical range always (keeps the needle/timing honest and stops an
    // out-of-range count wrapping mod-resolution), soft limits when set.
    _clampPos(pos) {
        pos = Math.max(0, Math.min(this.resolution - 1, pos));
        if (this.limitEnabled) pos = Math.max(this.limitMin, Math.min(this.limitMax, pos));
        return pos;
    }

    // -------------------------------------------------------------------
    // Home — setHome() declares the home position (no-arg: "here is home",
    // from the last-read position — hand-pose with torque off, read(), then
    // setHome()); home() goes there, home(duration) goes there smoothly.
    // Default home is the centre of range (2048 ST / 512 SC).
    //   arduino.shoulder.setHome(1500);
    //   await arduino.shoulder.home(1000).whenDone();
    // -------------------------------------------------------------------
    setHome(position) {
        this.homePosition = Math.round(position === undefined ? this.position : position);
        return this;
    }

    home(duration) {
        const target = this.homePosition ?? Math.round(this.resolution / 2);
        return (duration > 0) ? this.writeTimed(target, duration)
                              : this.write(target);
    }

    // -------------------------------------------------------------------
    // calibrate() — declare the current physical position as centre.
    // Move the joint to its zero pose by hand (torque off), then call this.
    // -------------------------------------------------------------------
    calibrate() {
        if (this.isAttached) this._raw(CMD_BUSSERVO_CALIBRATE, [this.logicalId]);
        return this;
    }

    // -------------------------------------------------------------------
    // setId(newId) — renumber this servo. ONLY with a single servo on the
    // bus, or every servo will take the new ID. Used during initial setup.
    // -------------------------------------------------------------------
    setId(newServoId) {
        if (this.isAttached) {
            this._raw(CMD_BUSSERVO_SET_ID, [this.logicalId, newServoId]);
            this.servoId = newServoId;
        }
        return this;
    }

    // -------------------------------------------------------------------
    // ping(servoId?) — resolves true/false. Defaults to this servo's ID.
    // scan(first?, last?) — resolves an array of responding servo IDs.
    // -------------------------------------------------------------------
    ping(servoId = this.servoId) {
        this._raw(CMD_BUSSERVO_PING, [this.logicalId, servoId]);
        return new Promise(resolve => this._pingResolvers.push(resolve));
    }

    scan(first = 1, last = 20) {
        this._raw(CMD_BUSSERVO_SCAN, [first, last]);
        return new Promise(resolve => this._scanResolvers.push(resolve));
    }

    // -------------------------------------------------------------------
    // Callback shortcuts
    // -------------------------------------------------------------------
    onChange(fn) { return this.on('change', fn); }
    onWrite(fn) { return this.on('write', fn); }
    onDone(fn)  { return this.on('done',  fn); }
    onPresence(fn) { return this.on('presence', fn); }

    // Resolves when the board reports the servo settled (CMD_BUSSERVO_DONE).
    _whenDone() { return new Promise(resolve => this._doneResolvers.push(resolve)); }

    // Arm the whenDone() promise for a move that will emit 'done'.
    _armDone(durationMs = 0) {
        this._moveDuration = Math.max(0, durationMs);
        this._movePromise  = this._whenDone();
    }

    // whenDone({ timeout }?) — Promise for the most recent move. Resolves
    // `true` on CMD_BUSSERVO_DONE (the servo's own Moving flag settled — real
    // arrival, not a timer; or immediately if no move is pending / it already
    // finished), `false` on the safety timeout. timeout: ms (default
    // max(duration × 2, 10000); 0 = wait forever). Also accepts a bare
    // number: whenDone(5000).
    //
    //   await arduino.j1.writeTimed(2048, 1500).whenDone();
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
    // Incoming frames from Arduino.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            // ---- announce / state sync (silent) ----
            case CMD_BUSSERVO_ATTACH:
                this.servoId    = frame.params[1];
                this.series     = frame.params[2] ?? BUSSERVO_SERIES_ST;
                this.resolution  = (this.series === BUSSERVO_SERIES_SC) ? 1024 : 4096;
                this.spanDegrees = (this.series === BUSSERVO_SERIES_SC) ? 300 : 360;
                this.maxMoveSpeed = (this.series === BUSSERVO_SERIES_SC) ? 1023 : 4095;
                this.isAttached          = true;
                this._announcedByArduino = true;
                break;

            case CMD_BUSSERVO_BUS_CONFIG: /* global echo — nothing per-instance */ break;
            case CMD_BUSSERVO_SET_MODE:   this.mode     = frame.params[1]; break;
            case CMD_BUSSERVO_TORQUE:
                this.torqueOn = frame.params[1] === 1;
                if (!this.torqueOn) this.hasTarget = false;   // freed elsewhere → drop the target
                break;

            case CMD_BUSSERVO_SET_LIMITS:
                this.limitMin = frame.params[1];
                this.limitMax = frame.params[2];
                this.limitEnabled = (frame.params[3] ?? 1) === 1;
                break;

            case CMD_BUSSERVO_WRITE:
                // Echoed from a sketch-issued write — mirror the commanded goal.
                this.target = frame.params[1];
                this.hasTarget = true;
                break;

            case CMD_BUSSERVO_READ_LIMITS: {
                // The servo's own firmware angle limits: [id, min, max] raw
                // counts (-1 = servo didn't answer). min==max==0 = disabled.
                const min = frame.params[1], max = frame.params[2];
                this.firmwareLimits = (min < 0 || max < 0)
                    ? null
                    : { min, max, enabled: !(min === 0 && max === 0) };
                this._emit('fwlimits', this.firmwareLimits);
                this._drain(this._fwLimitResolvers, this.firmwareLimits);
                break;
            }

            case CMD_BUSSERVO_PRESENT: {
                // Did the servo answer the attach-time ping? [id, servoId, present]
                const p = frame.params[2];
                this.present = (p === 1) ? true : (p === 0) ? false : null;
                this._emit('presence', { servoId: frame.params[1], present: this.present });
                break;
            }

            case CMD_BUSSERVO_DONE:
                // Board polled the Moving flag and the servo has settled.
                this.position = frame.params[1];
                this._emit('done', { position: this.position });
                this._drain(this._doneResolvers, this.position);
                break;

            // ---- live updates ----
            case CMD_BUSSERVO_READ: {
                this.position    = frame.params[1];
                this.velocity    = frame.params[2];
                this.load        = frame.params[3];
                this.voltage     = frame.params[4] / 10;   // decivolts → volts
                this.temperature = frame.params[5];
                this.current     = frame.params[6];
                // Live presence: a valid read means the servo answered; the
                // board sends position -1 when it doesn't. This keeps `present`
                // current between attaches — a servo powered up (or unplugged)
                // mid-session flips it and fires 'presence'. (Positions are
                // 0..resolution-1, so -1 is an unambiguous "no answer".)
                const answering = this.position !== -1;
                if (answering !== this.present) {
                    this.present = answering;
                    this._emit('presence', { servoId: this.servoId, present: this.present });
                }
                this._emit('change', {
                    position: this.position, velocity: this.velocity, load: this.load,
                    voltage: this.voltage, temperature: this.temperature, current: this.current,
                });
                break;
            }

            case CMD_BUSSERVO_PING:
                this._drain(this._pingResolvers, frame.params[2] === 1);
                this._emit('ping', { servoId: frame.params[1], found: frame.params[2] === 1 });
                break;

            case CMD_BUSSERVO_SCAN: {
                const count = frame.params[1];
                const ids = [];
                for (let i = 0; i < count; i++) ids.push(frame.params[2 + i]);
                this._drain(this._scanResolvers, ids);
                this._emit('scan', { ids });
                break;
            }
        }
    }

    // -------------------------------------------------------------------
    // Group member adapter — see arduino.group(). Returns frame(s) WITHOUT
    // sending, so the group can batch all members into one message. Uses
    // default move speed/acc; memberValue reports the last-read position.
    // -------------------------------------------------------------------
    _memberWrite(position) {
        if (!this._requireAttached('group write')) return [];
        this._armDone();
        position = this._clampPos(Math.round(position));
        this.target = position;               // mirror individual write()
        this.hasTarget = true;
        this._emit('write', { position });
        return [encodeFrame(CMD_BUSSERVO_WRITE, DEVICE_BUSSERVO,
            [this.logicalId, position, this.defaultSpeed, this.defaultAcc])];
    }

    get memberValue() { return this.position; }

    // Set the default move speed/acc used by group set() and sync-write.
    setMoveDefaults(speed, acc) {
        if (speed !== undefined) this.defaultSpeed = Math.max(0, Math.round(speed));
        if (acc   !== undefined) this.defaultAcc   = Math.max(0, Math.round(acc));
        return this;
    }

    // -------------------------------------------------------------------
    // Hardware sync-write hooks (used by group.write()). Members sharing a
    // sync key are coalesced into one Feetech SyncWrite packet, so they
    // latch their goals simultaneously — tighter than one-message batching.
    // Only bus servos of the SAME series can share a packet.
    // -------------------------------------------------------------------
    _memberSyncKey() { return this.isAttached ? `busservo:${this.series}` : null; }

    // Immediate coordinated write (group.write()). entries: [[member, position, speed?], ...]
    // — one SyncWrite packet; speed defaults to each member's defaultSpeed.
    _memberSetEncode(entries) {
        const bytes = new Uint8Array(entries.length * 6);
        const dv = new DataView(bytes.buffer);
        entries.forEach(([m, v, speed], i) => {
            const pos = m._clampPos(Math.max(0, Math.round(v)));
            const spd = Math.max(0, Math.round(speed !== undefined ? speed : m.defaultSpeed)) & 0xFFFF;
            const off = i * 6;
            dv.setUint8 (off,     m.servoId & 0xFF);
            dv.setInt16 (off + 1, pos, false);
            dv.setUint16(off + 3, spd, false);
            dv.setUint8 (off + 5, m.defaultAcc & 0xFF);
            m.target = pos;                   // mirror individual write()
            m.hasTarget = true;
            m._armDone();
            m._emit('write', { position: pos });
        });
        return [encodeFrame(CMD_BUSSERVO_SYNC_WRITE, DEVICE_BUSSERVO, [this.series], bytes)];
    }

    // Timed arrive-together (group.writeTimed()). entries: [[member, target, current], ...].
    // Bus servos do their own motion, so we match speeds: speed_i = distance_i /
    // duration, scaled down uniformly if the fastest exceeds the cap (ratios —
    // and thus simultaneous arrival — preserved), floored at 1 to avoid the
    // Feetech "speed 0 = max speed" trap. Then one SyncWrite with per-servo speeds.
    _memberMoveEncode(entries, durationMs) {
        const durSec   = Math.max(0.001, durationMs / 1000);
        const cap      = this.maxMoveSpeed || 4095;
        const minSpeed = 1;
        const items = entries.map(([m, target, current]) => {
            const t = m._clampPos(Math.round(target));   // clamp BEFORE distance/speed matching
            const distance = Math.abs(t - Math.round(current ?? m.memberValue ?? 0));
            return { m, target: t, distance };
        });
        const maxRaw = items.reduce((mx, it) => Math.max(mx, it.distance / durSec), 0);
        const scale  = (maxRaw > cap) ? (cap / maxRaw) : 1;
        const recs = items.map(it => {
            const s = Math.min(cap, Math.max(minSpeed, Math.round((it.distance / durSec) * scale)));
            return [it.m, it.target, s];
        });
        const frames = this._memberSetEncode(recs);   // arms each member's whenDone()
        recs.forEach(([m]) => { m._moveDuration = Math.max(0, durationMs); });
        return frames;
    }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:   this.logicalId,
            servoId:     this.servoId,
            series:      this.series === BUSSERVO_SERIES_SC ? 'SC' : 'ST',
            attached:    this.isAttached,
            mode:        this.mode === BUSSERVO_MODE_WHEEL ? 'wheel' : 'position',
            torque:      this.torqueOn,
            resolution:  this.resolution,
            target:      this.target,
            hasTarget:   this.hasTarget,
            position:    this.position,
            velocity:    this.velocity,
            load:        this.load,
            voltage:     this.voltage,
            temperature: this.temperature,
            current:     this.current,
            limits:      this.limitEnabled ? { min: this.limitMin, max: this.limitMax } : null,
            firmwareLimits: this.firmwareLimits,
            present:     this.present,
            home:        this.homePosition ?? Math.round(this.resolution / 2),
            interval:    this._readInterval,
        };
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------
    _raw(cmd, params) { this.arduino.send(encodeFrame(cmd, DEVICE_BUSSERVO, params)); }

    _requireAttached(who) {
        if (!this.isAttached) { this._warn(`not attached (${who})`); return false; }
        return true;
    }

    _drain(list, value) {
        if (!list.length) return;
        const resolvers = list.splice(0, list.length);
        resolvers.forEach(r => r(value));
    }
}

// Let the core materialise a BusServo when the SKETCH creates one
// (PardaloteBusServo.attach("wrist", 5) → CMD_SHARE → arduino.wrist).
registerExtensionType(BusServo);
