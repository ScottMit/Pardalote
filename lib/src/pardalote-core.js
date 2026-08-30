// ==============================================================
// pardalote.js
// Arduino to JavaScript Binary WebSocket Communication
// Part of Pardalote — version in package.json
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// Product version — the release humans see. Canonical copy lives in
// package.json; mirrored here so a page can ask at runtime
// (Arduino.version). The wire protocol versions independently below.
const PARDALOTE_VERSION = '1.1.0';

// Wire-protocol MAJOR this build speaks — compared against the
// firmware's HELLO. A mismatch means the two sides cannot talk.
const PROTOCOL_MAJOR_SUPPORTED = 1;

// -------------------------------------------------------------------
// Protocol constants — must match defs.h
// -------------------------------------------------------------------
const CMD_HELLO         = 0x00;
const CMD_ANNOUNCE      = 0x01;
const CMD_PIN_MODE      = 0x02;
const CMD_DIGITAL_WRITE = 0x03;
const CMD_DIGITAL_READ  = 0x04;
const CMD_ANALOG_WRITE  = 0x05;
const CMD_ANALOG_READ   = 0x06;
const CMD_END           = 0x07;
const CMD_PING          = 0x08;
const CMD_PONG          = 0x09;
const CMD_SYNC_COMPLETE = 0x0A;  // Arduino → JS: all announce frames sent; triggers 'ready'
const CMD_MESSAGE       = 0x0B;  // Both ways: user-defined key/value message (see the message channel)
const CMD_AUTH          = 0x0C;  // JS → Arduino: connection key (payload). Arduino → JS: [reason]
                                 // rejection (1 = key required, 2 = wrong key) — fires 'authFail'
                                 // and stops auto-reconnect. Works over both transports (over USB
                                 // the key is a board-identity check — catches the wrong board).
const CMD_SERIAL_BUSY   = 0x0D;  // Arduino → JS (serial): a WiFi-active board that got a plain
                                 // (gesture-less) probe. "I'm on WiFi — reconnect with a picker
                                 // gesture to switch me to USB." Fires 'usbBusy', stops probing.
const CMD_REBOOT        = 0x0E;  // Arduino → JS (serial): sent at boot. A browser still holding the
                                 // port resumes takeover-probing so the board switches straight back
                                 // to serial — fast recovery from a reset while USB-connected.

// Device-scoped share command — the VALUE is reserved across all extension
// device IDs. Ar→JS: [logicalId] + payload: name. The core intercepts it
// generically and materialises a browser object of the class registered for
// that deviceId (see registerExtensionType), bound as arduino.<name>.
const CMD_SHARE = 0x56;

// Pin modes
const INPUT          = 0;
const OUTPUT         = 1;
const INPUT_PULLUP   = 2;
const INPUT_PULLDOWN = 3;
const ANALOG_INPUT_MODE   = 8;

// Digital values
const LOW  = 0;
const HIGH = 1;

// Pass as interval to stop a periodic read
const END = -1;

// Pass to connectSerial() to always show the port picker (vs silently reusing a
// previously-granted port): arduino.connectSerial(PROMPT). Just { prompt: true }.
const PROMPT = Object.freeze({ prompt: true });

// Limit-switch ends — stepper.setLimitSwitch(LIMIT_MIN, pin) / (LIMIT_MAX, pin).
// Named to match the firmware's LIMIT_MIN/LIMIT_MAX constants.
const LIMIT_MIN = 0;
const LIMIT_MAX = 1;

// -------------------------------------------------------------------
// Expressive motion — the shared gesture vocabulary (must match defs.h).
//
// A gesture is a per-actuator SEGMENT SCHEDULE the board plays locally.
// These constants are the load-bearing shared part: the SAME numbered
// easing table and flag bits are used by this file, every extension's
// gesture() encoder, the firmware (shapeCurve), and the standalone
// follower's PROGMEM gestures. Change a formula here → change it in
// defs.h's shapeCurve() too, or authoring preview and board motion drift.
// -------------------------------------------------------------------
const GESTURE_FLAG_ABSOLUTE = 0x01;   // segment value is an absolute target, not a relative delta
const GESTURE_FLAG_LOOP     = 0x02;   // repeat the schedule (reserved)

// Curated easing set (0x05+ reserved for elastic/bounce later).
const CURVE_IDS = { linear: 0, easeIn: 1, easeOut: 2, easeInOut: 3, back: 4 };
const CURVE_NAMES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back'];

// Resolve a curve name (or raw id) to its numeric id; unknown → linear (warns via caller).
function curveId(c) {
    if (typeof c === 'number') return c | 0;
    const id = CURVE_IDS[c];
    return id === undefined ? 0 : id;
}

// The easing shapes — byte-for-byte the same math as defs.h shapeCurve().
// For authoring PREVIEW/simulation only; the board computes the real motion.
// `t` in [0,1]; `back` returns slightly >1 mid-flight (the overshoot).
function curveShape(curve, t) {
    switch (curveId(curve)) {
        case 1: return t * t;                        // easeIn  — t^2
        case 2: return t * (2 - t);                  // easeOut — 1-(1-t)^2
        case 3: return t * t * (3 - 2 * t);          // easeInOut — smoothstep
        case 4: {                                    // back (easeOutBack), s = 1.70158
            const k = t - 1;
            return 1 + 2.70158 * k * k * k + 1.70158 * k * k;
        }
        default: return t;                           // linear
    }
}

// Message-channel value types (low byte of a CMD_MESSAGE target) and flags
// (high byte). Must match defs.h MSG_TYPE_* / MSG_FLAG_*.
const MSG_TYPE_INT   = 0;
const MSG_TYPE_BOOL  = 1;
const MSG_TYPE_FLOAT = 2;
const MSG_TYPE_CHAR  = 3;
const MSG_TYPE_TEXT  = 4;
const MSG_TYPE_BLOB  = 5;
const MSG_TYPE_NAMES = ['int', 'bool', 'float', 'char', 'text', 'blob'];

const MSG_FLAG_RETAIN    = 0x01;
const MSG_FLAG_BROADCAST = 0x02;

const MAX_MESSAGE_KEY = 24;   // matches defs.h MAX_MESSAGE_KEY

// Per-board pin alias tables.
// Keys match the PARDALOTE_BOARD string sent in the HELLO handshake.
// Values map alias string → Arduino pin number.
// Add entries here when adding new board support to the firmware.
const BOARD_ALIASES = {
    'UNO R4 WiFi': {
        'D0':  0,  'D1':  1,  'D2':  2,  'D3':  3,
        'D4':  4,  'D5':  5,  'D6':  6,  'D7':  7,
        'D8':  8,  'D9':  9,  'D10': 10, 'D11': 11,
        'D12': 12, 'D13': 13,
        'A0':  14, 'A1':  15, 'A2':  16, 'A3':  17, 'A4':  18, 'A5':  19,
        'SDA': 18, 'SCL': 19,
    },
    'ESP32-WROVER-DEV': {
        // From pins_arduino.h — uPesy_esp32_wrover_devkit variant
        'TX':   1, 'RX':   3,
        'SDA': 21, 'SCL': 22,
        'SS':   5, 'MOSI': 23, 'MISO': 19, 'SCK': 18,
        'A0':  36, 'A3':  39, 'A4':  32, 'A5':  33, 'A6':  34, 'A7':  35,
        'A10':  4, 'A11':  0, 'A12':  2, 'A13': 15, 'A14': 13, 'A15': 12,
        'A16': 14, 'A17': 27, 'A18': 25, 'A19': 26,
        'T0':   4, 'T1':   0, 'T2':   2, 'T3':  15, 'T4':  13,
        'T5':  12, 'T6':  14, 'T7':  27, 'T8':  33, 'T9':  32,
        'DAC1': 25, 'DAC2': 26,
        'LED_BUILTIN': 2,
    },
    'FireBeetle 2 ESP32-C5': {
        // From pins_arduino.h — dfrobot_firebeetle2_esp32c5 variant
        'A1':  2,  'A2':  3,  'A3':  4,  'A4':  5,
        'D2':  8,  'D3': 26,  'D6': 27,  'D9': 28,
        'D11': 7,  'D12': 6,  'D13': 15,
        'TX': 11,  'RX': 12,
        'SDA': 9,  'SCL': 10,
        'MOSI': 24, 'MISO': 25, 'SCK': 23, 'SS': 27,
        'LED_BUILTIN': 15,
    },
};

// -------------------------------------------------------------------
// Bare pin-name globals — D13, A0, SDA … usable exactly like Arduino:
//     arduino.digitalWrite(D13, HIGH);
// Each name (the union of every board's alias keys above) is exposed on the
// global object as a string equal to its own name (D13 === 'D13'). The value
// carries NO pin number — it is the alias name, resolved per Arduino()
// instance at call time, in _resolvePin(), via that board's alias table. So
// the same global D13 maps to the right physical pin on each board, and two
// instances (leader / follower) can disagree — which a plain `const D13 = 13`
// global never could. Bare D13 and the string 'D13' are therefore identical;
// the global just saves the quotes.
//
// Installed as guarded globalThis properties (NOT top-level `const`): a
// property never throws a redeclaration SyntaxError against a user's own
// `const TX`/other library — their binding simply shadows ours — and the
// `name in globalThis` guard means we defer to any name already defined
// rather than clobbering it. The string form ('D13') resolves identically
// and needs no global at all.
//
// Opt out entirely with:  <script src="pardalote.js" data-pins="off"></script>
// -------------------------------------------------------------------
(function installPinGlobals() {
    if (typeof document === 'undefined') return;   // browser only (Node test harness skips)
    const tag = document.currentScript;
    if (tag && tag.dataset && tag.dataset.pins === 'off') return;

    const names = new Set();
    for (const board in BOARD_ALIASES)
        for (const name in BOARD_ALIASES[board]) names.add(name);

    const skipped = [];
    names.forEach(name => {
        if (name in globalThis) { skipped.push(name); return; }   // defer to existing global
        globalThis[name] = name;   // D13 === 'D13' — resolved per instance in _resolvePin
    });
    if (skipped.length && typeof console !== 'undefined')
        console.info(
            `Pardalote: pin alias globals not installed (name already defined): ` +
            `${skipped.join(', ')}. Use the string form (e.g. arduino.digitalWrite('${skipped[0]}', …)) ` +
            `or set data-pins="off" on the script tag to silence this.`);
})();

const RESERVED_START = 200;

// -------------------------------------------------------------------
// Command-name table for the frame monitor (arduino.on('frame', …)) —
// keyed '<deviceId>:<cmd>' for extension frames, 'core:<cmd>' for core.
// Maintained by hand alongside defs.h (mirror of internal/frame_names.h).
// frameName() falls back to a hex label for anything not listed.
// -------------------------------------------------------------------
const _FRAME_NAMES = {
    'core:0':  'HELLO',      'core:1':  'ANNOUNCE',      'core:2':  'PIN_MODE',
    'core:3':  'DIGITAL_WRITE', 'core:4': 'DIGITAL_READ', 'core:5': 'ANALOG_WRITE',
    'core:6':  'ANALOG_READ', 'core:7': 'END',           'core:8': 'PING',
    'core:9':  'PONG',       'core:10': 'SYNC_COMPLETE',  'core:11': 'MESSAGE',
    'core:12': 'AUTH',
    '200:92': 'NEO_INIT', '200:93': 'NEO_SET_PIXEL', '200:94': 'NEO_FILL',
    '200:95': 'NEO_CLEAR', '200:96': 'NEO_BRIGHTNESS', '200:97': 'NEO_SHOW',
    '201:20': 'SERVO_ATTACH', '201:21': 'SERVO_DETACH', '201:22': 'SERVO_WRITE',
    '201:23': 'SERVO_WRITE_MICROSECONDS', '201:24': 'SERVO_READ', '201:25': 'SERVO_ATTACHED',
    '201:26': 'SERVO_WRITE_TIMED', '201:27': 'SERVO_SYNC_TIMED', '201:28': 'SERVO_STOP',
    '201:29': 'SERVO_DONE', '201:84': 'SERVO_SET_LIMITS', '201:88': 'SERVO_GESTURE',
    '201:100': 'SERVO_GESTURE_STATE',
    '202:30': 'ULTRASONIC_ATTACH', '202:31': 'ULTRASONIC_DETACH',
    '202:32': 'ULTRASONIC_READ', '202:33': 'ULTRASONIC_SET_TIMEOUT',
    '203:40': 'IMU_ATTACH', '203:41': 'IMU_DETACH', '203:42': 'IMU_READ',
    '203:43': 'IMU_SET_ACCEL_RANGE', '203:44': 'IMU_SET_GYRO_RANGE', '203:45': 'IMU_CALIBRATE',
    '204:48': 'CAMERA_INIT', '204:49': 'CAMERA_SET_RES', '204:50': 'CAMERA_SET_QUALITY',
    '205:51': 'STEPPER_ATTACH', '205:52': 'STEPPER_DETACH', '205:53': 'STEPPER_MOVE_TO',
    '205:54': 'STEPPER_MOVE', '205:55': 'STEPPER_SET_MAX_SPEED', '205:56': 'STEPPER_SET_ACCEL',
    '205:57': 'STEPPER_RUN_SPEED', '205:58': 'STEPPER_STOP', '205:59': 'STEPPER_SET_POSITION',
    '205:60': 'STEPPER_ENABLE', '205:61': 'STEPPER_SET_LIMITS', '205:62': 'STEPPER_READ',
    '205:63': 'STEPPER_DONE', '205:64': 'STEPPER_HOME', '205:79': 'STEPPER_MOVE_TIMED',
    '205:80': 'STEPPER_SYNC_MOVE', '205:82': 'STEPPER_SET_SWITCH', '205:83': 'STEPPER_LIMIT',
    '205:85': 'STEPPER_SET_HOME', '205:87': 'STEPPER_HARD_STOP', '205:89': 'STEPPER_GESTURE',
    '205:101': 'STEPPER_GESTURE_STATE',
    '207:88': 'ENCODER_ATTACH', '207:89': 'ENCODER_DETACH',
    '207:90': 'ENCODER_READ', '207:91': 'ENCODER_SET_POSITION',
    '206:65': 'BUSSERVO_BUS_CONFIG', '206:66': 'BUSSERVO_ATTACH', '206:67': 'BUSSERVO_DETACH',
    '206:68': 'BUSSERVO_WRITE', '206:69': 'BUSSERVO_WRITE_SPEED', '206:70': 'BUSSERVO_SET_MODE',
    '206:71': 'BUSSERVO_TORQUE', '206:72': 'BUSSERVO_READ', '206:73': 'BUSSERVO_SET_LIMITS',
    '206:74': 'BUSSERVO_CALIBRATE', '206:75': 'BUSSERVO_SET_ID', '206:76': 'BUSSERVO_PING',
    '206:77': 'BUSSERVO_SCAN', '206:78': 'BUSSERVO_SYNC_WRITE', '206:81': 'BUSSERVO_DONE',
    '206:90': 'BUSSERVO_GESTURE', '206:102': 'BUSSERVO_GESTURE_STATE',
};

// Resolve a decoded frame's command to a readable name (hex fallback).
function frameName(target, cmd) {
    if (cmd === CMD_MESSAGE) return 'MESSAGE';
    if (cmd === CMD_SHARE)   return 'SHARE';
    const key = target < RESERVED_START ? `core:${cmd}` : `${target}:${cmd}`;
    return _FRAME_NAMES[key] || `0x${cmd.toString(16).padStart(2, '0').toUpperCase()}`;
}

// -------------------------------------------------------------------
// Frame encoding
//
// params is a plain JS number array. Integer values encode as int32,
// any value with a decimal part encodes as float32. The TYPE_MASK
// records which params are float so the Arduino can decode correctly.
// -------------------------------------------------------------------
function encodeFrame(cmd, target, params = [], payload = null) {
    if (!Number.isInteger(target) || target < 0 || target > 0xFFFF) {
        throw new RangeError(
            `Pardalote: encodeFrame target must be an integer in [0, 65535], got ${target}`
        );
    }
    let payloadBytes;
    if (payload == null) {
        payloadBytes = null;
    } else if (typeof payload === 'string') {
        payloadBytes = new TextEncoder().encode(payload);
    } else if (payload instanceof ArrayBuffer) {
        payloadBytes = new Uint8Array(payload);
    } else {
        payloadBytes = payload;   // assume Uint8Array
    }
    const payloadLen = payloadBytes ? payloadBytes.length : 0;

    const buf = new ArrayBuffer(8 + params.length * 4 + payloadLen);
    const v   = new DataView(buf);

    let typeMask = 0;
    params.forEach((p, i) => { if (!Number.isInteger(p)) typeMask |= (1 << i); });

    v.setUint8(0,  cmd);
    v.setUint16(1, target,   false);
    v.setUint8(3,  params.length);
    v.setUint16(4, typeMask, false);
    v.setUint16(6, payloadLen, false);

    params.forEach((p, i) => {
        const off = 8 + i * 4;
        Number.isInteger(p)
            ? v.setInt32(off,   p, false)
            : v.setFloat32(off, p, false);
    });

    if (payloadBytes) {
        new Uint8Array(buf, 8 + params.length * 4).set(payloadBytes);
    }

    return buf;
}

// -------------------------------------------------------------------
// Frame decoding — returns null if the buffer is too short.
// -------------------------------------------------------------------
function decodeFrame(buf, pos) {
    if (pos + 8 > buf.byteLength) return null;
    const v = new DataView(buf);

    const cmd        = v.getUint8(pos);
    const target     = v.getUint16(pos + 1, false);
    const nparams    = v.getUint8(pos + 3);
    const typeMask   = v.getUint16(pos + 4, false);
    const payloadLen = v.getUint16(pos + 6, false);
    const totalLen   = 8 + nparams * 4 + payloadLen;

    if (pos + totalLen > buf.byteLength) return null;

    const params = [];
    for (let i = 0; i < nparams; i++) {
        const off = pos + 8 + i * 4;
        params.push((typeMask >> i) & 1
            ? v.getFloat32(off, false)
            : v.getInt32(off,   false));
    }

    const payload = payloadLen > 0
        ? buf.slice(pos + 8 + nparams * 4, pos + totalLen)
        : null;

    return { cmd, target, params, payload, totalLen };
}

// -------------------------------------------------------------------
// Batch multiple encoded frames into a single ArrayBuffer for sending.
// -------------------------------------------------------------------
function encodeBatch(frames) {
    const total = frames.reduce((n, f) => n + f.byteLength, 0);
    const out   = new Uint8Array(total);
    let pos = 0;
    for (const f of frames) { out.set(new Uint8Array(f), pos); pos += f.byteLength; }
    return out.buffer;
}

// -------------------------------------------------------------------
// Encode a CMD_MESSAGE frame. The value type is inferred from the JS
// value (boolean→bool, integer→int, fractional→float, string→text,
// Uint8Array/ArrayBuffer→blob); override with opts.type ('char' is the
// one that can't be inferred — a JS char is just a length-1 string).
//
//   Layout: TARGET = (flags << 8) | type ;  PAYLOAD = [keyLen][key][value?]
//
// Built by hand (not via encodeFrame) so the FLOAT type tag and the
// param's float32 encoding always agree, even for whole-number floats.
// -------------------------------------------------------------------
function encodeMessage(key, value, opts = {}) {
    const t = opts.type;
    let type, param = null, isFloat = false, valueBytes = null;

    if (t === 'char') {
        type  = MSG_TYPE_CHAR;
        param = (typeof value === 'string' ? value.charCodeAt(0) : (value | 0)) & 0xFF;
    } else if (t === 'bool' || (t == null && typeof value === 'boolean')) {
        type = MSG_TYPE_BOOL; param = value ? 1 : 0;
    } else if (t === 'float' || (t == null && typeof value === 'number' && !Number.isInteger(value))) {
        type = MSG_TYPE_FLOAT; param = value; isFloat = true;
    } else if (t === 'int' || (t == null && typeof value === 'number')) {
        type = MSG_TYPE_INT; param = value | 0;
    } else if (t === 'text' || (t == null && typeof value === 'string')) {
        type = MSG_TYPE_TEXT; valueBytes = new TextEncoder().encode(String(value));
    } else if (t === 'blob' || value instanceof Uint8Array || value instanceof ArrayBuffer) {
        type = MSG_TYPE_BLOB;
        valueBytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    } else {
        throw new Error(`Pardalote: cannot send message "${key}" — unsupported value type`);
    }

    const flags  = (opts.retain ? MSG_FLAG_RETAIN : 0) | (opts.broadcast ? MSG_FLAG_BROADCAST : 0);
    const target = ((flags & 0xFF) << 8) | (type & 0xFF);

    let keyBytes = new TextEncoder().encode(String(key));
    if (keyBytes.length > MAX_MESSAGE_KEY) {
        // Silently truncated here; Arduino.send() reports it on the 'warn' channel.
        keyBytes = keyBytes.subarray(0, MAX_MESSAGE_KEY);
    }
    const kl      = keyBytes.length;
    const vlen    = valueBytes ? valueBytes.length : 0;
    const nparams = param === null ? 0 : 1;

    const buf   = new ArrayBuffer(8 + nparams * 4 + 1 + kl + vlen);
    const v     = new DataView(buf);
    v.setUint8(0, CMD_MESSAGE);
    v.setUint16(1, target, false);
    v.setUint8(3, nparams);
    v.setUint16(4, isFloat ? 0x0001 : 0x0000, false);   // TYPE_MASK: bit0 for the float param
    v.setUint16(6, 1 + kl + vlen, false);               // PAYLOAD_LEN
    if (nparams) {
        if (isFloat) v.setFloat32(8, param, false);
        else         v.setInt32(8, param, false);
    }
    const bytes    = new Uint8Array(buf);
    const payStart = 8 + nparams * 4;
    bytes[payStart] = kl;
    bytes.set(keyBytes, payStart + 1);
    if (vlen) bytes.set(valueBytes, payStart + 1 + kl);
    return buf;
}

// Decode a CMD_MESSAGE frame → { key, value, type } (type is a name string).
function decodeMessage(frame) {
    const type = frame.target & 0xFF;
    const p    = frame.payload ? new Uint8Array(frame.payload) : null;
    if (!p || p.length < 1) return null;
    const keyLen = p[0];
    if (1 + keyLen > p.length) return null;
    const key = new TextDecoder().decode(p.subarray(1, 1 + keyLen));

    let value;
    switch (type) {
        case MSG_TYPE_INT:   value = frame.params.length ? (frame.params[0] | 0) : 0; break;
        case MSG_TYPE_BOOL:  value = !!(frame.params.length && frame.params[0]);      break;
        case MSG_TYPE_FLOAT: value = frame.params.length ? frame.params[0] : 0;       break;
        case MSG_TYPE_CHAR:  value = String.fromCharCode((frame.params[0] || 0) & 0xFF); break;
        case MSG_TYPE_TEXT:  value = new TextDecoder().decode(p.subarray(1 + keyLen)); break;
        case MSG_TYPE_BLOB:  value = p.slice(1 + keyLen);                              break;  // Uint8Array
        default: return null;
    }
    return { key, value, type: MSG_TYPE_NAMES[type] || `type${type}` };
}

// ===================================================================
// Serial transport (Web Serial) — the same binary frames, carried over
// USB serial instead of a WebSocket. Chrome/Edge only.
//
// A WebSocket gives the protocol message boundaries and reliability; a
// raw byte stream has neither, so each message travels in an envelope
// (mirrors internal/serial_transport.h on the firmware side):
//
//   0x00  0xA5  COBS( message bytes + CRC8 )  0x00
//
// COBS guarantees no 0x00 inside the body, so the decoder always
// resyncs on the next delimiter — a corrupted byte costs one message,
// never the link. Bytes OUTSIDE envelopes are the sketch's own
// Serial.print output: collected line by line and surfaced as the
// 'log' event, so students see their debug prints in the browser
// without opening the IDE.
// ===================================================================

// CRC8, poly 0x07, init 0x00 — must match the firmware.
function _crc8(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i];
        for (let b = 0; b < 8; b++)
            crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
    }
    return crc;
}

// Canonical COBS encode (each block: code byte = run+1, then the run;
// a message ending on a zero or a full 254-run gets a final 0x01 block).
function _cobsEncode(src) {
    const out = [];
    let blockStart = 0, code = 1;
    out.push(0);   // placeholder for the first code byte
    for (let i = 0; i < src.length; i++) {
        if (src[i] === 0) {
            out[blockStart] = code;
            blockStart = out.length; out.push(0); code = 1;
        } else {
            out.push(src[i]); code++;
            if (code === 0xFF) {
                out[blockStart] = code;
                blockStart = out.length; out.push(0); code = 1;
            }
        }
    }
    out[blockStart] = code;
    return Uint8Array.from(out);
}

// COBS decode — null on malformed input.
function _cobsDecode(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const code = src[i++];
        if (code === 0 || i + code - 1 > src.length) return null;
        for (let j = 1; j < code; j++) out.push(src[i++]);
        if (code !== 0xFF && i < src.length) out.push(0);
    }
    return Uint8Array.from(out);
}

// Wrap one outbound message (ArrayBuffer or Uint8Array) in the envelope.
function _serialEnvelope(msg) {
    const bytes = msg instanceof Uint8Array ? msg : new Uint8Array(msg);
    const withCrc = new Uint8Array(bytes.length + 1);
    withCrc.set(bytes);
    withCrc[bytes.length] = _crc8(bytes);
    const body = _cobsEncode(withCrc);
    const out  = new Uint8Array(body.length + 3);
    out[0] = 0x00; out[1] = 0xA5;
    out.set(body, 2);
    out[out.length - 1] = 0x00;
    return out;
}

// -------------------------------------------------------------------
// _SerialLink — wraps a Web Serial port behind the same surface the
// Arduino class uses of a WebSocket: send(buf) / close() and the
// onopen / onclose / onerror / onmessage handler slots (plus onlog for
// the sketch's Serial.print text). Serial has no CONNECTED event on
// the board side, so after opening we probe with a HELLO frame every
// 500 ms until the first valid envelope arrives — the board answers a
// HELLO request with its full HELLO → announce → SYNC_COMPLETE sync
// even if it never noticed the previous page go away.
// -------------------------------------------------------------------
class _SerialLink {
    constructor(port, opts = {}) {
        this.port      = port;
        this.onopen    = null;
        this.onclose   = null;
        this.onerror   = null;
        this.onmessage = null;
        this.onlog     = null;

        // takeover: probe carries the "switch a WiFi board to USB" flag (only
        // when a picker gesture authorised it). key: board-identity key, sent
        // as a CMD_AUTH frame in the probe loop when set.
        this._takeover = !!opts.takeover;
        this._key      = opts.key || null;

        this._writer = null;
        this._reader = null;
        this._closed = false;
        this._probeTimer = null;
        this._noReplyTimer = null;
        this._sawReply = false;

        // Envelope decoder state: 0 = text, 1 = just saw 0x00, 2 = in frame.
        this._state = 0;
        this._frame = [];
        this._text  = [];
    }

    async open() {
        // A predecessor link on this port may still be closing — wait it out.
        if (this.port._pardaloteClosing) {
            await this.port._pardaloteClosing.catch(() => {});
            this.port._pardaloteClosing = null;
        }
        await this.port.open({ baudRate: 115200 });
        this._writer = this.port.writable.getWriter();
        this._readPromise = this._readLoop();   // deliberately not awaited here
        if (this.onopen) this.onopen();
        // Probe until the board answers (it may be rebooting — opening the
        // port toggles DTR, which resets many boards). Each tick sends the key
        // first (if set) then the HELLO probe carrying the takeover flag, so a
        // board that DTR-reset into WiFi-listen mode still sees both after it
        // comes back up.
        this._probeTimer = setInterval(() => this._probe(), 500);
        this._probe();
        // One-time "no response yet" hint if nothing answers within the grace
        // window (keep probing — an ESP32 may still be rebooting).
        this._noReplyTimer = setTimeout(() => {
            if (this._sawReply || this._closed) return;
            if (this.onlog) this.onlog(
                'No response from the board over USB yet — it may still be booting, ' +
                'may not be running a Pardalote sketch, or may be WiFi-only ' +
                '(begin(PARDALOTE_WIFI) boards do not accept USB).');
        }, 4500);
    }

    _probe() {
        try {
            if (this._key) this.send(encodeFrame(CMD_AUTH, 0, [], this._key));
            this.send(encodeFrame(CMD_HELLO, 0, this._takeover ? [1] : []));
        } catch (_) {}
    }

    async _readLoop() {
        try {
            this._reader = this.port.readable.getReader();
            for (;;) {
                const { value, done } = await this._reader.read();
                if (done) break;
                if (value) this._feed(value);
            }
        } catch (_) {
            // device lost mid-read — fall through to the close path
        } finally {
            try { if (this._reader) this._reader.releaseLock(); } catch (_) {}
            this._reader = null;
            if (!this._closed) {
                this._teardown();
                if (this.onclose) this.onclose({ code: 0 });
            }
        }
    }

    _feed(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            switch (this._state) {
                case 0:   // text — the sketch's Serial.print output
                    if (b === 0x00)      { this._flushText(); this._state = 1; }
                    else if (b === 0x0A) { this._flushText(); }
                    else if (b !== 0x0D) { this._text.push(b); }
                    break;
                case 1:   // just consumed a delimiter
                    if (b === 0xA5)      { this._state = 2; this._frame.length = 0; }
                    else if (b !== 0x00) {
                        this._state = 0;
                        if (b === 0x0A)      { this._flushText(); }
                        else if (b !== 0x0D) { this._text.push(b); }
                    }
                    break;
                case 2:   // inside an envelope
                    if (b === 0x00) { this._envelopeDone(); this._state = 1; }
                    else            { this._frame.push(b); }
                    break;
            }
        }
    }

    _flushText() {
        if (!this._text.length) return;
        const line = new TextDecoder().decode(Uint8Array.from(this._text));
        this._text.length = 0;
        if (this.onlog && line.trim().length) this.onlog(line);
    }

    _envelopeDone() {
        const decoded = _cobsDecode(Uint8Array.from(this._frame));
        this._frame.length = 0;
        if (!decoded || decoded.length < 1) return;
        const msg = decoded.subarray(0, decoded.length - 1);
        if (_crc8(msg) !== decoded[decoded.length - 1]) return;   // corrupted — drop, stay synced
        this._sawReply = true;
        this._stopProbe();   // the board is talking — stop knocking
        if (this.onmessage && msg.length)
            this.onmessage({ data: msg.slice().buffer });
    }

    _stopProbe() {
        if (this._probeTimer)   { clearInterval(this._probeTimer); this._probeTimer = null; }
        if (this._noReplyTimer) { clearTimeout(this._noReplyTimer); this._noReplyTimer = null; }
    }

    // Restart probing on the SAME open port (no reopen — reopening risks another
    // DTR reset). Used when the board announced a reboot (CMD_REBOOT): resume
    // takeover-probing so a probe lands in the board's boot-watch window and it
    // switches straight back to serial.
    resumeProbe() {
        if (this._closed || this._probeTimer) return;   // gone, or already probing
        this._sawReply = false;
        this._probeTimer = setInterval(() => this._probe(), 500);
        this._probe();
    }

    send(buf) {
        if (!this._writer || this._closed) return;
        this._writer.write(_serialEnvelope(buf)).catch(() => {});
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        this._stopProbe();
        const reader = this._reader, writer = this._writer, port = this.port;
        this._writer = null;
        // Release both locks, then close the port. Stored on the port so
        // the NEXT link (auto-reconnect) can await it before reopening.
        port._pardaloteClosing = (async () => {
            try { if (reader) await reader.cancel().catch(() => {}); } catch (_) {}
            try { if (this._readPromise) await this._readPromise; } catch (_) {}   // read lock released
            try { if (writer) { writer.releaseLock(); } } catch (_) {}
            try { await port.close(); } catch (_) {}
        })();
    }

    _teardown() {
        this._stopProbe();
        try { if (this._writer) this._writer.releaseLock(); } catch (_) {}
        this._writer = null;
        // Best-effort close so a later auto-reconnect can reopen the port.
        try { this.port._pardaloteClosing = this.port.close().catch(() => {}); } catch (_) {}
    }
}

// -------------------------------------------------------------------
// Extension base class
//
// All JS extensions inherit from this. It provides:
//   - on(event, fn) / off(event, fn) — subscribe to extension events
//   - _emit(event, data)             — fire callbacks from handleMessage
//   - _reRegister()                  — override to restore state on reconnect
//   - handleMessage(frame)           — override to handle incoming frames
// -------------------------------------------------------------------
// Registry of extension classes by deviceId — each extension file calls
// registerExtensionType(<Class>) at its bottom. The core uses this to
// materialise browser objects for hardware the SKETCH created (the board
// announces them with CMD_SHARE; see Arduino._onShare).
const _extensionTypes = new Map();
function registerExtensionType(cls) { _extensionTypes.set(cls.deviceId, cls); }

class Extension {
    constructor() {
        this.arduino   = null;   // injected by arduino.add()
        this.logicalId = null;
        this._name     = null;   // binding name (arduino.<name>) — set by add()/share
        this._cbs      = {};

        // True for instances the BOARD created (sketch-side attach, announced
        // via CMD_SHARE). The board owns their lifecycle: the browser never
        // replays their state on reconnect, and they're dropped when
        // connect() switches to a different board.
        this._sharedFromBoard = false;
    }

    on(event, fn)  { (this._cbs[event] ||= []).push(fn); return this; }

    off(event, fn) {
        if (this._cbs[event])
            this._cbs[event] = this._cbs[event].filter(f => f !== fn);
        return this;
    }

    // One-shot listener — fires once, then removes itself.
    once(event, fn) {
        const wrap = (data) => { this.off(event, wrap); fn(data); };
        return this.on(event, wrap);
    }

    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    // "Servo 'pan'" / "Ultrasonic 2" — who is speaking, for warn/error events.
    _label() {
        const cls = this.constructor.name;
        return this._name != null ? `${cls} '${this._name}'` : `${cls} ${this.logicalId ?? '?'}`;
    }

    // Report a problem with this device. Warnings route to the core's
    // 'warn' channel (arduino.on('warn', …); console fallback when nobody
    // listens). Errors additionally fire 'error' on THIS instance, so
    // device-level code can react — an instance listener also counts as
    // "handled" and suppresses the console fallback.
    _warn(message) {
        if (this.arduino) this.arduino._notify('warn', this._label(), message);
        else console.warn(`${this._label()}: ${message}`);
        return this;
    }

    _error(message) {
        const local = (this._cbs['error'] || []).length > 0;
        if (local) this._emit('error', { message });
        if (this.arduino) this.arduino._notify('error', this._label(), message, local);
        else if (!local) console.error(`${this._label()}: ${message}`);
        return this;
    }

    _reRegister()       {}
    handleMessage(frame) {}

    // Wipe board-specific state when the user calls arduino.connect() to
    // switch sessions. Preserve user-tuned configuration. Default is a no-op;
    // extensions override as needed.
    _reset() {}
}

// -------------------------------------------------------------------
// Pin — a listening handle for one pin, created via arduino.pin(ref).
//
// Speaks the same grammar as the device extensions:
//   pin.on('change', ({ value, pin }) => …)   input readings past the
//                                             threshold AND output writes
//                                             from any client or the sketch
//   pin.off('change', fn)                     unsubscribe (fn omitted: all)
//   pin.setReadInterval(ms) / setReadThreshold(t)
//   pin.value                                 the mirrored value
//   pin.read()/.write()/.mode()               conveniences over the verbs
//
// `ref` may be a number or an alias string. Alias handles resolve
// LAZILY: pin('A0') created before connect() holds the name and starts
// working when the board's alias table arrives with HELLO — no more
// "call it inside on('ready')" footgun for listeners. Handles persist
// across connect() to a new board (listeners survive, like extensions);
// their polls are re-established on the new board's sync.
// -------------------------------------------------------------------
class Pin {
    constructor(arduino, ref) {
        this.arduino  = arduino;
        this._ref     = ref;
        this._cbs     = {};
        this._pending = null;   // deferred intents while the alias can't resolve
    }

    // Resolved pin number, or null while an alias awaits the board's table.
    get number() {
        try { return this.arduino._resolvePin(this._ref); }
        catch (_) { return null; }
    }

    // Mirrored value: last polled reading, else last known output state, else 0.
    get value() {
        const n = this.number;
        if (n === null) return 0;
        const read = this.arduino._reads.get(n);
        if (read && read.value !== null) return read.value;
        return this.arduino._pinValues.get(n) ?? 0;
    }

    on(event, fn) {
        (this._cbs[event] ||= []).push(fn);
        if (event === 'change') this._ensurePoll();
        return this;
    }

    off(event, fn) {
        const list = this._cbs[event];
        if (!list) return this;
        if (fn) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
        else    delete this._cbs[event];
        return this;
    }

    // One-shot listener — fires once, then removes itself.
    once(event, fn) {
        const wrap = (data) => { this.off(event, wrap); fn(data); };
        return this.on(event, wrap);
    }

    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    // 'change' on an input pin needs a poll running; outputs get their
    // changes from write broadcasts, and pins something else is already
    // polling (this page, another browser, or the sketch) need nothing.
    // Unresolved or pre-sync handles do nothing here — _onSyncComplete
    // re-runs this for every handle with listeners once the board's alias
    // table AND pin modes are known, so the right read kind is chosen.
    _ensurePoll() {
        const n = this.number;
        if (n === null) return;
        const mode = this.arduino._pinModes.get(n);
        if (mode === OUTPUT) return;
        if (this.arduino._reads.has(n)) return;
        if (mode === ANALOG_INPUT_MODE) this.arduino.analogRead(n);
        else                            this.arduino.digitalRead(n);
    }

    // Per-pin poll config — delegates to the core (which re-registers a
    // live poll immediately); deferred if the alias can't resolve yet.
    setReadInterval(ms) {
        const n = this.number;
        if (n === null) (this._pending ||= {}).interval = ms;
        else this.arduino.setReadInterval(n, ms);
        return this;
    }

    setReadThreshold(t) {
        const n = this.number;
        if (n === null) (this._pending ||= {}).threshold = t;
        else this.arduino.setReadThreshold(n, t);
        return this;
    }

    // Conveniences over the Arduino-mirroring verbs (which remain the
    // documented way to DO things — see pinMode/digitalWrite/…Read).
    mode(m, interval, threshold) { this.arduino.pinMode(this._ref, m, interval, threshold); return this; }
    write(v)                     { this.arduino.digitalWrite(this._ref, v); return this; }
    read(interval, threshold) {
        const n = this.number;
        const mode = n !== null ? this.arduino._pinModes.get(n) : undefined;
        return (mode === ANALOG_INPUT_MODE)
            ? this.arduino.analogRead(this._ref, interval, threshold)
            : this.arduino.digitalRead(this._ref, interval, threshold);
    }

    // Alias table just arrived (HELLO) — flush config deferred while the
    // name couldn't resolve. Still unresolvable = wrong board for this
    // alias; report it on the warn channel and keep waiting.
    // (Deferred poll needs are handled in _onSyncComplete instead, once
    // pin modes are known too.)
    _aliasesReady() {
        if (!this._pending) return;
        if (this.number === null) {
            this.arduino._warn(`unknown pin alias "${this._ref}" for board "${this.arduino.board}"`);
            return;
        }
        const p = this._pending;
        this._pending = null;
        if (p.interval  !== undefined) this.setReadInterval(p.interval);
        if (p.threshold !== undefined) this.setReadThreshold(p.threshold);
    }
}

// -------------------------------------------------------------------
// Arduino class — core connection and protocol
// -------------------------------------------------------------------
class Arduino {
    static version = PARDALOTE_VERSION;

    constructor() {
        this.socket    = null;
        this.connected = false;  // true after HELLO received
        this.deviceIP  = null;

        // Transport: 'ws' (WebSocket, the default) or 'serial' (Web Serial —
        // see connectSerial()). The socket slot holds a WebSocket or a
        // _SerialLink; both expose the same handler surface.
        this._transportKind = 'ws';
        this._serialPort    = null;   // granted Web Serial port, kept for reconnects
        this._serialTakeover = false; // gesture authorised a WiFi→USB switch (one-shot)

        // Connection key — sent as the first frame after a WS socket opens, or
        // in the serial probe loop; see connect(ip, { key }) / connectSerial({ key }).
        this._key = null;

        // Reconnection state
        // Reconnects continue indefinitely (backoff capped at _maxReconnectDelay).
        // disconnect() sets _reconnectDisabled; connect() clears it.
        this._reconnectAttempts = 0;
        this._reconnectDelay    = 1000;    // base delay before first retry
        this._maxReconnectDelay = 30000;   // cap on per-attempt delay
        this._reconnectTimeout  = null;
        this._isReconnecting    = false;
        this._reconnectDisabled = false;

        // Outgoing message queue (ArrayBuffers)
        this._queue    = [];
        this._flushing = false;

        // Active periodic reads:
        // Map<pin, { cmd, interval, threshold, value, origin, passive }>
        // threshold 0 = board default (1 for digital, the ADC noise floor —
        // analogMax >> 8 — for analog). passive = the BOARD polls this pin
        // itself (sketch share() with an interval): we sent no registration
        // and replay none on reconnect.
        this._reads = new Map();

        // Per-pin read config set via setReadInterval()/setReadThreshold(),
        // before or after polling starts: Map<pin, { interval?, threshold? }>.
        // Consulted by digitalRead/analogRead when the args are omitted.
        this._readConfig = new Map();

        // Core pin state — tracked so _onSyncComplete can restore it after Arduino reset,
        // and updated from announce frames so multi-client sync stays correct.
        this._pinModes  = new Map();   // Map<pin, mode>  — set by pinMode() and incoming announce
        this._pinValues = new Map();   // Map<pin, value> — set by digitalWrite() and incoming announce

        // Provenance: who created each pin entry — 'browser' (this page called
        // pinMode/digitalWrite/…Read) or 'board' (the sketch share()d it and we
        // learned of it from an inbound frame). Each side is source of truth
        // for its own creations: on reconnect the browser replays only
        // browser-originated state; board-originated state is refreshed by the
        // board's own announce — and swept if the announce no longer mentions
        // it (new firmware). 'browser' is sticky: once this page expresses
        // intent about a pin, its state is replayed. _reads entries carry
        // their own read.origin (a browser can poll a board-shared pin).
        this._pinOrigins = new Map();  // Map<pin, 'browser'|'board'>
        this._pollOrigin = null;       // set by _maybeStartPollFor while it runs
        this._staleBoardPins = null;   // Set<pin> — board-origin pins awaiting re-announce

        // Board boot id from HELLO (0 = unknown / old firmware). A changed id
        // across a reconnect means the board rebooted — possibly with new
        // firmware — so board-created state (shared pins, sketch-created
        // extensions, retained messages) is dropped before the announce
        // repopulates whatever actually exists now.
        this._bootId = 0;

        // Board identity, alias table, and ADC range — populated from the HELLO handshake
        this.board    = 'unknown';
        this._aliases  = {};
        this.analogMax = 1023;   // safe default; overwritten by HELLO

        // Heartbeat — liveness is judged by the AGE OF THE LAST PONG.
        // A power-cycled board sends no FIN, and send() into a half-open
        // TCP connection doesn't throw (it just buffers), so without this
        // check the browser would sit "connected" until the rebooted
        // board's new TCP stack resets the stale connection.
        this._pingInterval  = null;
        this._lastPong      = 0;
        this._pingMs        = 3000;   // send a ping every 3 s
        this._pongTimeoutMs = 5000;   // declare the link dead if no pong for 5 s

        // Pin handles (see arduino.pin()): Map<number|aliasString, Pin>.
        // Permanent, like extension instances — listeners survive connect().
        this._pinHandles = new Map();

        // True after CMD_SYNC_COMPLETE; false during the announce phase.
        // Guards against write callbacks firing on announce state-sync frames.
        this._synced   = false;

        // Extensions: keyed by name and by deviceId
        this._extensions  = {};
        this._extByDevice = new Map();
        this._available   = new Set();  // deviceIds announced by Arduino
        this._nextId      = 0;

        // Actuator groups, keyed by name (see group())
        this._groups      = {};

        // Message channel: last received value per key, plus per-key watchers.
        // (Watchers are user subscriptions and survive connect(), like on(…);
        // the cached values are board state and are cleared in connect().)
        this.messages  = {};
        this._watchers = new Map();   // key → fn[]

        // Connection-level callbacks
        this._cbs = {};

        this.defaultInterval  = 200;   // min ms between updates (rate limit)
        this.defaultThreshold = 0;     // 0 = board default: 1 for digital,
                                       // the ADC noise floor for analog

        // PWM write throttle — the OUTBOUND counterpart to the read rate
        // limit above. analogWrite() driven from a slider or draw loop can
        // fire dozens of times a second; an unthrottled flood overruns a
        // slow board's inbound buffer (the UNO R4 WiFi's WiFiS3 link can't
        // drain it), so the queue grows, latency climbs, and the socket
        // eventually drops. This caps the send rate per pin: the first
        // write in a burst goes out immediately, further writes inside the
        // window are coalesced into one trailing send carrying the LATEST
        // value, so the resting position is never lost. Mirrors the servo /
        // neopixel throttle. 0 = off (send every value). ESP32 is fast
        // enough that the default is imperceptible; the UNO R4 needs it.
        this.writeThrottle  = 20;      // min ms between PWM sends per pin
        this.writeThreshold = 0;       // min value change worth sending (0 = all)
        this._pwmLastWrite  = new Map(); // Map<pin, ms>      — last send time
        this._pwmLastSent   = new Map(); // Map<pin, value>   — last value sent
        this._pwmPending     = new Map(); // Map<pin, timeoutId> — coalesced trailing send
    }

    // -------------------------------------------------------------------
    // Connection
    //
    //   connect(ip)                    — WebSocket, port 81
    //   connect(ip, 8080)              — WebSocket, custom port
    //   connect(ip, { key: 'k' })      — WebSocket + connection key: sent as
    //                                    the first frame; a board started with
    //                                    Pardalote.begin("k") refuses clients
    //                                    whose key doesn't match ('authFail').
    //   connectSerial(opts?)           — USB serial via Web Serial (Chrome/
    //                                    Edge). Call from a user gesture (a
    //                                    click); the browser shows a port
    //                                    picker. A previously granted port is
    //                                    reused without a picker; pass PROMPT
    //                                    ({ prompt: true }) to force one.
    //                                    A connect from a real user gesture (a
    //                                    click) authorises pulling a board off
    //                                    WiFi onto USB — even one that silently
    //                                    reuses a granted port. An automatic
    //                                    connect (page load, background tab) has
    //                                    no gesture, so a WiFi board answers
    //                                    'usbBusy' instead of switching.
    //                                    opts.key sets a board-identity key
    //                                    (see requireKey() on the board): a
    //                                    wrong key is refused with 'authFail'.
    // -------------------------------------------------------------------
    connect(ip, portOrOpts = 81) {
        const opts = (typeof portOrOpts === 'object' && portOrOpts !== null)
                   ? portOrOpts : { port: portOrOpts };
        this._transportKind = 'ws';
        this._key      = opts.key || null;
        this._serialTakeover = false;      // switching to WiFi ends any serial takeover authority
        this.deviceIP  = `ws://${ip}:${opts.port ?? 81}/`;
        this._reconnectAttempts = 0;
        this._reconnectDisabled = false;   // re-enable after an earlier disconnect()

        this._resetSession();

        // Cleanly detach and close the old socket so its events
        // cannot fire into the new session.
        this._closeSocket();

        this._connectSocket();
    }

    async connectSerial(opts = {}) {
        if (typeof navigator === 'undefined' || !('serial' in navigator)) {
            this._error('Web Serial is not supported in this browser — use Chrome or Edge, or connect over WiFi');
            return this;
        }
        // Takeover authority = the user deliberately asked for this connection,
        // i.e. there is transient user activation (a real click) as connectSerial
        // runs. That gesture is the consent to pull a WiFi board over to USB.
        // We capture it BEFORE any await (an await can expire the activation).
        // NB: it is NOT "did the picker appear" — a click that silently reuses an
        // already-granted port is still a genuine gesture and must authorise the
        // switch. A page-load / background auto-connect has no activation, so it
        // can reconnect a board already on serial but a WiFi-listening board will
        // refuse it (CMD_SERIAL_BUSY → 'usbBusy') rather than switch silently.
        const gesture = (navigator.userActivation)
                      ? navigator.userActivation.isActive
                      : false;
        let port = opts.port || null;
        let usedPicker = false;
        if (!port && !opts.prompt) {
            // Reuse a previously granted port (works without a user gesture,
            // so a returning visit can auto-connect a still-serial board).
            const granted = await navigator.serial.getPorts();
            if (granted.length === 1) port = granted[0];
        }
        if (!port) {
            try {
                port = await navigator.serial.requestPort();
                usedPicker = true;
            } catch (_) {
                this._error('no serial port selected');
                return this;
            }
        }

        this._transportKind = 'serial';
        this._serialPort = port;
        // A picker always implies a gesture; a reused port needs the activation
        // check above. Either way, a deliberate connect authorises the switch.
        this._serialTakeover = usedPicker || gesture;
        this._key      = opts.key || null;   // board-identity key (optional, both transports)
        this.deviceIP  = 'serial';
        this._reconnectAttempts = 0;
        this._reconnectDisabled = false;

        this._resetSession();
        this._closeSocket();
        this._connectSocket();
        return this;
    }

    // Fresh session — drop any pin-keyed state from a previous board.
    // Pin numbers (and the extensions Arduino announced) are board-specific,
    // so replaying them on a new device would target the wrong hardware.
    // Auto-reconnect goes through _connectSocket() directly and is unaffected.
    _resetSession() {
        this._pinModes.clear();
        this._pinValues.clear();
        this._pinOrigins.clear();
        this._staleBoardPins = null;
        this._bootId = 0;
        this._reads.clear();
        this._available.clear();
        this.messages = {};                                     // cached message values are board state
        this._queue = [];                                       // drop frames queued for the old board
        this._pwmCancelPending();                               // drop any coalesced PWM send aimed at the old board

        // Board-created (shared) objects belong to the previous board —
        // remove them entirely. The new board announces its own via
        // CMD_SHARE. Browser-created extensions persist and _reset().
        this._dropBoardCreated();

        Object.values(this._extensions).forEach(ext => ext._reset());

        // Cancel any pending auto-reconnect timer
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._isReconnecting = false;
    }

    // Remove everything the BOARD created: sketch-created (shared)
    // extensions, and pin state that originated from a sketch share().
    // Called from connect() (switching boards) and from _onHello when the
    // boot id changed (same IP, but the board rebooted — possibly with new
    // firmware, so its old shares may no longer exist). Whatever the new
    // board-run really has comes back via the announce that follows HELLO.
    // Browser-created state is untouched.
    _dropBoardCreated() {
        for (const [name, ext] of Object.entries(this._extensions)) {
            if (!ext._sharedFromBoard) continue;
            ext._reset();
            delete this._extensions[name];
            if (this[name] === ext) delete this[name];
            const list = this._extByDevice.get(ext.constructor.deviceId);
            if (list) {
                const i = list.indexOf(ext);
                if (i >= 0) list.splice(i, 1);
            }
        }

        // Board-originated pin state (sketch share()d pins and their
        // auto-polls). Reads keep their own origin — a poll the browser
        // explicitly asked for on a board-shared pin survives.
        for (const [pin, origin] of [...this._pinOrigins]) {
            if (origin !== 'board') continue;
            this._pinOrigins.delete(pin);
            this._pinModes.delete(pin);
            this._pinValues.delete(pin);
            const read = this._reads.get(pin);
            if (read && read.origin !== 'browser') this._reads.delete(pin);
        }
    }

    _closeSocket() {
        // Stop the current heartbeat FIRST. We null the socket's handlers below
        // (so a late close can't double-fire 'disconnect'), which also means the
        // onclose that normally calls _stopHeartbeat() won't fire — leaving the
        // old transport's heartbeat ticking into the next connection. On a
        // WiFi→USB switch that stale heartbeat fires "no pong" during the board's
        // reboot window and tears down the in-flight serial link (→ reconnect
        // churn). Stopping it here makes a switch clean.
        this._stopHeartbeat();
        if (!this.socket) return;
        const s = this.socket;
        this.socket    = null;
        this.connected = false;
        s.onopen    = null;
        s.onclose   = null;
        s.onerror   = null;
        s.onmessage = null;
        s.onlog     = null;   // _SerialLink only; harmless on a WebSocket
        try { s.close(); } catch (_) {}
    }

    _connectSocket() {
        if (this._isReconnecting) return;
        console.log(`Connecting to ${this.deviceIP}`);

        if (this._transportKind === 'serial') {
            this._connectSerialLink();
            return;
        }

        try {
            const socket = new WebSocket(this.deviceIP);
            this.socket = socket;
            socket.binaryType = 'arraybuffer';

            socket.onopen = () => {
                if (this.socket !== socket) return;   // stale — a newer socket took over
                this._isReconnecting = false;
                this._reconnectDelay = 1000;
                if (this._reconnectTimeout) {
                    clearTimeout(this._reconnectTimeout);
                    this._reconnectTimeout = null;
                }
                // A connection key goes out FIRST — before it checks out, the
                // board sends nothing and drops everything else we say.
                if (this._key)
                    socket.send(encodeFrame(CMD_AUTH, 0, [], this._key));
                console.log('WebSocket open — waiting for HELLO');
                this._emit('connect');
            };

            socket.onclose = (e) => {
                if (this.socket !== socket) return;   // stale — ignore
                this.connected = false;
                this._stopHeartbeat();
                console.log(`WebSocket closed (${e.code})`);
                this._emit('disconnect');
                this._scheduleReconnect();
            };

            socket.onerror = () => {
                if (this.socket !== socket) return;
                this.connected = false;
                this._stopHeartbeat();
            };

            socket.onmessage = (evt) => {
                if (this.socket !== socket) return;
                this._receive(evt.data);
            };

        } catch (e) {
            this._error(`WebSocket error: ${e.message || e}`);
            this._scheduleReconnect();
        }
    }

    // Serial counterpart of the WebSocket branch above — the link mimics
    // the WebSocket handler surface, so everything downstream (HELLO,
    // heartbeat, flush, reconnect backoff) is shared.
    _connectSerialLink() {
        // Takeover authority persists for the whole gesture-initiated session —
        // across auto-reconnects — so a board that reboots (e.g. an ESP32 DTR
        // reset, or a hardware reset while USB-connected) can be switched back to
        // serial without a fresh click. It's set ONLY by a real user gesture
        // (see connectSerial) and cleared on disconnect()/connect(), so a fresh
        // page load or a background tab still starts with no authority — a
        // silent auto-connect can't recapture a WiFi board.
        const takeover = this._serialTakeover;
        const link = new _SerialLink(this._serialPort, { takeover, key: this._key });
        this.socket = link;

        link.onopen = () => {
            if (this.socket !== link) return;   // stale — a newer link took over
            this._isReconnecting = false;
            this._reconnectDelay = 1000;
            if (this._reconnectTimeout) {
                clearTimeout(this._reconnectTimeout);
                this._reconnectTimeout = null;
            }
            console.log('Serial port open — probing for the board');
            this._emit('connect');
        };

        link.onclose = () => {
            if (this.socket !== link) return;
            this.connected = false;
            this._stopHeartbeat();
            console.log('Serial port closed');
            this._emit('disconnect');
            this._scheduleReconnect();
        };

        link.onmessage = (evt) => {
            if (this.socket !== link) return;
            this._receive(evt.data);
        };

        // The sketch's Serial.print output, line by line. With no listener
        // it goes to the console — students see their debug prints in the
        // browser without opening the IDE.
        link.onlog = (line) => {
            if ((this._cbs['log'] || []).length) this._emit('log', line);
            else console.log(`[board] ${line}`);
        };

        link.open().catch(async (e) => {
            if (this.socket !== link) return;
            // The port may have been unplugged and re-granted as a fresh
            // SerialPort object — re-acquire before the next attempt.
            try {
                const granted = await navigator.serial.getPorts();
                if (granted.length === 1) this._serialPort = granted[0];
            } catch (_) {}
            this._error(`serial open failed: ${e.message || e}`);
            this._scheduleReconnect();
        });
    }

    _scheduleReconnect() {
        if (this._isReconnecting || this._reconnectDisabled) return;
        this._isReconnecting = true;
        this._reconnectAttempts++;
        const delay = Math.round(Math.min(
            this._reconnectDelay * Math.pow(1.5, this._reconnectAttempts - 1),
            this._maxReconnectDelay
        ));
        // Log the first few attempts in full; after that go quiet so a long
        // outage doesn't flood the console. User code can subscribe to the
        // 'reconnecting' event for per-attempt updates.
        if (this._reconnectAttempts <= 10) {
            console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
        } else if (this._reconnectAttempts === 11) {
            console.log(`Reconnecting silently — subscribe to 'reconnecting' for per-attempt updates`);
        }
        this._emit('reconnecting', { attempt: this._reconnectAttempts, delay });
        this._reconnectTimeout = setTimeout(() => {
            this._isReconnecting = false;
            this._connectSocket();
        }, delay);
    }

    disconnect() {
        this._reconnectDisabled = true;   // suppress auto-reconnect until connect() is called again
        this._serialTakeover = false;     // a manual disconnect ends the gesture's takeover authority
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._isReconnecting = false;
        this._closeSocket();
    }

    // -------------------------------------------------------------------
    // Connection-level events: 'connect', 'disconnect', 'ready', 'announce',
    // 'warn', 'error' (see _notify), plus 'reconnecting', 'reboot', 'share',
    // 'message', 'change', 'frame', 'authFail' (board refused this client's
    // key — auto-reconnect stops), 'usbBusy' (serial only: the board is on
    // WiFi and needs a picker gesture to switch to USB — auto-reconnect stops),
    // and 'log' (serial transport only: the sketch's Serial.print output,
    // one line per event).
    // -------------------------------------------------------------------
    on(event, fn)  { (this._cbs[event] ||= []).push(fn); return this; }
    off(event, fn) {
        const list = this._cbs[event];
        if (!list) return this;
        if (fn) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
        else    delete this._cbs[event];
        return this;
    }

    // One-shot listener — fires once, then removes itself.
    once(event, fn) {
        const wrap = (data) => { this.off(event, wrap); fn(data); };
        return this.on(event, wrap);
    }

    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    // -------------------------------------------------------------------
    // Problem reporting — the 'warn' and 'error' events.
    //
    //   arduino.on('warn',  ({ source, message }) => showBanner(message));
    //   arduino.on('error', ({ source, message }) => showBanner(message));
    //
    // Every warning/error in the library funnels through here (extensions
    // route via Extension._warn/_error with their device as `source`), so
    // a page can surface problems in its UI instead of the console. When
    // NO listener is registered the message falls back to console.warn /
    // console.error — pages that never subscribe behave exactly as before.
    // `handledLocally` suppresses that fallback when an instance-level
    // 'error' listener already received the message.
    // -------------------------------------------------------------------
    _notify(level, source, message, handledLocally = false) {
        const listeners = this._cbs[level];
        if (listeners && listeners.length) {
            this._emit(level, { source, message });
        } else if (!handledLocally) {
            (level === 'error' ? console.error : console.warn)(
                source ? `${source}: ${message}` : message);
        }
        return this;
    }

    _warn(message, source = 'Pardalote')  { return this._notify('warn',  source, message); }
    _error(message, source = 'Pardalote') { return this._notify('error', source, message); }

    // -------------------------------------------------------------------
    // Sending
    // -------------------------------------------------------------------
    // send() has two forms:
    //   send(key, value, opts?) — a message (string key). See the message channel.
    //   send(frameOrArray)      — internal transport of encoded frame(s).
    // A string first arg is never a valid frame, so the two never collide.
    send(frameOrArray, value, opts) {
        if (typeof frameOrArray === 'string') {
            if (new TextEncoder().encode(frameOrArray).length > MAX_MESSAGE_KEY)
                this._warn(`message key "${frameOrArray}" exceeds ${MAX_MESSAGE_KEY} bytes — truncated`);
            this._queueFrame(encodeMessage(frameOrArray, value, opts || {}));
            return this;
        }
        const frames = Array.isArray(frameOrArray) ? frameOrArray : [frameOrArray];
        this._queue.push(...frames);
        if (this.connected && !this._flushing) this._flush();
    }

    _queueFrame(buf) {
        this._queue.push(buf);
        if (this.connected && !this._flushing) this._flush();
    }

    _flush() {
        if (!this.connected || this._flushing || this._queue.length === 0) return;
        this._flushing = true;
        try {
            const frames = this._queue.splice(0);
            if (this._cbs['frame'] && this._cbs['frame'].length) {
                for (const f of frames) {
                    const decoded = decodeFrame(f, 0);
                    if (decoded) this._emitFrame('out', decoded);
                }
            }
            this.socket.send(encodeBatch(frames));
        } catch (e) {
            this._error(`send failed: ${e.message || e}`);
        } finally {
            this._flushing = false;
        }
    }

    // -------------------------------------------------------------------
    // Message channel — user-defined key/value messages.
    //
    //   arduino.send('temp', 22.5);                    // infer type
    //   arduino.send('mode', 'idle', { retain: true, broadcast: true });
    //   arduino.watch('temp', (value, key, type) => …);
    //   arduino.on('message', ({ key, value, type }) => …);
    //   arduino.messages['mode'];                        // last received value
    // -------------------------------------------------------------------
    watch(key, fn) {
        if (!this._watchers.has(key)) this._watchers.set(key, []);
        this._watchers.get(key).push(fn);
        return this;
    }

    unwatch(key, fn) {
        const list = this._watchers.get(key);
        if (!list) return this;
        if (fn) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
        else    this._watchers.delete(key);
        return this;
    }

    // Frame monitor — fires for every frame in and out (decoded). Alias for
    // on('frame', fn); costs nothing until a listener is registered.
    monitor(fn) { return this.on('frame', fn); }

    _onMessage(frame) {
        const msg = decodeMessage(frame);
        if (!msg) return;
        this.messages[msg.key] = msg.value;
        const list = this._watchers.get(msg.key);
        if (list) list.forEach(fn => fn(msg.value, msg.key, msg.type));
        this._emit('message', msg);
    }

    _emitFrame(dir, frame) {
        const listeners = this._cbs['frame'];
        if (!listeners || !listeners.length) return;
        listeners.forEach(fn => fn({
            dir,
            cmd:     frame.cmd,
            cmdName: frameName(frame.target, frame.cmd),
            target:  frame.target,
            params:  frame.params,
            payload: frame.payload ? new Uint8Array(frame.payload) : null,
        }));
    }

    // -------------------------------------------------------------------
    // Receiving
    // -------------------------------------------------------------------
    _receive(buf) {
        let pos = 0;
        while (pos < buf.byteLength) {
            const frame = decodeFrame(buf, pos);
            if (!frame) break;
            this._dispatch(frame);
            pos += frame.totalLen;
        }
    }

    _dispatch(frame) {
        // Frame monitor — sees every inbound frame (guarded: no-op unless a
        // listener is registered).
        this._emitFrame('in', frame);

        // These are checked first — they carry no pin/device context.
        if (frame.cmd === CMD_HELLO)    { this._onHello(frame);    return; }
        if (frame.cmd === CMD_ANNOUNCE) { this._onAnnounce(frame); return; }
        if (frame.cmd === CMD_PONG)     { this._onPong();          return; }
        if (frame.cmd === CMD_AUTH)     { this._onAuthFail(frame); return; }
        if (frame.cmd === CMD_SERIAL_BUSY) { this._onUsbBusy();    return; }
        if (frame.cmd === CMD_REBOOT)   { this._onReboot();        return; }

        // Message channel — routed by cmd (the flags in the target high byte
        // can push it past RESERVED_START, so the range check would misroute).
        if (frame.cmd === CMD_MESSAGE)  { this._onMessage(frame);  return; }

        // Extension frames — routed by device ID.
        if (frame.target >= RESERVED_START) {
            this._routeExtension(frame);
            return;
        }

        // Core frames (target < RESERVED_START = pin number or 0).
        const pin = frame.target;

        // Sync-complete signal — all announce frames have arrived; fire 'ready'.
        if (frame.cmd === CMD_SYNC_COMPLETE) { this._onSyncComplete(); return; }

        // Incoming pin-state frames — from Arduino announce on connect, or
        // from Arduino sketches calling Pardalote.share(pin, mode). For input
        // modes we auto-start a default-interval poll so the browser starts
        // receiving values without a separate digitalRead/analogRead call.
        if (frame.cmd === CMD_PIN_MODE) {
            const mode = frame.params[0];
            this._pinModes.set(pin, mode);
            // Provenance: an inbound mode is board-originated — unless this
            // page already claimed the pin ('browser' is sticky; the announce
            // echoes back modes we set ourselves).
            if (!this._pinOrigins.has(pin)) this._pinOrigins.set(pin, 'board');
            this._staleBoardPins?.delete(pin);   // re-announced — not stale

            // [mode, interval, threshold]: the BOARD polls
            // this pin itself (sketch share() with an interval). Register a
            // passive entry — values arrive without us sending a READ, and
            // we replay nothing on reconnect (the board's poll outlives us).
            const boardInterval = frame.params.length > 1 ? frame.params[1] : 0;
            if (boardInterval > 0) {
                const cmd = (mode === ANALOG_INPUT_MODE) ? CMD_ANALOG_READ : CMD_DIGITAL_READ;
                const existing = this._reads.get(pin);
                if (!existing || existing.origin !== 'browser') {
                    this._reads.set(pin, {
                        cmd, interval: boardInterval,
                        threshold: frame.params[2] ?? 0,
                        value:     existing?.value ?? null,
                        origin: 'board', passive: true,
                    });
                }
            } else {
                this._maybeStartPollFor(pin, mode, undefined, 'board');
            }
            return;
        }
        if (frame.cmd === CMD_DIGITAL_WRITE) {
            this._pinValues.set(pin, frame.params[0]);
            // Post-announce: fire change events so all browsers stay in sync
            // (announce-phase state sync stays silent).
            if (this._synced) this._emitPinChange(pin, frame.params[0]);
            return;
        }

        // Core read response (CMD_DIGITAL_READ or CMD_ANALOG_READ).
        const value = frame.params[0];
        const read  = this._reads.get(pin);

        if (read) {
            const prev = read.value;
            read.value = value;
            // Announce-phase values (board seeding a new/reconnected client)
            // update the mirror silently — same rule as write callbacks.
            // _forceCallback (set in _onSyncComplete) makes the first
            // post-sync reading fire even if the value didn't change, so
            // callbacks re-sync with actual state after a reconnect.
            if (prev === null || value !== prev || read._forceCallback) {
                if (this._synced) {
                    read._forceCallback = false;
                    this._emitPinChange(pin, value);
                }
            }
        } else {
            // A reading for a poll we never registered (another client asked
            // for it, or a board seed) — cache it, but mark it
            // board-originated so we never replay or retain a poll this
            // page didn't request.
            this._reads.set(pin, { cmd: frame.cmd, interval: 0, threshold: 0,
                                   value, origin: 'board', passive: false });
        }
    }

    // Each tick: first judge liveness by how stale the last pong is,
    // then send the next ping. Detection worst case is roughly
    // _pongTimeoutMs + _pingMs (~8 s) after the board dies.
    _startHeartbeat() {
        this._stopHeartbeat();
        this._lastPong = Date.now();   // HELLO just arrived — link demonstrably alive
        this._pingInterval = setInterval(() => {
            if (Date.now() - this._lastPong > this._pongTimeoutMs) {
                this._warn(`connection lost — no pong for ${this._pongTimeoutMs} ms; reconnecting`);
                this._stopHeartbeat();
                this._closeSocket();   // detach + null the socket so a late
                                       // close event can't double-fire 'disconnect'
                this._emit('disconnect');
                this._scheduleReconnect();
                return;
            }
            try { this.socket.send(encodeFrame(CMD_PING, 0, [])); } catch (_) {}
        }, this._pingMs);
    }

    _stopHeartbeat() {
        clearInterval(this._pingInterval);
        this._pingInterval = null;
    }

    _onPong() {
        this._lastPong = Date.now();
    }

    // The board announced (over serial) that it just (re)booted — e.g. a reset
    // while USB-connected. The port is still open, so rather than wait for the
    // heartbeat to time out (which would reopen the port and DTR-reset the board
    // again), we resume takeover-probing on the same link. The board is opening
    // its boot-watch window; our probe lands in it and it switches straight back
    // to serial. Give the link a fresh liveness window so the heartbeat doesn't
    // fire mid-recovery; the HELLO that follows the switch restarts everything.
    _onReboot() {
        if (this._transportKind !== 'serial') return;
        this._lastPong = Date.now();
        if (this.socket && typeof this.socket.resumeProbe === 'function') this.socket.resumeProbe();
    }

    // A WiFi-active board that we probed over USB without a picker gesture:
    // it won't switch off WiFi for a silent (getPorts) connect. Tell the user
    // to reconnect with a gesture, and stop probing (no churn) — one click on
    // Connect raises the picker and authorises the switch.
    _onUsbBusy() {
        const message = 'this board is on WiFi — click Connect (which raises the ' +
                        'port picker) to switch it to USB';
        this._emit('usbBusy', { message });
        this._error(message);
        this.disconnect();   // sets _reconnectDisabled until the next connect()
    }

    // The board refused this client: CMD_AUTH [reason] arrives just before
    // it closes the socket. Reconnecting would only be refused again, so
    // auto-reconnect stops — the student gets one clear error, not a
    // silent retry loop that looks like a dead board.
    _onAuthFail(frame) {
        const reason  = frame.params[0] ?? 0;
        const message = reason === 2
            ? 'connection refused — wrong key for this board'
            : 'connection refused — this board requires a key: connectSerial({ key: "…" }) or connect(ip, { key: "…" })';
        this._emit('authFail', { reason, message });
        this._error(message);
        this.disconnect();   // sets _reconnectDisabled until the next connect()
    }

    _onHello(frame) {
        const major   = frame.params[0];
        const minor   = frame.params[1];

        // Version handshake — a protocol MAJOR mismatch means the two
        // sides cannot talk. Report it and stop before misinterpreting
        // frames; a MINOR difference is backward-compatible by definition.
        if (major !== PROTOCOL_MAJOR_SUPPORTED) {
            this._error(`firmware speaks protocol v${major}.${minor}; this pardalote.js ` +
                        `speaks v${PROTOCOL_MAJOR_SUPPORTED}.x — update ` +
                        (major > PROTOCOL_MAJOR_SUPPORTED ? 'pardalote.js' : 'the firmware'));
            this.disconnect();
            return;
        }
        const adcBits = frame.params[2] ?? 10;   // default 10 for firmware that omits it
        const bootId  = frame.params[3] ?? 0;    // 0 = firmware predates boot ids
        this.board    = frame.payload ? new TextDecoder().decode(frame.payload) : 'unknown';
        this._aliases  = BOARD_ALIASES[this.board] || {};
        this.analogMax = (1 << adcBits) - 1;

        // Alias table is now known — pin handles created with alias strings
        // before connect can resolve and flush their deferred config/polls.
        this._pinHandles.forEach(h => h._aliasesReady());

        // Boot-id check: a changed id means the board REBOOTED since we last
        // spoke to it (new firmware upload, reset button, power cycle) — its
        // old shares/objects may not exist any more, so drop everything
        // board-created before the announce repopulates the real state.
        // Same id = pure network reconnect: keep everything.
        const rebooted = this._bootId !== 0 && bootId !== 0 && bootId !== this._bootId;
        if (rebooted) {
            console.log('Pardalote: board rebooted (boot id changed) — dropping board-created state');
            this._dropBoardCreated();
            this.messages = {};        // retained messages died with the old run
            this._available.clear();   // re-populated by the announce
        }
        this._bootId = bootId;

        // Announce sweep (also covers firmware without boot ids): any pin we
        // believe is board-originated must be re-announced before
        // SYNC_COMPLETE, or it belonged to a previous board-run and is swept
        // in _onSyncComplete. The inbound CMD_PIN_MODE handler removes pins
        // from this set as their announce arrives.
        this._staleBoardPins = new Set();
        this._pinOrigins.forEach((origin, pin) => {
            if (origin === 'board') this._staleBoardPins.add(pin);
        });

        this.connected          = true;
        this._synced            = false;  // re-entering announce phase
        this._reconnectAttempts = 0;  // genuine connection established
        this._startHeartbeat();
        console.log(`Pardalote: connected to ${this.board}, protocol v${major}.${minor}, analogMax=${this.analogMax}`);
        if (rebooted) this._emit('reboot', { bootId });

        // Open the send queue so announce frames from extensions can be
        // received while we wait for CMD_SYNC_COMPLETE.
        // 'ready' is deferred until _onSyncComplete() — after all announce
        // frames have updated the local state maps.
        this._flush();
    }

    // Called when CMD_SYNC_COMPLETE arrives — all Arduino announce frames
    // have been received and local state maps are fully synced.
    // Now replay state to the Arduino (handles the Arduino-reset case) and
    // signal 'ready' to user code.
    _onSyncComplete() {
        // Sweep: board-originated pins the announce did NOT re-mention belong
        // to a previous board-run (firmware swapped, or a reboot on old
        // firmware without boot ids) — forget them, and stop their polls.
        // A running board re-announces its shares on every reconnect, and a
        // rebooted board re-runs setup() and re-shares, so anything missing
        // here really is gone.
        if (this._staleBoardPins) {
            this._staleBoardPins.forEach(pin => {
                this._pinOrigins.delete(pin);
                this._pinModes.delete(pin);
                this._pinValues.delete(pin);
                const read = this._reads.get(pin);
                if (read && read.origin !== 'browser') this._reads.delete(pin);
            });
            this._staleBoardPins = null;
        }

        // Replay BROWSER-originated pin configuration so Arduino has the
        // correct state if it just reset (announce would have sent nothing
        // for these in that case). If the Arduino was already running, the
        // frames are redundant but idempotent. Board-originated entries are
        // skipped — the board is source of truth for its own shares (the
        // announce we just processed IS that truth), and replaying them
        // would push a previous firmware's pin config onto a new one.
        this._pinModes.forEach((mode, pin) => {
            if (this._pinOrigins.get(pin) === 'board') return;
            this.send(encodeFrame(CMD_PIN_MODE, pin, [mode]));
        });
        this._pinValues.forEach((value, pin) => {
            if (this._pinOrigins.get(pin) === 'board') return;
            this.send(encodeFrame(CMD_DIGITAL_WRITE, pin, [value]));
        });

        // Re-register our periodic reads. The Arduino clears THIS CLIENT's
        // registrations on disconnect (per-client), so
        // they always need re-sending; only JS knows the interval/threshold,
        // and the announce path deliberately doesn't re-send a poll for an
        // entry that already exists (analogRead/digitalRead early-return on
        // a cached read). Passive entries are skipped — the BOARD owns those
        // polls (share() with an interval) and they survive on their own;
        // the announce re-created them above. Stale board polls were swept,
        // so nothing here targets a pin the current firmware doesn't share.
        // The mirror keeps its seeded value; _forceCallback makes the first
        // post-sync reading fire callbacks even if the value is unchanged,
        // keeping the UI in sync with actual state.
        this._reads.forEach((read, pin) => {
            read._forceCallback = true;
            if (!read.passive && read.interval > 0)
                this.send(encodeFrame(read.cmd, pin, [read.interval, read.threshold ?? 0]));
        });

        // Pin handles with 'change' listeners need a poll on this board —
        // alias table and pin modes are both known now, so the right read
        // kind is chosen; _ensurePoll is a no-op when a poll (ours, another
        // client's, or the board's own) already covers the pin.
        this._pinHandles.forEach(h => {
            if (!(h._cbs['change'] || []).length) return;
            if (h.number === null)
                this._warn(`pin handle "${h._ref}" — unknown alias for board "${this.board}"`);
            else h._ensurePoll();
        });

        // Let extensions restore their state.
        // Each extension's _reRegister() checks whether the Arduino announced
        // its state (running) or not (reset) and acts accordingly.
        // Board-created (shared) objects are skipped: the SKETCH owns their
        // lifecycle — after a board reset it recreates them itself, and the
        // announce we just processed re-synced any that survived.
        Object.values(this._extensions).forEach(ext => {
            if (!ext._sharedFromBoard) ext._reRegister();
        });

        this._synced = true;  // announce phase complete — write broadcasts now fire callbacks
        this._flush();
        this._emit('ready');
        console.log('Pardalote: ready');
    }

    _onAnnounce(frame) {
        this._available.add(frame.target);
        this._emit('announce', { deviceId: frame.target });
    }

    _routeExtension(frame) {
        // A sketch-created object — materialise it before instance routing.
        // CMD_SHARE's value is reserved across every extension device ID.
        if (frame.cmd === CMD_SHARE) { this._onShare(frame); return; }

        const exts = this._extByDevice.get(frame.target);
        if (!exts) {
            this._warn(`no extension registered for deviceId ${frame.target}`);
            return;
        }
        const instanceId = frame.params[0];
        const ext = exts.find(e => e.logicalId === instanceId);
        if (ext) {
            ext.handleMessage(frame);
        } else {
            this._warn(`no instance ${instanceId} for deviceId ${frame.target}`);
        }
    }

    // -------------------------------------------------------------------
    // CMD_SHARE — the sketch created a hardware object (e.g.
    // PardaloteServo.attach("pan", 9)). Materialise a browser instance of
    // the registered class for that deviceId and bind it as arduino.<name>,
    // exactly as arduino.add(name, new <Class>()) would have. The board
    // follows with the normal announce/state frames (ATTACH, WRITE, …),
    // which sync the new instance through the existing machinery — so the
    // result is indistinguishable from a browser-created object, and it
    // exists before 'ready' fires.
    //
    // Frame: [logicalId] + payload: UTF-8 name. The logical id is board-
    // assigned (from the top of the range down; add() assigns from 0 up).
    // -------------------------------------------------------------------
    _onShare(frame) {
        const deviceId = frame.target;
        const id       = frame.params[0];
        const name     = frame.payload ? new TextDecoder().decode(frame.payload) : '';
        if (!name) return;

        // Reconnect to a running board: the instance already exists —
        // reuse it (state re-syncs from the announce frames that follow).
        const exts     = this._extByDevice.get(deviceId);
        const existing = exts ? exts.find(e => e.logicalId === id) : null;
        if (existing) {
            existing._name = name;
            if (!existing._sharedFromBoard) {
                // A browser-created extension already holds this id — the two
                // allocation directions (browser 0-up, board top-down) have
                // met, i.e. the id space for this device is exhausted.
                this._warn(`the board created '${name}' with id ${id}, but a ` +
                           `browser-created extension already uses that id — too many ` +
                           `instances for deviceId ${deviceId}`);
                return;
            }
            if (this._extensions[name] !== existing) {
                this._extensions[name] = existing;
                this[name] = existing;
            }
            return;
        }

        const cls = _extensionTypes.get(deviceId);
        if (!cls) {
            this._warn(`the board created '${name}' (deviceId ${deviceId}), ` +
                       `but no extension file for that device is loaded — include it ` +
                       `(e.g. <script src="servo.js">) to use arduino.${name}`);
            return;
        }

        // Refuse names that would clobber the Arduino API itself
        // (e.g. a servo named "connect"). Extension re-binds are allowed —
        // last one wins, with a warning, same as add() overwriting.
        if ((name in this) && !this._extensions[name]) {
            this._warn(`the board created '${name}', but arduino.${name} ` +
                       `is part of the core API — rename it in the sketch`);
            return;
        }
        if (this._extensions[name]) {
            this._warn(`the board created '${name}' — replacing the existing arduino.${name}`);
        }

        const ext = new cls();
        ext.arduino          = this;
        ext.logicalId        = id;
        ext._name            = name;
        ext._sharedFromBoard = true;
        this._extensions[name] = ext;
        this[name] = ext;
        if (!this._extByDevice.has(deviceId)) this._extByDevice.set(deviceId, []);
        this._extByDevice.get(deviceId).push(ext);

        this._emit('share', { name, extension: ext });
    }

    // -------------------------------------------------------------------
    // Extension registration
    // -------------------------------------------------------------------
    add(name, extension) {
        extension.arduino  = this;
        // Skip ids already held by board-created objects (they allocate from
        // the top of the range down; add() from 0 up — this guard only
        // matters once the two meet).
        const taken = new Set();
        this._extByDevice.forEach(list => list.forEach(e => {
            if (e._sharedFromBoard) taken.add(e.logicalId);
        }));
        while (taken.has(this._nextId)) this._nextId++;
        extension.logicalId = this._nextId++;
        extension._name = name;
        this._extensions[name] = extension;
        this[name] = extension;  // shorthand: arduino.servo

        const deviceId = extension.constructor.deviceId;
        if (!this._extByDevice.has(deviceId)) this._extByDevice.set(deviceId, []);
        this._extByDevice.get(deviceId).push(extension);

        return this;
    }

    // -------------------------------------------------------------------
    // group(name, members)
    // Create a named group of actuators for coordinated control. `members`
    // maps channel names to extension instances:
    //   arduino.group('arm', { shoulder: arduino.s1, elbow: arduino.s2 });
    // group.write({...}) writes every member in ONE batched WebSocket message
    // so they move together; group.writeTimed({...}, ms) makes them arrive
    // together. Returns the Group (also at arduino[name]).
    // -------------------------------------------------------------------
    group(name, members) {
        const g = new Group(this, name, members);
        this._groups[name] = g;
        this[name] = g;   // shorthand: arduino.arm
        return g;
    }

    // ---- One-shot coordinated actions across named actuators ----------
    // write() / writeTimed() / gesture() at the arduino level are the "fire once,
    // hold nothing" forms of the same-named group methods. Keys are the actuator
    // names you passed to add(). Each runs through a TRANSIENT anonymous group
    // (nothing stored on the arduino) and RETURNS it, so .whenDone() / .stop()
    // chain. For a single actuator use its own write()/writeTimed()/gesture();
    // to drive a set repeatedly (polling, relay, scrubbing) hold a named group().

    // Build a transient anonymous group from a { name: … } spec: resolves each key
    // to a registered actuator, warns+skips unknowns. NOT stored; no shorthand.
    _anonGroup(spec, label) {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
            this._notify('warn', label, 'expects { name: … } keyed by actuator name');
            return null;
        }
        const members = {};
        for (const key of Object.keys(spec)) {
            const m = this._extensions[key];
            if (m) members[key] = m;
            else this._notify('warn', label, `no actuator '${key}'`);
        }
        return new Group(this, label, members);
    }

    // write({ name: value, … }) — write several actuators at once in ONE batched
    // message (same-series bus servos coalesce into one SyncWrite). Immediate move.
    //   arduino.write({ shoulder: 2048, base: 1600, wrist: 90 });
    write(values) {
        const g = this._anonGroup(values, 'write');
        return g ? g.write(values) : this;
    }

    // writeTimed({ name: value, … }, duration) — a coordinated timed move where
    // every actuator ARRIVES together after ~duration ms (default 1000).
    //   await arduino.writeTimed({ shoulder: 3000, elbow: 1200 }, 1500).whenDone();
    writeTimed(targets, duration = 1000) {
        const g = this._anonGroup(targets, 'writeTimed');
        return g ? g.writeTimed(targets, duration) : this;
    }

    // gesture({ name: segments, … }) — play a multi-channel timed motion in ONE
    // batched frame: every channel starts together and (via arrive-together
    // padding) finishes together. See the single-actuator gesture() for the
    // segment shape. opts.absolute forces the reference frame for all lanes.
    //   arduino.gesture({ shoulder: [{ by: 300, dur: 400, curve: 'easeOut' }],
    //                     wrist:    [{ to: 90,  dur: 250, curve: 'back'    }] });
    gesture(lanes, opts = {}) {
        const g = this._anonGroup(lanes, 'gesture');
        return g ? g.gesture(lanes, opts) : this;
    }

    // -------------------------------------------------------------------
    // Core API — mirrors Arduino's own function names where possible
    // -------------------------------------------------------------------

    // Resolve a pin reference to its Arduino pin number for THIS board.
    //   • number → passes through unchanged.
    //   • string alias ('A0', 'SDA', … — including the bare globals D13/A0/…,
    //     which are just strings equal to their name; see installPinGlobals)
    //     → looked up in this instance's alias table, so the same global D13
    //     maps to the right physical pin on each board / each Arduino()
    //     instance. A numeric string ('14') falls through to numeric parse.
    // Throws RangeError for unresolvable input so the call site fails
    // loudly instead of silently writing to pin 0.
    _resolvePin(pin) {
        if (typeof pin === 'number') return pin;
        if (pin in this._aliases) return this._aliases[pin];
        const n = parseInt(pin, 10);
        if (!isNaN(n)) return n;
        throw new RangeError(
            `Pardalote: unknown pin alias "${pin}" for board "${this.board}". ` +
            `Pin aliases are populated when the 'ready' event fires — call from inside arduino.on('ready', …) ` +
            `or pass a numeric pin instead.`
        );
    }

    pinMode(pin, mode, interval, threshold) {
        pin = this._resolvePin(pin);
        this._pinModes.set(pin, mode);   // stored for announce sync and _onSyncComplete replay
        this._pinOrigins.set(pin, 'browser');   // this page claims the pin — replayed on reconnect
        this.end(pin);                   // cancel any active periodic read before changing mode
        this.send(encodeFrame(CMD_PIN_MODE, pin, [mode]));
        // For input modes, auto-start polling. If `interval` / `threshold`
        // are given use them, otherwise the underlying digitalRead /
        // analogRead falls back to setReadInterval()/setReadThreshold()
        // values, then to defaultInterval (200 ms) / defaultThreshold
        // (0 = board default). OUTPUT modes never auto-poll.
        this._maybeStartPollFor(pin, mode, interval, 'browser', threshold);
        return this;
    }

    // Shared helper used by pinMode() and by the incoming CMD_PIN_MODE handler.
    // For input-type modes, kick off a periodic read at the given interval
    // (or defaultInterval if undefined). No-op for OUTPUT or unknown modes.
    // `origin` tags any read entry this creates ('board' when called from the
    // inbound handler — a sketch share()'s auto-poll — else 'browser'), via
    // _pollOrigin, which digitalRead/analogRead consult while it's set.
    _maybeStartPollFor(pin, mode, interval, origin = 'browser', threshold) {
        this._pollOrigin = origin;
        try {
            if (mode === ANALOG_INPUT_MODE) {
                this.analogRead(pin, interval, threshold);
            } else if (mode === INPUT || mode === INPUT_PULLUP || mode === INPUT_PULLDOWN) {
                this.digitalRead(pin, interval, threshold);
            }
        } finally {
            this._pollOrigin = null;
        }
    }

    digitalWrite(pin, value) {
        pin = this._resolvePin(pin);
        // Accept HIGH/LOW (1/0) or a boolean (true/false) — normalise to an
        // integer 0/1 so the frame carries an int param. A raw boolean would
        // otherwise be encoded as a float (encodeFrame keys off
        // Number.isInteger) and the board would misread the pin state.
        value = value ? 1 : 0;
        this._pinValues.set(pin, value);  // stored for announce sync and _onSyncComplete replay
        this._pinOrigins.set(pin, 'browser');   // this page claims the pin — replayed on reconnect
        this.send(encodeFrame(CMD_DIGITAL_WRITE, pin, [value]));
        return this;
    }

    // analogWrite(pin, value) — write a PWM duty (0–255).
    // Rate-limited per pin by writeThrottle (see the constructor): the first
    // write in a burst is sent immediately, rapid follow-ups (a slider drag,
    // a draw loop) are coalesced into a single trailing send that carries the
    // final value. Tune with setWriteThrottle()/setWriteThreshold(); set the
    // throttle to 0 to send every value (the old behaviour).
    analogWrite(pin, value) {
        pin = this._resolvePin(pin);
        this._pwmScheduleWrite(pin, Math.round(value));
        return this;
    }

    // Leading-edge-immediate, trailing-edge-coalesced scheduler. Keeps the
    // documented "individual writes flush immediately" feel for a single
    // write while capping a fast stream. The latest value always wins the
    // trailing slot, so the resting position is never dropped.
    _pwmScheduleWrite(pin, value) {
        if (this.writeThrottle <= 0) { this._pwmSend(pin, value); return; }
        const now  = Date.now();
        const wait = this.writeThrottle - (now - (this._pwmLastWrite.get(pin) || 0));
        if (wait > 0) {
            const t = this._pwmPending.get(pin);
            if (t) clearTimeout(t);
            this._pwmPending.set(pin, setTimeout(() => {
                this._pwmPending.delete(pin);
                this._pwmSend(pin, value);
            }, wait));
        } else {
            this._pwmSend(pin, value);
        }
    }

    _pwmSend(pin, value) {
        if (this.writeThreshold > 0 && this._pwmLastSent.has(pin) &&
            Math.abs(value - this._pwmLastSent.get(pin)) < this.writeThreshold) {
            return;
        }
        this.send(encodeFrame(CMD_ANALOG_WRITE, pin, [value]));
        this._pwmLastWrite.set(pin, Date.now());
        this._pwmLastSent.set(pin, value);
    }

    // Cancel every coalesced trailing send and forget the per-pin history.
    // Called on (re)connect so a value queued for the old board never lands
    // on the new one.
    _pwmCancelPending() {
        for (const t of this._pwmPending.values()) clearTimeout(t);
        this._pwmPending.clear();
        this._pwmLastWrite.clear();
        this._pwmLastSent.clear();
    }

    // setWriteThrottle(ms) — minimum ms between PWM sends on a pin (0 = off,
    //   send every value). Applies to all analogWrite() pins. Default 20.
    // setWriteThreshold(v) — minimum duty change worth sending (0 = send all).
    // Both chainable. Useful when driving analogWrite() from mouse movement
    // or a draw loop, especially on the UNO R4 WiFi.
    setWriteThrottle(ms)  { this.writeThrottle  = Math.max(0, ms); return this; }
    setWriteThreshold(v)  { this.writeThreshold = Math.max(0, v);  return this; }

    // digitalRead(pin, interval, threshold) — start/update a board-side watch.
    // digitalRead(pin)      — return cached value; no network traffic.
    // digitalRead(pin, END) — stop this browser's watch.
    // interval: minimum ms between updates to this browser (default:
    //   setReadInterval() value, else defaultInterval, 200 ms). Digital
    //   edges transmit immediately regardless — the interval never delays
    //   a button press; analog pins are sampled every 10 ms on the board
    //   and rate-limited per browser by the interval.
    // threshold: minimum change worth transmitting (default:
    //   setReadThreshold() value, else defaultThreshold; 0 = board default —
    //   1 for digital, the ADC noise floor for analog). Per-browser: other
    //   pages polling the same pin keep their own interval and threshold.
    // Calling again with the same settings just returns the cached value.
    // If the pin was previously registered as analogRead, that read is cancelled first.
    digitalRead(pin, interval, threshold) {
        return this._read(CMD_DIGITAL_READ, pin, interval, threshold);
    }

    // analogRead(pin, interval, threshold) — same contract as digitalRead().
    analogRead(pin, interval, threshold) {
        return this._read(CMD_ANALOG_READ, pin, interval, threshold);
    }

    // Shared implementation of digitalRead / analogRead.
    _read(cmd, pin, interval, threshold) {
        pin = this._resolvePin(pin);
        if (interval === END) { this.end(pin); return 0; }
        let read = this._reads.get(pin);
        if (read && read.cmd !== cmd) { this.end(pin); read = null; }
        // Fast path — nothing new requested: return the mirror.
        if (read && (interval  === undefined || read.interval  === interval)
                 && (threshold === undefined || read.threshold === threshold))
            return read.value ?? 0;
        const cfg = this._readConfig.get(pin);
        interval  ??= cfg?.interval  ?? this.defaultInterval;
        threshold ??= cfg?.threshold ?? this.defaultThreshold;
        if (!read) {
            read = { cmd, interval, threshold, value: null,
                     origin: this._pollOrigin ?? 'browser', passive: false };
            this._reads.set(pin, read);
        } else {
            read.interval  = interval;
            read.threshold = threshold;
            read.passive   = false;   // we now hold our own registration
            if (!this._pollOrigin) read.origin = 'browser';   // explicit user call claims the poll
        }
        this.send(encodeFrame(cmd, pin, [interval, threshold]));
        return read.value ?? 0;
    }

    // setReadInterval(pin, ms) / setReadThreshold(pin, t)
    // Set a pin's poll interval / change threshold directly — before polling
    // starts (stored, applied when the read registers) or while it runs
    // (re-registers immediately). threshold 0 = board default. Chainable.
    setReadInterval(pin, ms)  { return this._setReadConfig(pin, 'interval',  ms); }
    setReadThreshold(pin, t)  { return this._setReadConfig(pin, 'threshold', t);  }

    _setReadConfig(pin, key, value) {
        pin = this._resolvePin(pin);
        const cfg = this._readConfig.get(pin) || {};
        cfg[key] = value;
        this._readConfig.set(pin, cfg);
        const read = this._reads.get(pin);
        if (read) {
            // Live poll (ours or one we're passively following): register
            // our own settings with the board. Per-client on the board, so
            // this never disturbs another browser's poll.
            read[key] = value;
            if (!read.interval) read.interval = this.defaultInterval;   // was a passive cache entry
            read.threshold ??= this.defaultThreshold;
            read.passive = false;
            read.origin  = 'browser';
            this.send(encodeFrame(read.cmd, pin, [read.interval, read.threshold]));
        }
        return this;
    }

    // -------------------------------------------------------------------
    // pin(ref) — the handle for LISTENING to a pin. Same grammar as the
    // device extensions: on/off with object payloads, setRead* config.
    // The Arduino-mirroring verbs (digitalRead, digitalWrite, pinMode)
    // remain the way you DO things; the handle carries the invented
    // surface — events and per-pin configuration.
    //
    //   const knob = arduino.pin('A0');
    //   knob.on('change', ({ value }) => circle(value));
    //   knob.setReadInterval(25).setReadThreshold(4);
    //
    // Handles are cached (pin(9) twice → same object) and permanent:
    // listeners survive connect() to a new board, like device extensions.
    // Alias handles resolve lazily — arduino.pin('A0') works before
    // 'ready', even though the board's alias table hasn't arrived yet.
    // -------------------------------------------------------------------
    pin(ref) {
        let key;
        try { key = this._resolvePin(ref); }      // pin('A0') and pin(14) share a handle…
        catch (_) { key = String(ref); }          // …unresolvable alias: keyed by name for now
        let p = this._pinHandles.get(key);
        if (!p) { p = new Pin(this, ref); this._pinHandles.set(key, p); }
        return p;
    }

    // Deliver a pin-state change (input reading past threshold, or an
    // output write from any client/the sketch) to the 'change' event and
    // to every matching pin handle.
    _emitPinChange(pin, value) {
        this._emit('change', { pin, value });
        this._pinHandles.forEach(h => {
            if (h.number === pin) h._emit('change', { value, pin });
        });
    }

    // Stop periodic reads for a pin.
    end(pin) {
        pin = this._resolvePin(pin);
        this._reads.delete(pin);
        this.send(encodeFrame(CMD_END, pin, []));
        return this;
    }

    // Stop all active periodic reads — call this before switching boards.
    endAll() {
        this._reads.forEach((_, pin) => {
            this.send(encodeFrame(CMD_END, pin, []));
        });
        this._reads.clear();
        return this;
    }

    getStatus() {
        return {
            connected:         this.connected,
            isReconnecting:    this._isReconnecting,
            reconnectAttempts: this._reconnectAttempts,
            deviceIP:          this.deviceIP,
            availableExtensions: [...this._available]
        };
    }
}

// =====================================================================
// Group — a named collection of actuators for coordinated control.
//
// Naming mirrors the single actuators: write() = immediate, writeTimed() =
// arrive together in ~duration ms, whenDone() = awaitable completion.
//
// Layer 1: write() sends every member's value in a SINGLE batched WebSocket
// message (frames coalesced via arduino.send([...])). On the board they are
// parsed and applied back-to-back within one receive, so the members move
// together. read() polls/reports every member.
//
// Members must implement the group member adapter (_memberWrite + the
// memberValue getter) — currently Servo, BusServo and Stepper. Anything
// else raises a clear error at construction.
// =====================================================================
class Group {
    constructor(arduino, name, members) {
        this.arduino = arduino;
        this.name    = name;
        this.members = {};

        // Last-commanded value per member — the assumed "current" position for
        // writeTimed() distance/speed matching. Seeded from memberValue on first use.
        this._commanded = {};

        // Members involved in the most recent write()/writeTimed(), and that
        // move's duration — consumed by whenDone().
        this._lastMoved    = [];
        this._lastDuration = 0;

        if (!members || typeof members !== 'object' || Array.isArray(members)) {
            throw new TypeError(
                `Group '${name}': members must be an object like ` +
                `{ shoulder: arduino.s1, elbow: arduino.s2 }`);
        }
        for (const [key, m] of Object.entries(members)) {
            if (!m || typeof m._memberWrite !== 'function' || !('memberValue' in m)) {
                throw new TypeError(
                    `Group '${name}': member '${key}' is not a groupable actuator ` +
                    `(supported: Servo, BusServo, Stepper).`);
            }
            this.members[key] = m;
        }
    }

    // write({ name: value, ... }) — write all named members in ONE message.
    // The group counterpart of servo.write() / stepper.moveTo(): immediate,
    // each member at its own configured/default speed.
    //
    // Members that expose a hardware sync key (_memberSyncKey) and share it
    // with another member in the same call are coalesced into a single sync
    // frame (e.g. bus servos of one series → one Feetech SyncWrite packet, so
    // they latch together). Everything else uses _memberWrite. All resulting
    // frames still go out in one batched WebSocket message.
    write(values) {
        if (!values || typeof values !== 'object') return this;
        this._lastMoved    = [];
        this._lastDuration = 0;

        const buckets = new Map();   // syncKey → [[member, value], ...]
        const loose   = [];          // [[member, value], ...]
        for (const [key, v] of Object.entries(values)) {
            const m = this.members[key];
            if (!m) { this.arduino._notify('warn', `Group '${this.name}'`, `no member '${key}'`); continue; }
            if (typeof v === 'number') this._commanded[key] = Math.round(v);
            this._lastMoved.push(m);
            const sk = (typeof m._memberSyncKey === 'function') ? m._memberSyncKey() : null;
            if (sk) {
                if (!buckets.has(sk)) buckets.set(sk, []);
                buckets.get(sk).push([m, v]);
            } else {
                loose.push([m, v]);
            }
        }

        const frames = [];
        for (const entries of buckets.values()) {
            if (entries.length >= 2 && typeof entries[0][0]._memberSetEncode === 'function') {
                frames.push(...entries[0][0]._memberSetEncode(entries));   // one sync packet
            } else {
                for (const [m, v] of entries) frames.push(...m._memberWrite(v));
            }
        }
        for (const [m, v] of loose) frames.push(...m._memberWrite(v));

        if (frames.length) this.arduino.send(frames);   // single batched WebSocket message
        return this;
    }

    // writeTimed({ name: target, ... }, duration)
    // Coordinated move where all members ARRIVE together after ~`duration` ms.
    // The group counterpart of servo.writeTimed() / stepper.moveToTimed() —
    // same shape: targets first, duration in ms second.
    // Each actuator type does this its own way, via _memberMoveEncode():
    //   - bus servos: one SyncWrite with matched per-servo speeds;
    //   - PWM servos: one on-board interpolated SYNC_TIMED (shared duration);
    //   - steppers:  one SYNC_MOVE with board-computed matched speeds;
    // all coalesced into a single batched message.
    //
    // "Current" position is the last commanded value (seeded from memberValue).
    // For an accurate first move from an unknown pose, poll read() first or move
    // from a known start (center()/write()).
    //
    // Members without a timed-move hook move immediately.
    writeTimed(targets, duration = 1000) {
        if (!targets || typeof targets !== 'object') return this;
        this._lastMoved    = [];
        this._lastDuration = Math.max(0, duration);

        const buckets = new Map();   // syncKey → [[m, target, current], ...]
        const loose   = [];          // [[m, target], ...]
        for (const [key, raw] of Object.entries(targets)) {
            const m = this.members[key];
            if (!m) { this.arduino._notify('warn', `Group '${this.name}'`, `no member '${key}'`); continue; }
            const target  = Math.round(raw);
            const current = (this._commanded[key] !== undefined) ? this._commanded[key] : (m.memberValue || 0);
            this._commanded[key] = target;
            this._lastMoved.push(m);
            const sk = (typeof m._memberSyncKey === 'function') ? m._memberSyncKey() : null;
            if (sk && typeof m._memberMoveEncode === 'function') {
                if (!buckets.has(sk)) buckets.set(sk, []);
                buckets.get(sk).push([m, target, current]);
            } else {
                loose.push([m, target]);
            }
        }

        const frames = [];
        for (const entries of buckets.values()) {
            frames.push(...entries[0][0]._memberMoveEncode(entries, duration));   // per-type timing
        }
        for (const [m, target] of loose) frames.push(...m._memberWrite(target));

        if (frames.length) this.arduino.send(frames);
        return this;
    }

    // gesture({ name: segments, ... }, opts?)
    // Coordinated expressive motion — each named member plays its own SEGMENT
    // SCHEDULE (see the per-actuator gesture()), all pushed in ONE batched
    // message and played on the board's own clock. Lanes are per-member, so a
    // member's segments overlap its neighbours' → coordination and follow-
    // through. Uneven lanes are padded with a trailing hold so every member
    // still ARRIVES TOGETHER (the group counterpart of writeTimed()).
    //
    //   arm.gesture({
    //       shoulder: [{ by: 300, dur: 400, curve: 'easeOut'   },
    //                  { by:-300, dur: 600, curve: 'easeInOut' }],   // 1000 ms
    //       wrist:    [{ by:  20, dur: 250, curve: 'back'       }],   // 250 ms → padded to 1000
    //   });
    //   await arm.gesture({ ... }).whenDone();
    //
    // Each lane is relative by default (infers absolute from `to`, or opts.absolute).
    // Members without gesture support, and empty/unknown lanes, are skipped with a warn.
    // For a one-shot gesture without holding a named group, use arduino.gesture({…}).
    gesture(lanes, opts = {}) {
        if (!lanes || typeof lanes !== 'object') return this;
        this._lastMoved = [];

        // 1. Resolve lanes → per-member items; infer reference frame + total duration.
        const items = [];
        for (const [key, segs] of Object.entries(lanes)) {
            const m = this.members[key];
            if (!m) { this.arduino._notify('warn', `Group '${this.name}'`, `no member '${key}'`); continue; }
            if (typeof m._memberGestureEncode !== 'function' || typeof m._gestureBlock !== 'function') {
                this.arduino._notify('warn', `Group '${this.name}'`, `member '${key}' doesn't support gesture()`); continue;
            }
            if (!Array.isArray(segs) || segs.length === 0) {
                this.arduino._notify('warn', `Group '${this.name}'`, `lane '${key}' needs a non-empty array of segments`); continue;
            }
            const absolute = (opts.absolute !== undefined) ? !!opts.absolute : segs.some(s => s.to !== undefined);
            const total    = segs.reduce((n, s) => n + Math.max(1, Math.round(s.dur ?? 0)), 0);
            items.push({ m, segments: segs.slice(), total, absolute });
        }
        if (!items.length) return this;

        // 2. Pad short lanes with a trailing hold so all arrive together. Hold in
        //    place: relative → zero delta; absolute → the lane's last target.
        const maxTotal = items.reduce((mx, it) => Math.max(mx, it.total), 0);
        for (const it of items) {
            const padMs = maxTotal - it.total;
            if (padMs <= 0) continue;
            const last = it.segments[it.segments.length - 1];
            it.segments = it.segments.concat([ it.absolute
                ? { to: (last.to ?? it.m.memberValue ?? 0), dur: padMs, curve: 'linear' }
                : { by: 0, dur: padMs, curve: 'linear' } ]);
        }

        // 3. Bucket by actuator TYPE — one CMD_*_GESTURE frame per type, each
        //    carrying every member's channel block, all in one batched message.
        const buckets = new Map();   // deviceId → [[member, segments], ...]
        for (const it of items) {
            const dev = it.m.constructor.deviceId;
            if (!buckets.has(dev)) buckets.set(dev, []);
            buckets.get(dev).push([it.m, it.segments]);
            this._lastMoved.push(it.m);
        }

        const frames = [];
        for (const entries of buckets.values())
            frames.push(...entries[0][0]._memberGestureEncode(entries));
        if (frames.length) this.arduino.send(frames);   // single batched message
        this._lastDuration = maxTotal;
        return this;
    }

    // whenDone({ timeout }?) — Promise for the group's most recent
    // write()/writeTimed(). Resolves `true` when EVERY moved member reports it
    // actually ARRIVED (each actuator's 'done' — feedback-confirmed, not a
    // timer), or `false` on the safety timeout (dead servo / lost link).
    // Members arm their completion promise inside the move itself, so calling
    // whenDone() late is safe — already-finished members resolve immediately.
    //
    //   await arm.writeTimed({ shoulder: 45, elbow: 120 }, 1500).whenDone();
    //
    // timeout: ms before giving up (default max(duration × 2, 10000); 0 = wait
    // forever). Also accepts a bare number: whenDone(5000).
    whenDone(opts = {}) {
        const t = (typeof opts === 'number') ? opts : opts.timeout;
        const timeout = t ?? Math.max(this._lastDuration * 2, 10000);
        const waits = this._lastMoved.map(m => m._movePromise).filter(Boolean);
        if (!waits.length) return Promise.resolve(true);
        const done = Promise.all(waits).then(() => true);
        if (!timeout) return done;
        return Promise.race([
            done,
            new Promise(res => setTimeout(() => res(false), timeout)),
        ]);
    }

    // read()         — snapshot of each member's current value (from cache).
    // read(interval) — start polling every member at interval, return snapshot.
    // read(END)      — stop polling every member.
    read(interval) {
        if (interval !== undefined) {
            Object.values(this.members).forEach(m => m.read(interval));
        }
        return this.values();
    }

    // Current cached value of every member, keyed by channel name.
    values() {
        const out = {};
        for (const [key, m] of Object.entries(this.members)) out[key] = m.memberValue;
        return out;
    }

    // Halt every member's motion — the group counterpart of member.stop().
    // (To stop polling, use read(END), same as a single actuator.)
    stop() {
        Object.values(this.members).forEach(m => { if (typeof m.stop === 'function') m.stop(); });
        return this;
    }

    // home(duration?) — send every member home. Servos and bus servos move
    // to their stored home (timed if `duration` is given); steppers run
    // their homing routine (a routine has no duration — the number is
    // ignored by stepper.home()). NOT arrive-together: each member homes
    // at its own pace. whenDone() resolves when every member settles —
    // homing can be slow, so raise the timeout:
    //   await rig.home(1500).whenDone({ timeout: 30000 });
    home(duration) {
        this._lastMoved    = [];
        this._lastDuration = Math.max(0, duration || 0);
        for (const m of Object.values(this.members)) {
            if (typeof m.home !== 'function') continue;
            m.home(duration);
            this._lastMoved.push(m);
        }
        return this;
    }

    getState() {
        const out = {};
        for (const [key, m] of Object.entries(this.members)) {
            out[key] = (typeof m.getState === 'function') ? m.getState() : m.memberValue;
        }
        return { name: this.name, members: out };
    }
}
