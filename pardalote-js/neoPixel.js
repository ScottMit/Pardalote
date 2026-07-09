// ==============================================================
// neoPixel.js
// Pardalote NeoPixel Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Mirrors the Adafruit NeoPixel library API where possible.
// Pixel changes are buffered locally and only sent on show(),
// with threshold-based diffing to skip redundant updates.
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('strip', new NeoPixel());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.strip.init(D6, 30);
//       arduino.strip.setBrightness(80);
//       arduino.strip.fill(arduino.strip.Color(255, 0, 0));
//       arduino.strip.show();
//   });
// ==============================================================

const DEVICE_NEO_PIXEL = 200;

const CMD_NEO_INIT       = 0x0A;
const CMD_NEO_SET_PIXEL  = 0x0B;
const CMD_NEO_FILL       = 0x0C;
const CMD_NEO_CLEAR      = 0x0D;
const CMD_NEO_BRIGHTNESS = 0x0E;
const CMD_NEO_SHOW       = 0x0F;

// Pixel type flags — match Adafruit_NeoPixel
const NEO_RGB    = 0x06;
const NEO_RBG    = 0x09;
const NEO_GRB    = 0x52;
const NEO_GBR    = 0xA1;
const NEO_BRG    = 0x58;
const NEO_BGR    = 0xA4;
const NEO_KHZ800 = 0x0000;
const NEO_KHZ400 = 0x0100;

class NeoPixel extends Extension {
    static deviceId = DEVICE_NEO_PIXEL;

    constructor() {
        super();

        this._numPixels = 0;
        this.pin        = -1;
        this.pixelType  = NEO_GRB + NEO_KHZ800;
        this.brightness = 255;
        this.threshold  = 5;     // min colour distance to trigger a send

        // Local pixel buffer — Map<index, {r,g,b,w}>
        this._pixelBuffer = new Map();

        // Pending operations stored structurally so we can coalesce. These
        // describe the DESIRED next strip state, not an event log: repeated
        // calls to fill/setPixelColor/setBrightness within one throttle
        // window update them in place. See show() for the throttle logic.
        this._pendingFills      = [];          // [{ color, first, count }] — last fill of each range wins
        this._pendingSets       = new Map();   // index → { r, g, b, w }
        this._pendingClear      = false;
        this._pendingBrightness = null;        // number or null

        // show() throttle — debounce so rapid draw-loop show() calls coalesce
        // into one send. 20 ms ≈ 50 Hz comfortably keeps both ESP32 and UNO R4
        // from drowning in incoming WS frames.
        this.showThrottle      = 20;
        this._lastShowTime     = 0;
        this._pendingShowTimer = null;

        // Set to true when the Arduino announces its strip state on connect.
        // _reRegister() uses this to skip re-INIT (and the flicker it causes)
        // when the Arduino is already running — only INIT when it has reset.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Board switch — called by Arduino.connect() to wipe per-board state
    // while preserving user-tuned configuration (threshold, showThrottle).
    // -------------------------------------------------------------------
    _reset() {
        this.pin                 = -1;
        this._numPixels          = 0;
        this.pixelType           = NEO_GRB + NEO_KHZ800;
        this.brightness          = 255;
        this._pixelBuffer.clear();
        this._clearPending();
        this._lastShowTime       = 0;
        this._announcedByArduino = false;
    }

    _clearPending() {
        this._pendingFills      = [];
        this._pendingSets.clear();
        this._pendingClear      = false;
        this._pendingBrightness = null;
        if (this._pendingShowTimer !== null) {
            clearTimeout(this._pendingShowTimer);
            this._pendingShowTimer = null;
        }
    }

    _hasPending() {
        return this._pendingFills.length > 0
            || this._pendingSets.size > 0
            || this._pendingClear
            || this._pendingBrightness !== null;
    }

    // -------------------------------------------------------------------
    // Reconnection — restore strip state on the Arduino.
    //
    // Two cases:
    //   Arduino reset  (_announcedByArduino = false):
    //     Strip is uninitialized. Send INIT + brightness + full pixel buffer.
    //   Arduino running (_announcedByArduino = true):
    //     announce() already sent the current state; _pixelBuffer is already
    //     synced from handleMessage(). Skip INIT (avoids flicker). Just flush
    //     any changes queued while we were disconnected.
    // -------------------------------------------------------------------
    _reRegister() {
        if (this.pin === -1) return;

        if (!this._announcedByArduino) {
            // Arduino reset — re-initialize and restore full pixel state.
            // INIT goes directly (one-shot bootstrap); brightness + per-pixel
            // restore go through the pending queue so they benefit from the
            // same coalescence as normal traffic.
            this.arduino.send(encodeFrame(CMD_NEO_INIT, DEVICE_NEO_PIXEL,
                [this.logicalId, this.pin, this._numPixels, this.pixelType]));
            if (this.brightness !== 255) {
                this._pendingBrightness = this.brightness;
            }
            this._pixelBuffer.forEach(({ r, g, b, w }, index) => {
                this._pendingSets.set(index, { r, g, b, w });
            });
            this._actuallyShow();
        } else if (this._hasPending()) {
            // Arduino is running — pixel state is already correct.
            // Flush any changes queued while disconnected.
            this._actuallyShow();
        }

        this._announcedByArduino = false;   // reset for next connection cycle
    }

    // -------------------------------------------------------------------
    // init(pin, numPixels, type?)
    // Initialise the strip on the Arduino. Call once in setup.
    // -------------------------------------------------------------------
    init(pin, numPixels, type = NEO_GRB + NEO_KHZ800) {
        this.pin       = this.arduino._resolvePin(pin);
        this._numPixels = numPixels;
        this.pixelType = type;
        this._pixelBuffer.clear();
        this._clearPending();
        this.arduino.send(encodeFrame(CMD_NEO_INIT, DEVICE_NEO_PIXEL,
            [this.logicalId, this.pin, numPixels, type]));
        return this;
    }

    // -------------------------------------------------------------------
    // Color(r, g, b, w?) — pack into a 32-bit colour value
    // -------------------------------------------------------------------
    Color(r, g, b, w = 0) {
        return ((w & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
    }

    // -------------------------------------------------------------------
    // setPixelColor(index, r, g, b, w?) or setPixelColor(index, color)
    // Buffers the change; call show() to push to LEDs.
    // -------------------------------------------------------------------
    setPixelColor(index, r_or_color, g, b, w = 0) {
        let r, gv, bv, wv;

        if (arguments.length === 2) {
            const c = r_or_color >>> 0;
            wv = (c >> 24) & 0xFF;
            r  = (c >> 16) & 0xFF;
            gv = (c >>  8) & 0xFF;
            bv =  c        & 0xFF;
        } else {
            r  = r_or_color; gv = g; bv = b; wv = w;
        }

        r = Math.round(r); gv = Math.round(gv);
        bv = Math.round(bv); wv = Math.round(wv);

        // Threshold only applies when we have a known previous colour for
        // this pixel. The first write to an untouched pixel always reaches
        // the strip — otherwise barely-visible first colours would be lost.
        const last = this._pixelBuffer.get(index);
        if (last !== undefined) {
            const dist = Math.sqrt(
                (r-last.r)**2 + (gv-last.g)**2 + (bv-last.b)**2 + (wv-last.w)**2);
            if (dist <= this.threshold) return this;
        }

        this._pixelBuffer.set(index, { r, g:gv, b:bv, w:wv });
        // Coalesce: a later set for the same index replaces an earlier one.
        this._pendingSets.set(index, { r, g:gv, b:bv, w:wv });
        return this;
    }

    // -------------------------------------------------------------------
    // fill(color, first?, count?)
    // Fill a range with a colour. count=0 fills to end of strip.
    // -------------------------------------------------------------------
    fill(color, first = 0, count = 0) {
        const wv = (color >> 24) & 0xFF;
        const r  = (color >> 16) & 0xFF;
        const gv = (color >>  8) & 0xFF;
        const bv =  color        & 0xFF;

        const end = count > 0 ? first + count : this._numPixels;

        // Decide whether any pixel in the range justifies a send.
        // A never-set pixel always counts as a change (matches the
        // first-write-always-sends rule in setPixelColor).
        let changed = false;
        for (let i = first; i < end && i < this._numPixels; i++) {
            const last = this._pixelBuffer.get(i);
            if (last === undefined) { changed = true; break; }
            const dist = Math.sqrt(
                (r-last.r)**2 + (gv-last.g)**2 + (bv-last.b)**2 + (wv-last.w)**2);
            if (dist > this.threshold) { changed = true; break; }
        }

        if (changed) {
            // The Arduino will paint the entire range — sync every entry,
            // not just the ones that triggered the send, so future threshold
            // checks compare against the actual strip state.
            for (let i = first; i < end && i < this._numPixels; i++) {
                this._pixelBuffer.set(i, { r, g:gv, b:bv, w:wv });
            }

            // Coalesce: a fill of the same range replaces an earlier one.
            // A fill also supersedes any per-pixel sets in its range — those
            // would be overwritten on the wire anyway.
            const existing = this._pendingFills.findIndex(
                f => f.first === first && f.count === count);
            const entry = { color: color | 0, first, count };
            if (existing >= 0) this._pendingFills[existing] = entry;
            else               this._pendingFills.push(entry);

            for (const idx of [...this._pendingSets.keys()]) {
                if (idx >= first && idx < end) this._pendingSets.delete(idx);
            }
        }
        return this;
    }

    // -------------------------------------------------------------------
    // clear() — set all pixels off
    // -------------------------------------------------------------------
    clear() {
        this._pixelBuffer.clear();
        for (let i = 0; i < this._numPixels; i++) {
            this._pixelBuffer.set(i, { r:0, g:0, b:0, w:0 });
        }
        // clear supersedes any pending fills and per-pixel sets.
        this._pendingClear = true;
        this._pendingFills = [];
        this._pendingSets.clear();
        return this;
    }

    // -------------------------------------------------------------------
    // setBrightness(value) — 0–255
    // -------------------------------------------------------------------
    setBrightness(value) {
        value = Math.max(0, Math.min(255, Math.round(value)));
        if (Math.abs(value - this.brightness) < this.threshold) return this;
        this.brightness = value;
        this._pendingBrightness = value;   // coalesces — last value wins
        return this;
    }

    // -------------------------------------------------------------------
    // show() — request a flush of buffered changes to the Arduino.
    //
    // Debounced by showThrottle (default 20 ms). Repeated show() calls
    // within the throttle window collapse into a single send that uses
    // whatever the latest pending state was at the moment of flush.
    // That's what protects a 60 fps draw loop from overwhelming the WS
    // link and producing visible "catch-up" lag.
    // -------------------------------------------------------------------
    show() {
        if (!this._hasPending()) return this;

        const now  = Date.now();
        const wait = this.showThrottle - (now - this._lastShowTime);

        if (wait > 0) {
            // Defer. Any further show() calls during this window are no-ops;
            // they'll see this._pendingShowTimer is already set.
            if (this._pendingShowTimer === null) {
                this._pendingShowTimer = setTimeout(() => {
                    this._pendingShowTimer = null;
                    this._actuallyShow();
                }, wait);
            }
        } else {
            this._actuallyShow();
        }
        return this;
    }

    // Serialise the pending state to frames and send as one batched message.
    // Order on the wire mirrors the semantic order operations take effect:
    //   BRIGHTNESS → CLEAR → FILLs → per-pixel SETs → SHOW
    _actuallyShow() {
        if (!this._hasPending()) return;
        this._lastShowTime = Date.now();

        const frames = [];

        if (this._pendingBrightness !== null) {
            frames.push(encodeFrame(CMD_NEO_BRIGHTNESS, DEVICE_NEO_PIXEL,
                [this.logicalId, this._pendingBrightness]));
            this._pendingBrightness = null;
        }

        if (this._pendingClear) {
            frames.push(encodeFrame(CMD_NEO_CLEAR, DEVICE_NEO_PIXEL,
                [this.logicalId]));
            this._pendingClear = false;
        }

        for (const f of this._pendingFills) {
            frames.push(encodeFrame(CMD_NEO_FILL, DEVICE_NEO_PIXEL,
                [this.logicalId, f.color, f.first, f.count]));
        }
        this._pendingFills = [];

        for (const [index, p] of this._pendingSets) {
            const params = p.w > 0
                ? [this.logicalId, index, p.r, p.g, p.b, p.w]
                : [this.logicalId, index, p.r, p.g, p.b];
            frames.push(encodeFrame(CMD_NEO_SET_PIXEL, DEVICE_NEO_PIXEL, params));
        }
        this._pendingSets.clear();

        frames.push(encodeFrame(CMD_NEO_SHOW, DEVICE_NEO_PIXEL, [this.logicalId]));
        this.arduino.send(frames);
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------
    getPixelColor(index) {
        const p = this._pixelBuffer.get(index) || { r:0, g:0, b:0, w:0 };
        return this.Color(p.r, p.g, p.b, p.w);
    }

    numPixels() { return this._numPixels; }

    // Minimum colour distance to trigger a send. Higher values send less,
    // at the cost of visible quantisation during smooth fades.
    setThreshold(t) { this.threshold = Math.max(0, t); return this; }

    // Minimum ms between show() flushes — debounces rapid draw-loop calls.
    // Default 20 ms. Lower for snappier response on healthy networks;
    // raise to 50 ms+ if you still see queue-buildup lag on slow links.
    // Set to 0 to disable debouncing entirely (every show() flushes).
    // (Matches the Servo extension's setThrottle() naming convention.)
    setThrottle(ms) { this.showThrottle = Math.max(0, ms); return this; }

    // -------------------------------------------------------------------
    // State snapshot — returns the cached JS-side state synchronously.
    // No round-trip to the Arduino; everything here is what JS already
    // tracks. Mirrors getState() on Servo, MPU, Ultrasonic, and Camera.
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:    this.logicalId,
            pin:          this.pin,
            numPixels:    this._numPixels,
            pixelType:    this.pixelType,
            brightness:   this.brightness,
            threshold:    this.threshold,
            throttle:     this.showThrottle,
            pendingFlush: this._pendingShowTimer !== null,
        };
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino — either announce (state sync) or
    // future read-back extensions. No events are emitted here; these
    // are silent buffer updates that keep the JS state authoritative.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            case CMD_NEO_INIT:
                // Arduino is announcing an initialized strip — sync config.
                // Set flag so _reRegister() knows not to re-INIT.
                this._announcedByArduino = true;
                this.pin       = frame.params[1];
                this._numPixels = frame.params[2];
                this.pixelType = frame.params[3];
                this._pixelBuffer.clear();
                break;

            case CMD_NEO_BRIGHTNESS:
                this.brightness = frame.params[1];
                break;

            case CMD_NEO_SET_PIXEL: {
                // Sync individual pixel into buffer from announce.
                const index = frame.params[1];
                const r     = frame.params[2];
                const g     = frame.params[3];
                const b     = frame.params[4];
                const w     = frame.params[5] ?? 0;
                this._pixelBuffer.set(index, { r, g, b, w });
                break;
            }
        }
    }
}

// Let the core materialise a NeoPixel when the SKETCH creates one
// (PardaloteNeoPixel.attach("ring", 6, 24) → CMD_SHARE → arduino.ring).
registerExtensionType(NeoPixel);
