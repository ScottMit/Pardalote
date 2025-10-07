// ==============================================================
// neoPixel.js
// NeoPixel Extension for Arduino WebSocket
// Optimized: buffer updates locally, only send on .show()
// Works with UNO R4 WiFi and ESP32
// Version v0.15
// by Scott Mitchell, optimized by ChatGPT
// GPL-3.0 License
// ==============================================================

const NEO_PIXEL = 200;
const NEO_INIT       = 10;
const NEO_SET_PIXEL  = 11;
const NEO_FILL       = 12;
const NEO_CLEAR      = 13;
const NEO_BRIGHTNESS = 14;
const NEO_SHOW       = 15;

const NEO_RGB   = 0x06;
const NEO_RBG   = 0x09;
const NEO_GRB   = 0x52;
const NEO_GBR   = 0xA1;
const NEO_BRG   = 0x58;
const NEO_BGR   = 0xA4;

const NEO_KHZ800 = 0x0000;
const NEO_KHZ400 = 0x0100;

class NeoPixel {
    constructor(arduino) {
        this.arduino = arduino;
        this.deviceId = NEO_PIXEL;
        this.logicalId = null;

        this.pixelBuffer = new Map();
        this.pendingCommands = []; // local buffer of commands to send on show()
        this.currentBrightness = 255;
        this.numPixels = 0;

        this.defaultThreshold = 5;
    }

    init(pin, numPixels, type = NEO_GRB + NEO_KHZ800) {
        this.numPixels = numPixels;
        this.pixelBuffer.clear();
        this.pendingCommands.push({
            id: this.deviceId,
            action: NEO_INIT,
            params: [this.logicalId, pin, numPixels, type]
        });
        return this;
    }

    Color(r, g, b, w = 0) {
        return ((w & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
    }

    setPixelColor(index, r_or_color, g, b, w) {
        let r, g_val, b_val, w_val = 0;

        if (arguments.length === 2) {
            const color = r_or_color >>> 0;
            w_val = (color >> 24) & 0xFF;
            r = (color >> 16) & 0xFF;
            g_val = (color >> 8) & 0xFF;
            b_val = color & 0xFF;
        } else if (arguments.length >= 4) {
            r = r_or_color;
            g_val = g;
            b_val = b;
            w_val = w || 0;
        } else {
            throw new Error("Invalid arguments for setPixelColor");
        }

        r = Math.round(r);
        g_val = Math.round(g_val);
        b_val = Math.round(b_val);
        w_val = Math.round(w_val);

        const lastColor = this.pixelBuffer.get(index) || { r: 0, g: 0, b: 0, w: 0 };
        const colorDiff = Math.sqrt(
            Math.pow(r - lastColor.r, 2) +
            Math.pow(g_val - lastColor.g, 2) +
            Math.pow(b_val - lastColor.b, 2) +
            Math.pow(w_val - lastColor.w, 2)
        );

        if (colorDiff > this.defaultThreshold) {
            const params = w_val > 0 ?
                [this.logicalId, index, r, g_val, b_val, w_val] :
                [this.logicalId, index, r, g_val, b_val];

            this.pendingCommands.push({
                id: this.deviceId,
                action: NEO_SET_PIXEL,
                params: params
            });

            this.pixelBuffer.set(index, { r, g: g_val, b: b_val, w: w_val });
        }
        return this;
    }

    fill(color, first = 0, count = 0) {
        const startPixel = Math.round(first);
        const numToFill = Math.round(count) || (this.numPixels - startPixel);
        const { r, g, b, w } = this.colorToRGBW(color);

        let changed = false;
        for (let i = startPixel; i < startPixel + numToFill && i < this.numPixels; i++) {
            const last = this.pixelBuffer.get(i) || { r:0,g:0,b:0,w:0 };
            const diff = Math.sqrt(
                Math.pow(r - last.r, 2) +
                Math.pow(g - last.g, 2) +
                Math.pow(b - last.b, 2) +
                Math.pow(w - last.w, 2)
            );
            if (diff > this.defaultThreshold) {
                this.pixelBuffer.set(i, { r, g, b, w });
                changed = true;
            }
        }

        if (changed) {
            this.pendingCommands.push({
                id: this.deviceId,
                action: NEO_FILL,
                params: [this.logicalId, Math.round(color), startPixel, numToFill]
            });
        }
        return this;
    }

    clear() {
        this.pendingCommands.push({
            id: this.deviceId,
            action: NEO_CLEAR,
            params: [this.logicalId]
        });

        this.pixelBuffer.clear();
        for (let i = 0; i < this.numPixels; i++) {
            this.pixelBuffer.set(i, { r: 0, g: 0, b: 0, w: 0 });
        }
        return this;
    }

    setBrightness(value) {
        const intValue = Math.round(value);
        if (Math.abs(intValue - this.currentBrightness) >= this.defaultThreshold) {
            this.pendingCommands.push({
                id: this.deviceId,
                action: NEO_BRIGHTNESS,
                params: [this.logicalId, intValue]
            });
            this.currentBrightness = intValue;
        }
        return this;
    }

    show() {
        if (this.pendingCommands.length > 0) {
            this.arduino.send(this.pendingCommands);
            this.pendingCommands = [];
            this.arduino.send({
                id: this.deviceId,
                action: NEO_SHOW,
                params: [this.logicalId]
            });
        }
        return this;
    }

    getPixelColor(index) {
        if (index < 0 || index >= this.numPixels) return 0;
        const pixel = this.pixelBuffer.get(index) || { r: 0, g: 0, b: 0, w: 0 };
        return this.Color(pixel.r, pixel.g, pixel.b, pixel.w);
    }

    getNumPixels() {
        return this.numPixels;
    }

    getLogicalId() {
        return this.logicalId;
    }

    setThreshold(threshold) {
        this.defaultThreshold = Math.round(threshold);
        return this;
    }

    colorToRGBW(color) {
        return {
            w: (color >> 24) & 0xFF,
            r: (color >> 16) & 0xFF,
            g: (color >> 8) & 0xFF,
            b: color & 0xFF
        };
    }
}
