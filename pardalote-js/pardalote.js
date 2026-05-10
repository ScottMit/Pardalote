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
// Frame encoding
//
// params is a plain JS number array. Integer values encode as int32,
// any value with a decimal part encodes as float32. The TYPE_MASK
// records which params are float so the Arduino can decode correctly.
// -------------------------------------------------------------------
function encodeFrame(cmd, target, params = [], payload = null) {
    const payloadBytes = payload
        ? (payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload)
        : null;
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
// Extension base class
//
// All JS extensions inherit from this. It provides:
//   - on(event, fn) / off(event, fn) — subscribe to extension events
//   - _emit(event, data)             — fire callbacks from handleMessage
//   - _reRegister()                  — override to restore state on reconnect
//   - handleMessage(frame)           — override to handle incoming frames
// -------------------------------------------------------------------
class Extension {
    constructor() {
        this.arduino   = null;   // injected by arduino.add()
        this.logicalId = null;
        this._cbs      = {};
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
        this._reconnectAttempts    = 0;
        this._maxReconnectAttempts = 10;
        this._reconnectDelay       = 1000;
        this._maxReconnectDelay    = 30000;
        this._reconnectTimeout     = null;
        this._isReconnecting       = false;

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
        this._board    = 'unknown';
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
        if (this._isReconnecting) return;
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            return;
        }
        this._isReconnecting = true;
        this._reconnectAttempts++;
        const delay = Math.min(
            this._reconnectDelay * Math.pow(1.5, this._reconnectAttempts - 1),
            this._maxReconnectDelay
        );
        console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${this._reconnectAttempts})`);
        this._reconnectTimeout = setTimeout(() => {
            this._isReconnecting = false;
            this._connectSocket();
        }, delay);
    }

    disconnect() {
        this._reconnectAttempts = this._maxReconnectAttempts; // prevent auto-reconnect
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
    _emit(event, data) { (this._cbs[event] || []).forEach(fn => fn(data)); }

    // -------------------------------------------------------------------
    // Sending
    // -------------------------------------------------------------------
    send(frameOrArray) {
        const frames = Array.isArray(frameOrArray) ? frameOrArray : [frameOrArray];
        this._queue.push(...frames);
        if (this.connected && !this._flushing) this._flush();
    }

    _flush() {
        if (!this.connected || this._flushing || this._queue.length === 0) return;
        this._flushing = true;
        try {
            this.socket.send(encodeBatch(this._queue.splice(0)));
        } catch (e) {
            console.error('Send failed:', e);
        } finally {
            this._flushing = false;
        }
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
        // These three are checked first — they carry no pin/device context.
        if (frame.cmd === CMD_HELLO)    { this._onHello(frame);    return; }
        if (frame.cmd === CMD_ANNOUNCE) { this._onAnnounce(frame); return; }
        if (frame.cmd === CMD_PONG)     { this._onPong();          return; }

        // Extension frames — routed by device ID.
        if (frame.target >= RESERVED_START) {
            this._routeExtension(frame);
            return;
        }

        // Core frames (target < RESERVED_START = pin number or 0).
        const pin = frame.target;

        // Sync-complete signal — all announce frames have arrived; fire 'ready'.
        if (frame.cmd === CMD_SYNC_COMPLETE) { this._onSyncComplete(); return; }

        // Incoming pin-state frames from Arduino announce — sync local maps.
        if (frame.cmd === CMD_PIN_MODE) {
            this._pinModes.set(pin, frame.params[0]);
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
        this._board    = frame.payload ? new TextDecoder().decode(frame.payload) : 'unknown';
        this._aliases  = BOARD_ALIASES[this._board] || {};
        this.analogMax = (1 << adcBits) - 1;
        this.connected          = true;
        this._synced            = false;  // re-entering announce phase
        this._reconnectAttempts = 0;  // genuine connection established
        this._startHeartbeat();
        console.log(`Pardalote: connected to ${this._board}, protocol v${major}.${minor}, analogMax=${this.analogMax}`);

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
        Object.values(this._extensions).forEach(ext => ext._reRegister());

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
    // Extension registration
    // -------------------------------------------------------------------
    add(name, extension) {
        extension.arduino  = this;
        extension.logicalId = this._nextId++;
        this._extensions[name] = extension;
        this[name] = extension;  // shorthand: arduino.servo

        const deviceId = extension.constructor.deviceId;
        if (!this._extByDevice.has(deviceId)) this._extByDevice.set(deviceId, []);
        this._extByDevice.get(deviceId).push(extension);

        return this;
    }

    // -------------------------------------------------------------------
    // Core API — mirrors Arduino's own function names where possible
    // -------------------------------------------------------------------

    // Resolve a string alias ('A0', 'SDA', 'G32' …) to its pin number.
    // Plain numbers pass through unchanged. Unknown strings warn and pass through.
    _resolvePin(pin) {
        if (typeof pin === 'number') return pin;
        if (pin in this._aliases) return this._aliases[pin];
        const n = parseInt(pin, 10);
        if (!isNaN(n)) return n;
        console.warn(`Pardalote: unknown pin alias "${pin}" for board "${this._board}"`);
        return pin;
    }

    pinMode(pin, mode, interval) {
        pin = this._resolvePin(pin);
        this._pinModes.set(pin, mode);   // stored for announce sync and _onSyncComplete replay
        this.end(pin);                   // cancel any active periodic read before changing mode
        this.send(encodeFrame(CMD_PIN_MODE, pin, [mode]));
        if (interval !== undefined) {
            if (mode === ANALOG_INPUT)                                          this.analogRead(pin, interval);
            else if (mode === INPUT || mode === INPUT_PULLUP
                                    || mode === INPUT_PULLDOWN)                 this.digitalRead(pin, interval);
        }
        return this;
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
