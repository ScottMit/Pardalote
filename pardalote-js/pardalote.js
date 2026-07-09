// ==============================================================
// pardalote.js
// Arduino to JavaScript Binary WebSocket Communication
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

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
const ANALOG_INPUT   = 8;

// Digital values
const LOW  = 0;
const HIGH = 1;

// Pass as interval to stop a periodic read
const END = -1;

// Limit-switch ends — stepper.setLimitSwitch(LIMIT_MIN, pin) / (LIMIT_MAX, pin).
// Named to match the firmware's LIMIT_MIN/LIMIT_MAX constants.
const LIMIT_MIN = 0;
const LIMIT_MAX = 1;

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
    '200:10': 'NEO_INIT', '200:11': 'NEO_SET_PIXEL', '200:12': 'NEO_FILL',
    '200:13': 'NEO_CLEAR', '200:14': 'NEO_BRIGHTNESS', '200:15': 'NEO_SHOW',
    '201:20': 'SERVO_ATTACH', '201:21': 'SERVO_DETACH', '201:22': 'SERVO_WRITE',
    '201:23': 'SERVO_WRITE_MICROSECONDS', '201:24': 'SERVO_READ', '201:25': 'SERVO_ATTACHED',
    '201:26': 'SERVO_WRITE_TIMED', '201:27': 'SERVO_SYNC_TIMED', '201:28': 'SERVO_STOP',
    '201:29': 'SERVO_DONE', '201:84': 'SERVO_SET_LIMITS',
    '202:30': 'ULTRASONIC_ATTACH', '202:31': 'ULTRASONIC_DETACH',
    '202:32': 'ULTRASONIC_READ', '202:33': 'ULTRASONIC_SET_TIMEOUT',
    '203:40': 'MPU_ATTACH', '203:41': 'MPU_DETACH', '203:42': 'MPU_READ',
    '203:43': 'MPU_SET_ACCEL_RANGE', '203:44': 'MPU_SET_GYRO_RANGE', '203:45': 'MPU_CALIBRATE',
    '204:48': 'CAMERA_INIT', '204:49': 'CAMERA_SET_RES', '204:50': 'CAMERA_SET_QUALITY',
    '205:51': 'STEPPER_ATTACH', '205:52': 'STEPPER_DETACH', '205:53': 'STEPPER_MOVE_TO',
    '205:54': 'STEPPER_MOVE', '205:55': 'STEPPER_SET_MAX_SPEED', '205:56': 'STEPPER_SET_ACCEL',
    '205:57': 'STEPPER_RUN_SPEED', '205:58': 'STEPPER_STOP', '205:59': 'STEPPER_SET_POSITION',
    '205:60': 'STEPPER_ENABLE', '205:61': 'STEPPER_SET_LIMITS', '205:62': 'STEPPER_READ',
    '205:63': 'STEPPER_DONE', '205:64': 'STEPPER_HOME', '205:79': 'STEPPER_MOVE_TIMED',
    '205:80': 'STEPPER_SYNC_MOVE', '205:82': 'STEPPER_SET_SWITCH', '205:83': 'STEPPER_LIMIT',
    '205:85': 'STEPPER_SET_HOME', '205:87': 'STEPPER_HARD_STOP',
    '206:65': 'BUSSERVO_BUS_CONFIG', '206:66': 'BUSSERVO_ATTACH', '206:67': 'BUSSERVO_DETACH',
    '206:68': 'BUSSERVO_WRITE', '206:69': 'BUSSERVO_WRITE_SPEED', '206:70': 'BUSSERVO_SET_MODE',
    '206:71': 'BUSSERVO_TORQUE', '206:72': 'BUSSERVO_READ', '206:73': 'BUSSERVO_SET_LIMITS',
    '206:74': 'BUSSERVO_CALIBRATE', '206:75': 'BUSSERVO_SET_ID', '206:76': 'BUSSERVO_PING',
    '206:77': 'BUSSERVO_SCAN', '206:78': 'BUSSERVO_SYNC_WRITE', '206:81': 'BUSSERVO_DONE',
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
        console.warn(`Pardalote: message key "${key}" exceeds ${MAX_MESSAGE_KEY} bytes — truncated`);
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

    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    _reRegister()       {}
    handleMessage(frame) {}

    // Wipe board-specific state when the user calls arduino.connect() to
    // switch sessions. Preserve user-tuned configuration. Default is a no-op;
    // extensions override as needed.
    _reset() {}
}

// -------------------------------------------------------------------
// Arduino class — core connection and protocol
// -------------------------------------------------------------------
class Arduino {
    constructor() {
        this.socket    = null;
        this.connected = false;  // true after HELLO received
        this.deviceIP  = null;

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

        // Active periodic reads: Map<pin, { cmd, interval, value, callbacks[] }>
        this._reads = new Map();

        // Core pin state — tracked so _onSyncComplete can restore it after Arduino reset,
        // and updated from announce frames so multi-client sync stays correct.
        this._pinModes  = new Map();   // Map<pin, mode>  — set by pinMode() and incoming announce
        this._pinValues = new Map();   // Map<pin, value> — set by digitalWrite() and incoming announce

        // Board identity, alias table, and ADC range — populated from the HELLO handshake
        this.board    = 'unknown';
        this._aliases  = {};
        this.analogMax = 1023;   // safe default; overwritten by HELLO

        // Heartbeat
        this._pingInterval  = null;
        this._pongTimeout   = null;
        this._pingMs        = 3000;   // send a ping every 3 s
        this._pongTimeoutMs = 5000;   // force-disconnect if no pong within 5 s

        // Output-pin write callbacks: fired when CMD_DIGITAL_WRITE arrives post-sync.
        // Map<pin, fn[]> — keyed by pin number, populated via onWrite().
        this._writeCbs = new Map();

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

        this.defaultInterval = 200;
    }

    // -------------------------------------------------------------------
    // Connection
    // -------------------------------------------------------------------
    connect(ip, port = 81) {
        this.deviceIP = `ws://${ip}:${port}/`;
        this._reconnectAttempts = 0;
        this._reconnectDisabled = false;   // re-enable after an earlier disconnect()

        // Fresh session — drop any pin-keyed state from a previous board.
        // Pin numbers (and the extensions Arduino announced) are board-specific,
        // so replaying them on a new device would target the wrong hardware.
        // Auto-reconnect goes through _connectSocket() directly and is unaffected.
        this._pinModes.clear();
        this._pinValues.clear();
        this._reads.clear();
        this._writeCbs.clear();
        this._available.clear();
        this.messages = {};                                     // cached message values are board state
        this._queue = [];                                       // drop frames queued for the old board

        // Board-created (shared) objects belong to the previous board —
        // remove them entirely. The new board announces its own via
        // CMD_SHARE. Browser-created extensions persist and _reset().
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

        Object.values(this._extensions).forEach(ext => ext._reset());

        // Cancel any pending auto-reconnect timer
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._isReconnecting = false;

        // Cleanly detach and close the old socket so its events
        // cannot fire into the new session.
        this._closeSocket();

        this._connectSocket();
    }

    _closeSocket() {
        if (!this.socket) return;
        const s = this.socket;
        this.socket    = null;
        this.connected = false;
        s.onopen    = null;
        s.onclose   = null;
        s.onerror   = null;
        s.onmessage = null;
        try { s.close(); } catch (_) {}
    }

    _connectSocket() {
        if (this._isReconnecting) return;
        console.log(`Connecting to ${this.deviceIP}`);

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
            console.error('WebSocket error:', e);
            this._scheduleReconnect();
        }
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
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
        this._isReconnecting = false;
        this._closeSocket();
    }

    // -------------------------------------------------------------------
    // Connection-level events: 'connect', 'disconnect', 'ready', 'announce'
    // -------------------------------------------------------------------
    on(event, fn)  { (this._cbs[event] ||= []).push(fn); return this; }
    off(event, fn) {
        const list = this._cbs[event];
        if (!list) return this;
        if (fn) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
        else    delete this._cbs[event];
        return this;
    }
    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    // -------------------------------------------------------------------
    // Sending
    // -------------------------------------------------------------------
    // send() has two forms:
    //   send(key, value, opts?) — a message (string key). See the message channel.
    //   send(frameOrArray)      — internal transport of encoded frame(s).
    // A string first arg is never a valid frame, so the two never collide.
    send(frameOrArray, value, opts) {
        if (typeof frameOrArray === 'string') {
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
            console.error('Send failed:', e);
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

        // These three are checked first — they carry no pin/device context.
        if (frame.cmd === CMD_HELLO)    { this._onHello(frame);    return; }
        if (frame.cmd === CMD_ANNOUNCE) { this._onAnnounce(frame); return; }
        if (frame.cmd === CMD_PONG)     { this._onPong();          return; }

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
            this._maybeStartPollFor(pin, mode);
            return;
        }
        if (frame.cmd === CMD_DIGITAL_WRITE) {
            this._pinValues.set(pin, frame.params[0]);
            // Post-announce: fire write callbacks so all browsers stay in sync.
            if (this._synced) {
                const cbs = this._writeCbs.get(pin);
                if (cbs) cbs.forEach(fn => fn(frame.params[0], pin));
                this._emit('change', { pin, value: frame.params[0] });
            }
            return;
        }

        // Core read response (CMD_DIGITAL_READ or CMD_ANALOG_READ).
        const value = frame.params[0];
        const read  = this._reads.get(pin);

        if (read) {
            const prev = read.value;
            read.value = value;
            if (prev === null || value !== prev) {
                read.callbacks.forEach(fn => fn(value, pin));
                this._emit('change', { pin, value });
            }
        } else {
            this._reads.set(pin, { cmd: frame.cmd, interval: 0, value, callbacks: [] });
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this._pingInterval = setInterval(() => {
            try { this.socket.send(encodeFrame(CMD_PING, 0, [])); } catch (_) {}
            clearTimeout(this._pongTimeout);   // clear any orphaned timeout from the previous tick
            this._pongTimeout = setTimeout(() => {
                console.warn('Pardalote: pong timeout — forcing disconnect');
                const deadSocket = this.socket;
                this.connected = false;
                this._stopHeartbeat();
                this._emit('disconnect');
                this._scheduleReconnect();
                try { deadSocket.close(); } catch (_) {}  // best-effort, may linger
            }, this._pongTimeoutMs);
        }, this._pingMs);
    }

    _stopHeartbeat() {
        clearInterval(this._pingInterval);
        clearTimeout(this._pongTimeout);
        this._pingInterval = null;
        this._pongTimeout  = null;
    }

    _onPong() {
        clearTimeout(this._pongTimeout);
        this._pongTimeout = null;
    }

    _onHello(frame) {
        const major   = frame.params[0];
        const minor   = frame.params[1];
        const adcBits = frame.params[2] ?? 10;   // param added in protocol v1.0; default 10 for older firmware
        this.board    = frame.payload ? new TextDecoder().decode(frame.payload) : 'unknown';
        this._aliases  = BOARD_ALIASES[this.board] || {};
        this.analogMax = (1 << adcBits) - 1;
        this.connected          = true;
        this._synced            = false;  // re-entering announce phase
        this._reconnectAttempts = 0;  // genuine connection established
        this._startHeartbeat();
        console.log(`Pardalote: connected to ${this.board}, protocol v${major}.${minor}, analogMax=${this.analogMax}`);

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
        // Replay core pin configuration so Arduino has the correct state if
        // it just reset (announce would have sent nothing in that case).
        // If the Arduino was already running, these frames are redundant but
        // idempotent — the announce will have synced _pinModes/_pinValues to
        // the current Arduino state, so we send back exactly what it told us.
        this._pinModes.forEach((mode, pin) => {
            this.send(encodeFrame(CMD_PIN_MODE, pin, [mode]));
        });
        this._pinValues.forEach((value, pin) => {
            this.send(encodeFrame(CMD_DIGITAL_WRITE, pin, [value]));
        });

        // Re-register all active periodic reads.
        // The Arduino clears its action table on every disconnect, so these
        // always need to be re-sent regardless of whether it reset.
        // Reset cached value to null so the first post-reconnect reading
        // always fires callbacks, keeping the UI in sync with actual state.
        this._reads.forEach((read, pin) => {
            if (read.interval > 0) {
                read.value = null;
                this.send(encodeFrame(read.cmd, pin, [read.interval]));
            }
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
            console.warn(`No extension registered for deviceId ${frame.target}`);
            return;
        }
        const instanceId = frame.params[0];
        const ext = exts.find(e => e.logicalId === instanceId);
        if (ext) {
            ext.handleMessage(frame);
        } else {
            console.warn(`No instance ${instanceId} for deviceId ${frame.target}`);
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
            if (!existing._sharedFromBoard) {
                // A browser-created extension already holds this id — the two
                // allocation directions (browser 0-up, board top-down) have
                // met, i.e. the id space for this device is exhausted.
                console.warn(`Pardalote: the board created '${name}' with id ${id}, but a ` +
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
            console.warn(`Pardalote: the board created '${name}' (deviceId ${deviceId}), ` +
                         `but no extension file for that device is loaded — include it ` +
                         `(e.g. <script src="servo.js">) to use arduino.${name}`);
            return;
        }

        // Refuse names that would clobber the Arduino API itself
        // (e.g. a servo named "connect"). Extension re-binds are allowed —
        // last one wins, with a warning, same as add() overwriting.
        if ((name in this) && !this._extensions[name]) {
            console.warn(`Pardalote: the board created '${name}', but arduino.${name} ` +
                         `is part of the core API — rename it in the sketch`);
            return;
        }
        if (this._extensions[name]) {
            console.warn(`Pardalote: the board created '${name}' — replacing the existing arduino.${name}`);
        }

        const ext = new cls();
        ext.arduino          = this;
        ext.logicalId        = id;
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

    // -------------------------------------------------------------------
    // Core API — mirrors Arduino's own function names where possible
    // -------------------------------------------------------------------

    // Resolve a string alias ('A0', 'SDA', 'G32' …) to its pin number.
    // Plain numbers pass through unchanged.
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

    pinMode(pin, mode, interval) {
        pin = this._resolvePin(pin);
        this._pinModes.set(pin, mode);   // stored for announce sync and _onSyncComplete replay
        this.end(pin);                   // cancel any active periodic read before changing mode
        this.send(encodeFrame(CMD_PIN_MODE, pin, [mode]));
        // For input modes, auto-start polling. If `interval` is given use it,
        // otherwise the underlying digitalRead / analogRead falls back to
        // this.defaultInterval (200 ms). OUTPUT modes never auto-poll.
        this._maybeStartPollFor(pin, mode, interval);
        return this;
    }

    // Shared helper used by pinMode() and by the incoming CMD_PIN_MODE handler.
    // For input-type modes, kick off a periodic read at the given interval
    // (or defaultInterval if undefined). No-op for OUTPUT or unknown modes.
    _maybeStartPollFor(pin, mode, interval) {
        if (mode === ANALOG_INPUT) {
            this.analogRead(pin, interval);
        } else if (mode === INPUT || mode === INPUT_PULLUP || mode === INPUT_PULLDOWN) {
            this.digitalRead(pin, interval);
        }
    }

    digitalWrite(pin, value) {
        pin = this._resolvePin(pin);
        this._pinValues.set(pin, value);  // stored for announce sync and _onSyncComplete replay
        this.send(encodeFrame(CMD_DIGITAL_WRITE, pin, [value]));
        return this;
    }

    analogWrite(pin, value) {
        pin = this._resolvePin(pin);
        this.send(encodeFrame(CMD_ANALOG_WRITE, pin, [Math.round(value)]));
        return this;
    }

    // Returns the most recently received value from the Arduino.
    // digitalRead(pin, interval) — registers a periodic read at the given interval (ms).
    // digitalRead(pin)           — returns the cached value only; no network traffic.
    // digitalRead(pin, END)      — stops any active periodic read.
    // If the pin was previously registered as analogRead, that read is cancelled first.
    // digitalRead(pin, interval) — start/update periodic read at interval (ms).
    // digitalRead(pin)           — return cached value; start default poll if none running.
    // digitalRead(pin, END)      — stop any active periodic read.
    // Calling again with the same interval just returns the cached value.
    // If the pin was previously registered as analogRead, that read is cancelled first.
    digitalRead(pin, interval) {
        pin = this._resolvePin(pin);
        if (interval === END) { this.end(pin); return 0; }
        let read = this._reads.get(pin);
        if (read && read.cmd !== CMD_DIGITAL_READ) { this.end(pin); read = null; }
        if (read && (interval === undefined || read.interval === interval)) return read.value ?? 0;
        interval ??= this.defaultInterval;
        if (!read) {
            read = { cmd: CMD_DIGITAL_READ, interval, value: null, callbacks: [] };
            this._reads.set(pin, read);
            this.send(encodeFrame(CMD_DIGITAL_READ, pin, [interval]));
        } else {
            read.interval = interval;
            this.send(encodeFrame(CMD_DIGITAL_READ, pin, [interval]));
        }
        return read.value ?? 0;
    }

    // analogRead(pin, interval) — start/update periodic read at interval (ms).
    // analogRead(pin)           — return cached value; start default poll if none running.
    // analogRead(pin, END)      — stop any active periodic read.
    // Calling again with the same interval just returns the cached value.
    // If the pin was previously registered as digitalRead, that read is cancelled first.
    analogRead(pin, interval) {
        pin = this._resolvePin(pin);
        if (interval === END) { this.end(pin); return 0; }
        let read = this._reads.get(pin);
        if (read && read.cmd !== CMD_ANALOG_READ) { this.end(pin); read = null; }
        if (read && (interval === undefined || read.interval === interval)) return read.value ?? 0;
        interval ??= this.defaultInterval;
        if (!read) {
            read = { cmd: CMD_ANALOG_READ, interval, value: null, callbacks: [] };
            this._reads.set(pin, read);
            this.send(encodeFrame(CMD_ANALOG_READ, pin, [interval]));
        } else {
            read.interval = interval;
            this.send(encodeFrame(CMD_ANALOG_READ, pin, [interval]));
        }
        return read.value ?? 0;
    }

    // Register a callback fired whenever pin's value changes.
    // Can be called before or after digitalRead / analogRead.
    onChange(pin, callback) {
        pin = this._resolvePin(pin);
        let read = this._reads.get(pin);
        if (!read) {
            read = { cmd: CMD_DIGITAL_READ, interval: this.defaultInterval, value: null, callbacks: [] };
            this._reads.set(pin, read);
            this.send(encodeFrame(CMD_DIGITAL_READ, pin, [read.interval]));
        }
        read.callbacks.push(callback);
        return this;
    }

    // Register a callback fired whenever an output pin's value changes.
    // The callback receives (value, pin) — value is HIGH (1) or LOW (0).
    // Callbacks fire for writes from any connected browser (including this one),
    // but only after the announce phase is complete (not during state sync).
    onWrite(pin, callback) {
        pin = this._resolvePin(pin);
        if (!this._writeCbs.has(pin)) this._writeCbs.set(pin, []);
        this._writeCbs.get(pin).push(callback);
        return this;
    }

    // Remove all onWrite callbacks for a pin.
    offWrite(pin) {
        pin = this._resolvePin(pin);
        this._writeCbs.delete(pin);
        return this;
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
            if (!m) { console.warn(`Group '${this.name}': no member '${key}'`); continue; }
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
            if (!m) { console.warn(`Group '${this.name}': no member '${key}'`); continue; }
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
