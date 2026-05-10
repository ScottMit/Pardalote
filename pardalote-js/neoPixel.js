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

        this.numPixels  = 0;
        this.pin        = -1;
        this.pixelType  = NEO_GRB + NEO_KHZ800;
        this.brightness = 255;
        this.threshold  = 5;     // min colour distance to trigger a send

        // Local pixel buffer — Map<index, {r,g,b,w}>
        this._pixelBuffer   = new Map();
        // Pending encoded frames to send on show()
        this._pendingFrames = [];

        // Set to true when the Arduino announces its strip state on connect.
        // _reRegister() uses this to skip re-INIT (and the flicker it causes)
        // when the Arduino is already running — only INIT when it has reset.
        this._announcedByArduino = false;
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
            // Arduino reset — re-initialize and restore full pixel state
            this.arduino.send(encodeFrame(CMD_NEO_INIT, DEVICE_NEO_PIXEL,
                [this.logicalId, this.pin, this.numPixels, this.pixelType]));
            if (this.brightness !== 255) {
                this.arduino.send(encodeFrame(CMD_NEO_BRIGHTNESS, DEVICE_NEO_PIXEL,
                    [this.logicalId, this.brightness]));
            }
            this._pendingFrames = [];
            this._pixelBuffer.forEach(({ r, g, b, w }, index) => {
                const params = w > 0
                    ? [this.logicalId, index, r, g, b, w]
                    : [this.logicalId, index, r, g, b];
                this._pendingFrames.push(encodeFrame(CMD_NEO_SET_PIXEL, DEVICE_NEO_PIXEL, params));
            });
            this.show();
        } else {
            // Arduino is running — pixel state is already correct.
            // Flush any changes queued while disconnected.
            this.show();
        }

        this._announcedByArduino = false;   // reset for next connection cycle
    }

    // -------------------------------------------------------------------
    // init(pin, numPixels, type?)
    // Initialise the strip on the Arduino. Call once in setup.
    // -------------------------------------------------------------------
    init(pin, numPixels, type = NEO_GRB + NEO_KHZ800) {
        this.pin       = this.arduino._resolvePin(pin);
        this.numPixels = numPixels;
        this.pixelType = type;
        this._pixelBuffer.clear();
        this._pendingFrames = [];
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

        const last = this._pixelBuffer.get(index) || { r:0, g:0, b:0, w:0 };
        const dist = Math.sqrt(
            (r-last.r)**2 + (gv-last.g)**2 + (bv-last.b)**2 + (wv-last.w)**2);
        if (dist <= this.threshold) return this;

        this._pixelBuffer.set(index, { r, g:gv, b:bv, w:wv });
        const params = wv > 0
            ? [this.logicalId, index, r, gv, bv, wv]
            : [this.logicalId, index, r, gv, bv];
        this._pendingFrames.push(encodeFrame(CMD_NEO_SET_PIXEL, DEVICE_NEO_PIXEL, params));
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

        const end = count > 0 ? first + count : this.numPixels;
        let changed = false;

        for (let i = first; i < end && i < this.numPixels; i++) {
            const last = this._pixelBuffer.get(i) || { r:0, g:0, b:0, w:0 };
            const dist = Math.sqrt(
                (r-last.r)**2 + (gv-last.g)**2 + (bv-last.b)**2 + (wv-last.w)**2);
            if (dist > this.threshold) {
                this._pixelBuffer.set(i, { r, g:gv, b:bv, w:wv });
                changed = true;
            }
        }

        if (changed) {
            this._pendingFrames.push(encodeFrame(CMD_NEO_FILL, DEVICE_NEO_PIXEL,
                [this.logicalId, color | 0, first, count]));
        }
        return this;
    }

    // -------------------------------------------------------------------
    // clear() — set all pixels off
    // -------------------------------------------------------------------
    clear() {
        this._pixelBuffer.clear();
        for (let i = 0; i < this.numPixels; i++) {
            this._pixelBuffer.set(i, { r:0, g:0, b:0, w:0 });
        }
        this._pendingFrames.push(encodeFrame(CMD_NEO_CLEAR, DEVICE_NEO_PIXEL,
            [this.logicalId]));
        return this;
    }

    // -------------------------------------------------------------------
    // setBrightness(value) — 0–255
    // -------------------------------------------------------------------
    setBrightness(value) {
        value = Math.max(0, Math.min(255, Math.round(value)));
        if (Math.abs(value - this.brightness) < this.threshold) return this;
        this.brightness = value;
        this._pendingFrames.push(encodeFrame(CMD_NEO_BRIGHTNESS, DEVICE_NEO_PIXEL,
            [this.logicalId, value]));
        return this;
    }

    // -------------------------------------------------------------------
    // show() — flush all buffered changes to the Arduino
    // -------------------------------------------------------------------
    show() {
        if (this._pendingFrames.length === 0) return this;
        this._pendingFrames.forEach(f => this.arduino.send(f));
        this._pendingFrames = [];
        this.arduino.send(encodeFrame(CMD_NEO_SHOW, DEVICE_NEO_PIXEL,
            [this.logicalId]));
        return this;
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------
    getPixelColor(index) {
        const p = this._pixelBuffer.get(index) || { r:0, g:0, b:0, w:0 };
        return this.Color(p.r, p.g, p.b, p.w);
    }

    numPixelsCount() { return this.numPixels; }

    setThreshold(t) { this.threshold = Math.max(0, t); return this; }

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
                this.numPixels = frame.params[2];
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
