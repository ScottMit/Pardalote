// ==============================================================
// encoder.js
// Pardalote Rotary Encoder Extension (quadrature)
// Part of Pardalote — version in package.json
// by Scott Mitchell
// GPL-3.0 License
//
// Quadrature encoders: KY-040 style knobs, optical/magnetic motor
// shaft encoders. The BOARD counts edges in interrupt handlers (a 4x
// state-table decoder — immune to contact bounce and to edge rates
// far beyond what polling could see); the browser receives the
// absolute position, rate-limited per browser.
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('knob', new Encoder());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.knob.attach(D2, D3);        // pinA, pinB
//       arduino.knob.read(50);              // updates at most every 50 ms
//   });
//
//   arduino.knob.on('change', ({ position, delta, detents }) => {
//       volume += delta;
//   });
//
// Position is in RAW QUADRATURE STEPS (a KY-040 detent = 4 steps);
// setStepsPerDetent() scales the `detents` convenience property.
// The KY-040's push button is just a switch — wire it to any pin and
// use arduino.pin(SW).on('change', …), which delivers debounced
// edges instantly.
//
// Encoders created BY THE SKETCH (PardaloteEncoder.attach("knob", 2, 3))
// appear automatically as arduino.knob — no arduino.add() needed.
// ==============================================================

const DEVICE_ENCODER = 207;

const CMD_ENCODER_ATTACH       = 0x58;
const CMD_ENCODER_DETACH       = 0x59;
const CMD_ENCODER_READ         = 0x5A;
const CMD_ENCODER_SET_POSITION = 0x5B;

class Encoder extends Extension {
    static deviceId = DEVICE_ENCODER;

    constructor() {
        super();

        // Hardware state
        this.pinA       = -1;
        this.pinB       = -1;
        this.isAttached = false;

        // Position — raw quadrature steps, absolute. null until the first
        // value arrives (announce seed or read response); the mirror seeds
        // silently, so 'change' never fires with a phantom delta.
        this.position = null;

        // Detent scaling for the `detents` convenience (KY-040: 4).
        this.stepsPerDetent = 4;

        // Periodic read registration (board-side). _readThreshold is in
        // raw steps; 0 = board default (1 — every step). Survives _reset().
        this._readInterval  = 0;
        this._readThreshold = 0;

        // Set true when the Arduino announces this encoder's attach state
        // on connect — _reRegister() then skips the replay.
        this._announcedByArduino = false;
    }

    // Position scaled to detents (rounded).
    get detents() {
        return Math.round((this.position ?? 0) / this.stepsPerDetent);
    }

    setStepsPerDetent(n) { this.stepsPerDetent = Math.max(1, n); return this; }

    // -------------------------------------------------------------------
    // Board switch — wipe per-board state, keep user-tuned config.
    // -------------------------------------------------------------------
    _reset() {
        this._readInterval = 0;   // registration died with the old board — send nothing
        this.pinA          = -1;
        this.pinB          = -1;
        this.isAttached    = false;
        this.position      = null;
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Reconnection — replay attach only if the Arduino reset; always
    // re-register the read stream (per-client state died with the socket).
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.isAttached) {
            if (!this._announcedByArduino) this._sendAttach();
            if (this._readInterval > 0) this._sendRead();
        }
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // attach(pinA, pinB) — the two quadrature signal pins. The board
    // enables pullups and attaches CHANGE interrupts on both.
    // -------------------------------------------------------------------
    attach(pinA, pinB) {
        this.pinA       = this.arduino._resolvePin(pinA);
        this.pinB       = this.arduino._resolvePin(pinB);
        this.isAttached = true;
        this.position   = null;   // seeded by the board's response
        this._sendAttach();
        return this;
    }

    _sendAttach() {
        this.arduino.send(encodeFrame(CMD_ENCODER_ATTACH, DEVICE_ENCODER,
            [this.logicalId, this.pinA, this.pinB]));
    }

    detach() {
        this._stopRead();
        this.arduino.send(encodeFrame(CMD_ENCODER_DETACH, DEVICE_ENCODER,
            [this.logicalId]));
        this.isAttached = false;
        this.pinA = this.pinB = -1;
        return this;
    }

    // -------------------------------------------------------------------
    // read(interval?, threshold?)
    // read()             — return cached position; no network traffic.
    // read(interval)     — stream position changes, at most one update
    //                      per `interval` ms to THIS browser.
    // read(interval, 4)  — only changes of 4+ steps (one KY-040 detent).
    // read(END)          — stop this browser's stream.
    // The board counts continuously either way (interrupts) — the
    // interval is purely a rate limit, and because position is absolute
    // the latest value always carries the full state.
    // -------------------------------------------------------------------
    read(interval, threshold) {
        if (!this.isAttached) {
            this._warn('not attached');
            return this.position ?? 0;
        }
        if (interval === END) { this._stopRead(); return this.position ?? 0; }
        if (this._readInterval > 0
            && (interval  === undefined || interval  === this._readInterval)
            && (threshold === undefined || threshold === this._readThreshold)) {
            return this.position ?? 0;
        }
        this._readInterval = interval ?? this.arduino.defaultInterval;
        if (threshold !== undefined) this._readThreshold = threshold;
        this._sendRead();
        return this.position ?? 0;
    }

    // setReadInterval(ms) / setReadThreshold(steps) — set stream settings
    // directly; applied immediately if streaming, stored for read() otherwise.
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

    _sendRead() {
        this.arduino.send(encodeFrame(CMD_ENCODER_READ, DEVICE_ENCODER,
            [this.logicalId, this._readInterval,
             Math.max(0, Math.round(this._readThreshold))]));
    }

    _stopRead() {
        if (this._readInterval > 0) {
            this.arduino.send(encodeFrame(CMD_ENCODER_READ, DEVICE_ENCODER,
                [this.logicalId, END]));   // END = unregister
        }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // setPosition(value) / zero() — re-declare the current physical
    // position. The board sets its counter and echoes the new position
    // to every browser, so all mirrors adopt the new frame together.
    // -------------------------------------------------------------------
    setPosition(value) {
        if (!this.isAttached) { this._warn('not attached'); return this; }
        this.arduino.send(encodeFrame(CMD_ENCODER_SET_POSITION, DEVICE_ENCODER,
            [this.logicalId, Math.round(value)]));
        return this;
    }

    zero() { return this.setPosition(0); }

    // -------------------------------------------------------------------
    // Incoming frames
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            case CMD_ENCODER_ATTACH:
                // Announce sync — the board already has this encoder.
                this.pinA = frame.params[1];
                this.pinB = frame.params[2];
                this.isAttached          = true;
                this._announcedByArduino = true;
                break;

            case CMD_ENCODER_READ: {
                const pos  = frame.params[1];
                const prev = this.position;
                this.position = pos;
                // First value (announce/attach seed) fills the mirror
                // silently; after that, any movement fires 'change'.
                if (prev !== null && pos !== prev) {
                    this._emit('change', {
                        position: pos,
                        delta:    pos - prev,
                        detents:  this.detents,
                    });
                }
                break;
            }
        }
    }

    // -------------------------------------------------------------------
    // Callback shortcut
    // -------------------------------------------------------------------
    onChange(fn) { return this.on('change', fn); }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:      this.logicalId,
            pinA:           this.pinA,
            pinB:           this.pinB,
            attached:       this.isAttached,
            position:       this.position ?? 0,
            detents:        this.detents,
            stepsPerDetent: this.stepsPerDetent,
            interval:       this._readInterval,
            threshold:      this._readThreshold,
        };
    }
}

// Let the core materialise an Encoder when the SKETCH creates one
// (PardaloteEncoder.attach("knob", 2, 3) → CMD_SHARE → arduino.knob).
registerExtensionType(Encoder);
