// ==============================================================
// Pardalote.cpp
// PardaloteClass implementation.
// ==============================================================

#include "Pardalote.h"
#include "internal/led_matrix.h"

// -------------------------------------------------------------------
// Global singleton — _pardaloteSecrets lives in wifi_config.cpp.
// -------------------------------------------------------------------
PardaloteClass Pardalote;

// -------------------------------------------------------------------
// Constructor
// -------------------------------------------------------------------
PardaloteClass::PardaloteClass() {
    for (int i = 0; i < NUM_ACTIONS; i++) _actions[i].id = -1;
    memset(_corePinModes,  0xFF, sizeof(_corePinModes));
    memset(_corePinValues, 0,    sizeof(_corePinValues));
}

// -------------------------------------------------------------------
// begin() — called from setup()
// -------------------------------------------------------------------
void PardaloteClass::begin() {
    Serial.begin(115200);

    _platformInit();

    wifiConfigInit(_wifiStore);
    wifiConfigConnect(_wifiStore);

#ifdef PLATFORM_UNO_R4
    // WiFiS3 sets WL_CONNECTED before DHCP completes — wait for a real IP
    while (WiFi.localIP() == IPAddress(0, 0, 0, 0)) delay(100);
#endif

    Serial.print(F("Board: "));
    Serial.println(F(PARDALOTE_BOARD));
    Serial.print(F("IP: "));
    Serial.println(WiFi.localIP());

    _ws.begin();
    _ws.onEvent(_wsEventTrampoline);
    Serial.println(F("WebSocket server started on port 81"));

#ifdef PLATFORM_ESP32
    WiFi.setSleep(false);   // disable modem sleep — prevents latency on incoming frames
#endif
}

// -------------------------------------------------------------------
// run() — called from loop()
// -------------------------------------------------------------------
void PardaloteClass::run() {
    _ws.loop();
    _platformLoop();
    loopAll();

#ifdef PLATFORM_ESP32
    delay(1);   // yield to FreeRTOS idle task — prevents TG0WDT watchdog reset
#endif

    if (!anyConnected()) return;

    unsigned long now = millis();

    // Send deferred HELLO + announce to any newly connected client.
    for (int c = 0; c < MAX_WS_CLIENTS; c++) {
        if (!(_connectedClients & (1 << c))) continue;
        if (!_pendingHello[c] || now < _helloAfter[c]) continue;
        _pendingHello[c] = false;
        _sendHello(c);
        _announcePins(c);
        announceAll(c);
        _announceMessages(c);
        _sendSyncComplete(c);
    }

    // Broadcast periodic reads to all connected clients.
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (_actions[i].id == -1) continue;
        if (now - _actions[i].lastUpdate < _actions[i].interval) continue;
        _performRead(_actions[i].id, _actions[i].cmd);
        _actions[i].lastUpdate = now;
    }
}

// -------------------------------------------------------------------
// WebSocket trampoline + event handler
// -------------------------------------------------------------------
void PardaloteClass::_wsEventTrampoline(uint8_t num, WStype_t type,
                                        uint8_t* payload, size_t length) {
    Pardalote._handleWsEvent(num, type, payload, length);
}

void PardaloteClass::_handleWsEvent(uint8_t num, WStype_t type,
                                    uint8_t* payload, size_t length) {
    switch (type) {

        // Deduplicate state changes. The WebSocketsServer library on the
        // UNO R4's WiFiS3 stack is known to fire spurious DISCONNECTED
        // events for slots that were never connected (or that we already
        // processed a disconnect for). Processing them re-clears the action
        // table, re-fires extension disconnect hooks, and spams Serial —
        // enough overhead to cause visible lag in NeoPixel updates and
        // servo sweeps. Only act on actual state transitions.
        case WStype_DISCONNECTED:
            if (!(_connectedClients & (1 << num))) break;  // already disconnected
            _connectedClients  &= ~(1 << num);
            _pendingHello[num]  = false;
            if (!anyConnected()) {
                for (int i = 0; i < NUM_ACTIONS; i++) _actions[i].id = -1;
            }
            disconnectAll(num);
            Serial.print('['); Serial.print(num); Serial.println(F("] Disconnected"));
            break;

        case WStype_CONNECTED:
            if (_connectedClients & (1 << num)) break;     // already connected
            _connectedClients |= (1 << num);
            _pendingHello[num] = true;
            _helloAfter[num]   = millis() + HELLO_DELAY_MS;
            Serial.print('['); Serial.print(num); Serial.println(F("] Connected"));
            break;

        case WStype_BIN: {
            size_t pos = 0;
            while (pos < length) {
                Frame f = parseFrame(payload, pos, length);
                if (!f.valid) break;

                _emitFrame(PARDALOTE_FRAME_IN, f);   // frame monitor tap

                if (f.cmd == CMD_MESSAGE) {
                    // Routed by cmd, not target range — the flags in the
                    // target high byte can push it past RESERVED_START.
                    _handleMessageFrame(num, f, payload + pos);
                } else if (f.target < RESERVED_START) {
                    _handleCoreFrame(num, f);
                } else {
                    dispatchExtension(num, f.target, f.cmd, f.typeMask,
                                      f.params, f.nparams,
                                      f.payload, f.payloadLen);
                }
                pos += f.totalLen;
            }
            break;
        }

        default:
            break;
    }
}

// -------------------------------------------------------------------
// Core frame handler
// -------------------------------------------------------------------
void PardaloteClass::_handleCoreFrame(uint8_t clientNum, const Frame& f) {
    int pin = (int)f.target;

    switch (f.cmd) {

        case CMD_PIN_MODE: {
            if (f.nparams < 1) return;
            int pardaloteMode = (int)paramInt(f.params, 0);
            uint8_t arduinoMode;
            switch (pardaloteMode) {
                case MODE_INPUT:          arduinoMode = INPUT;        break;
                case MODE_OUTPUT:         arduinoMode = OUTPUT;       break;
                case MODE_INPUT_PULLUP:   arduinoMode = INPUT_PULLUP; break;
                case MODE_ANALOG_INPUT:   arduinoMode = INPUT;        break;
#ifdef PLATFORM_ESP32
                case MODE_INPUT_PULLDOWN: arduinoMode = INPUT_PULLDOWN; break;
#endif
                default:
                    Serial.print(F("Invalid pinMode: "));
                    Serial.println(pardaloteMode);
                    return;
            }
            pinMode(pin, arduinoMode);
            _unregisterAction(pin);
            if (pin >= 0 && pin < MAX_PIN_NUMBER)
                _corePinModes[pin] = (uint8_t)pardaloteMode;
            break;
        }

        case CMD_DIGITAL_WRITE: {
            if (f.nparams < 1) return;
            int32_t wval = paramInt(f.params, 0);
            digitalWrite(pin, (int)wval);
            if (pin >= 0 && pin < MAX_PIN_NUMBER)
                _corePinValues[pin] = (uint8_t)wval;
            // Echo back to all clients so every browser sees the new state.
            FrameBuilder fb;
            fb.begin(CMD_DIGITAL_WRITE, (uint16_t)pin);
            fb.addInt(wval);
            broadcastFrame(fb);
            break;
        }

        case CMD_ANALOG_WRITE:
            if (f.nparams < 1) return;
            analogWrite(pin, (int)paramInt(f.params, 0));
            break;

        case CMD_DIGITAL_READ:
            _performRead(pin, CMD_DIGITAL_READ);
            if (f.nparams > 0 && paramInt(f.params, 0) > 0) {
                int slot = _getSlot(pin);
                if (slot >= 0) {
                    _actions[slot] = {
                        (int16_t)pin, CMD_DIGITAL_READ,
                        millis(), (unsigned long)paramInt(f.params, 0)
                    };
                }
            }
            break;

        case CMD_ANALOG_READ:
            _performRead(pin, CMD_ANALOG_READ);
            if (f.nparams > 0 && paramInt(f.params, 0) > 0) {
                int slot = _getSlot(pin);
                if (slot >= 0) {
                    _actions[slot] = {
                        (int16_t)pin, CMD_ANALOG_READ,
                        millis(), (unsigned long)paramInt(f.params, 0)
                    };
                }
            }
            break;

        case CMD_END:
            _unregisterAction(pin);
            break;

        case CMD_PING: {
            FrameBuilder fb;
            fb.begin(CMD_PONG, 0x0000);
            sendFrame(clientNum, fb);
            break;
        }
    }
}

// -------------------------------------------------------------------
// Read a pin and broadcast the value to all connected clients.
// -------------------------------------------------------------------
void PardaloteClass::_performRead(int pin, uint8_t cmd) {
    int32_t val = (cmd == CMD_ANALOG_READ) ? analogRead(pin) : digitalRead(pin);

    FrameBuilder fb;
    fb.begin(cmd, (uint16_t)pin);
    fb.addInt(val);
    broadcastFrame(fb);
}

// -------------------------------------------------------------------
// HELLO + announce
// -------------------------------------------------------------------
void PardaloteClass::_sendHello(uint8_t clientNum) {
    FrameBuilder fb;
    fb.begin(CMD_HELLO, 0x0000);
    fb.addInt(PROTOCOL_VERSION_MAJOR);
    fb.addInt(PROTOCOL_VERSION_MINOR);
    fb.addInt(ADC_RESOLUTION_BITS);
    fb.addString(PARDALOTE_BOARD);
    sendFrame(clientNum, fb);
}

void PardaloteClass::_announcePins(uint8_t clientNum) {
    for (int pin = 0; pin < MAX_PIN_NUMBER; pin++) {
        if (_corePinModes[pin] == 0xFF) continue;

        FrameBuilder fm;
        fm.begin(CMD_PIN_MODE, (uint16_t)pin);
        fm.addInt(_corePinModes[pin]);
        sendFrame(clientNum, fm);

        if (_corePinModes[pin] == MODE_OUTPUT) {
            FrameBuilder fv;
            fv.begin(CMD_DIGITAL_WRITE, (uint16_t)pin);
            fv.addInt(_corePinValues[pin]);
            sendFrame(clientNum, fv);
        }
    }
}

void PardaloteClass::_sendSyncComplete(uint8_t clientNum) {
    FrameBuilder fb;
    fb.begin(CMD_SYNC_COMPLETE, 0x0000);
    sendFrame(clientNum, fb);
}

// -------------------------------------------------------------------
// Sharing pin state with the browser. See the API comments in
// Pardalote.h for the public-facing contract.
// -------------------------------------------------------------------
void PardaloteClass::share(uint8_t pin, uint8_t mode) {
    // Map Arduino's mode constants to Pardalote's protocol modes.
    // INPUT / OUTPUT / INPUT_PULLUP happen to align numerically with
    // MODE_INPUT / MODE_OUTPUT / MODE_INPUT_PULLUP — we map explicitly
    // so the mapping is auditable and any future divergence is caught.
    uint8_t pardaloteMode;
    switch (mode) {
        case INPUT:             pardaloteMode = MODE_INPUT;          break;
        case OUTPUT:            pardaloteMode = MODE_OUTPUT;         break;
        case INPUT_PULLUP:      pardaloteMode = MODE_INPUT_PULLUP;   break;
#if defined(PLATFORM_ESP32) && defined(INPUT_PULLDOWN)
        case INPUT_PULLDOWN:    pardaloteMode = MODE_INPUT_PULLDOWN; break;
#endif
        case MODE_ANALOG_INPUT: pardaloteMode = MODE_ANALOG_INPUT;   break;
        default: return;   // unrecognised — silently skip
    }

    // Cache so future client connects see the right state via announce.
    if (pin < MAX_PIN_NUMBER) _corePinModes[pin] = pardaloteMode;

    if (!anyConnected()) return;
    FrameBuilder fb;
    fb.begin(CMD_PIN_MODE, (uint16_t)pin);
    fb.addInt(pardaloteMode);
    broadcastFrame(fb);
}

void PardaloteClass::send(uint8_t pin, int value) {
    // Cache so future client connects see the right state via announce.
    if (pin < MAX_PIN_NUMBER) _corePinValues[pin] = (uint8_t)value;

    if (!anyConnected()) return;
    FrameBuilder fb;
    fb.begin(CMD_DIGITAL_WRITE, (uint16_t)pin);
    fb.addInt(value);
    broadcastFrame(fb);
}

// ===================================================================
// Message channel — user-defined key/value messages (CMD_MESSAGE).
// ===================================================================

// Public send() overloads. The key is a string, so these never collide
// with send(uint8_t pin, int value) — pins are numeric.
void PardaloteClass::send(const char* key, int value, uint8_t flags) {
    _emitMessage(MSG_TYPE_INT, flags, key, (int32_t)value, 0.0f, nullptr, 0);
}
void PardaloteClass::send(const char* key, double value, uint8_t flags) {
    _emitMessage(MSG_TYPE_FLOAT, flags, key, 0, (float)value, nullptr, 0);
}
void PardaloteClass::send(const char* key, bool value, uint8_t flags) {
    _emitMessage(MSG_TYPE_BOOL, flags, key, value ? 1 : 0, 0.0f, nullptr, 0);
}
void PardaloteClass::send(const char* key, char value, uint8_t flags) {
    _emitMessage(MSG_TYPE_CHAR, flags, key, (int32_t)(uint8_t)value, 0.0f, nullptr, 0);
}
void PardaloteClass::send(const char* key, const char* text, uint8_t flags) {
    _emitMessage(MSG_TYPE_TEXT, flags, key, 0, 0.0f,
                 (const uint8_t*)text, (uint16_t)strlen(text));
}
void PardaloteClass::sendBlob(const char* key, const uint8_t* data, uint16_t len, uint8_t flags) {
    _emitMessage(MSG_TYPE_BLOB, flags, key, 0, 0.0f, data, len);
}

// Build [header][param?][keyLen][key][value?] for a message frame.
void PardaloteClass::_buildMessageFrame(FrameBuilder& fb, uint8_t type, uint8_t flags,
        const char* key, uint8_t keyLen, int32_t intVal, float floatVal,
        const uint8_t* value, uint16_t valueLen) {
    fb.begin(CMD_MESSAGE, MSG_TARGET(type, flags));
    switch (type) {
        case MSG_TYPE_FLOAT: fb.addFloat(floatVal); break;
        case MSG_TYPE_INT:
        case MSG_TYPE_BOOL:
        case MSG_TYPE_CHAR:  fb.addInt(intVal);     break;
        default: break;   // TEXT / BLOB carry no param
    }
    fb.addByte(keyLen);
    fb.addBytes((const uint8_t*)key, keyLen);
    if ((type == MSG_TYPE_TEXT || type == MSG_TYPE_BLOB) && valueLen)
        fb.addBytes(value, valueLen);
}

// Sketch-originated send: retain if asked, then broadcast to every browser.
// A sketch's own watchers do NOT fire (that would echo your own send —
// same rule as pin send() not calling onChange locally).
void PardaloteClass::_emitMessage(uint8_t type, uint8_t flags, const char* key,
        int32_t intVal, float floatVal, const uint8_t* value, uint16_t valueLen) {
    if (!key) return;
    uint8_t keyLen = (uint8_t)strnlen(key, MAX_MESSAGE_KEY);

    if (flags & MSG_FLAG_RETAIN)
        _storeRetained(key, keyLen, type, intVal, floatVal, value, valueLen);

    if (!anyConnected()) return;
    FrameBuilder fb;
    _buildMessageFrame(fb, type, flags, key, keyLen, intVal, floatVal, value, valueLen);
    broadcastFrame(fb);
}

// Browser → board: decode, retain, deliver to watchers, relay if broadcast.
void PardaloteClass::_handleMessageFrame(uint8_t clientNum, const Frame& f, uint8_t* frameStart) {
    if (f.payloadLen < 1) return;
    uint8_t type   = MSG_TYPE(f.target);
    uint8_t flags  = MSG_FLAGS(f.target);
    uint8_t keyLen = f.payload[0];
    if ((uint16_t)1 + keyLen > f.payloadLen) return;

    const uint8_t* keyPtr = f.payload + 1;
    const uint8_t* valPtr = keyPtr + keyLen;
    uint16_t       valLen = f.payloadLen - 1 - keyLen;

    char keyBuf[MAX_MESSAGE_KEY + 1];
    uint8_t kl = keyLen > MAX_MESSAGE_KEY ? MAX_MESSAGE_KEY : keyLen;
    memcpy(keyBuf, keyPtr, kl);
    keyBuf[kl] = 0;

    Message m = {};
    m.key  = keyBuf;
    m.type = type;

    char textBuf[128];
    switch (type) {
        case MSG_TYPE_FLOAT:
            m.floatValue = (f.nparams > 0) ? paramFloat(f.params, 0) : 0.0f;
            break;
        case MSG_TYPE_INT:
        case MSG_TYPE_BOOL:
        case MSG_TYPE_CHAR:
            m.intValue = (f.nparams > 0) ? paramInt(f.params, 0) : 0;
            break;
        case MSG_TYPE_TEXT: {
            uint16_t n = valLen < sizeof(textBuf) - 1 ? valLen : sizeof(textBuf) - 1;
            memcpy(textBuf, valPtr, n);
            textBuf[n] = 0;
            m.text   = textBuf;
            m.length = valLen;
            break;
        }
        case MSG_TYPE_BLOB:
            m.blob   = valPtr;
            m.length = valLen;
            break;
    }

    if (flags & MSG_FLAG_RETAIN)
        _storeRetained(keyBuf, kl, type, m.intValue, m.floatValue, valPtr, valLen);

    _dispatchMessage(m);

    // Relay to the OTHER browsers (the board is the hub). Send the exact
    // received bytes; receivers process it as an ordinary inbound message.
    if (flags & MSG_FLAG_BROADCAST) {
        for (int c = 0; c < MAX_WS_CLIENTS; c++) {
            if (c != clientNum && (_connectedClients & (1 << c)))
                _ws.sendBIN((uint8_t)c, frameStart, f.totalLen);
        }
    }
}

void PardaloteClass::_dispatchMessage(const Message& m) {
    for (uint8_t i = 0; i < _watcherCount; i++) {
        if (_watchers[i].cb && strncmp(_watchers[i].key, m.key, MAX_MESSAGE_KEY) == 0)
            _watchers[i].cb(m);
    }
    if (_messageHandler) _messageHandler(m);
}

void PardaloteClass::_storeRetained(const char* key, uint8_t keyLen, uint8_t type,
        int32_t intVal, float floatVal, const uint8_t* value, uint16_t valueLen) {
    bool scalar = (type != MSG_TYPE_TEXT && type != MSG_TYPE_BLOB);
    if (!scalar && valueLen > RETAIN_VALUE_MAX) {
        Serial.print(F("[Pardalote] retain: value too large for key '"));
        Serial.print(key); Serial.println(F("' — not stored"));
        return;
    }

    Retained* slot = nullptr;
    for (int i = 0; i < NUM_RETAINED; i++)
        if (_retained[i].used && strncmp(_retained[i].key, key, MAX_MESSAGE_KEY) == 0) { slot = &_retained[i]; break; }
    if (!slot)
        for (int i = 0; i < NUM_RETAINED; i++)
            if (!_retained[i].used) { slot = &_retained[i]; break; }
    if (!slot) { Serial.println(F("[Pardalote] retain table full")); return; }

    slot->used = true;
    memcpy(slot->key, key, keyLen);
    slot->key[keyLen] = 0;
    slot->keyLen   = keyLen;
    slot->type     = type;
    slot->intVal   = intVal;
    slot->floatVal = floatVal;
    if (scalar) {
        slot->valueLen = 0;
    } else {
        memcpy(slot->valueBuf, value, valueLen);
        slot->valueLen = valueLen;
    }
}

void PardaloteClass::_announceMessages(uint8_t clientNum) {
    for (int i = 0; i < NUM_RETAINED; i++) {
        Retained& r = _retained[i];
        if (!r.used) continue;
        FrameBuilder fb;
        _buildMessageFrame(fb, r.type, MSG_FLAG_RETAIN, r.key, r.keyLen,
                           r.intVal, r.floatVal, r.valueBuf, r.valueLen);
        sendFrame(clientNum, fb);
    }
}

void PardaloteClass::watch(const char* key, PardaloteMessageHandler cb) {
    for (uint8_t i = 0; i < _watcherCount; i++)
        if (strncmp(_watchers[i].key, key, MAX_MESSAGE_KEY) == 0) { _watchers[i].cb = cb; return; }
    if (_watcherCount >= NUM_WATCHERS) { Serial.println(F("[Pardalote] watch table full")); return; }
    strncpy(_watchers[_watcherCount].key, key, MAX_MESSAGE_KEY);
    _watchers[_watcherCount].key[MAX_MESSAGE_KEY] = 0;
    _watchers[_watcherCount].cb = cb;
    _watcherCount++;
}

void PardaloteClass::onMessage(PardaloteMessageHandler cb) { _messageHandler = cb; }
void PardaloteClass::onFrame(PardaloteFrameHandler cb)     { _frameHandler   = cb; }

// Frame monitor delivery.
void PardaloteClass::_emitFrame(uint8_t dir, const Frame& f) {
    if (!_frameHandler) return;
    FrameEvent ev;
    ev.dir        = dir;
    ev.cmd        = f.cmd;
    ev.target     = f.target;
    ev.nparams    = f.nparams;
    ev.typeMask   = f.typeMask;
    ev.params     = f.params;
    ev.payloadLen = f.payloadLen;
    ev.payload    = f.payload;
    ev.name       = pardaloteFrameName(f.target, f.cmd);
    _frameHandler(ev);
}

void PardaloteClass::_emitFrameOut(uint8_t* buf, size_t len) {
    if (!_frameHandler) return;
    Frame f = parseFrame(buf, 0, len);
    if (f.valid) _emitFrame(PARDALOTE_FRAME_OUT, f);
}

// -------------------------------------------------------------------
// Public send methods — extensions call Pardalote.sendFrame /
// Pardalote.broadcastFrame from phase 5 onward.
// -------------------------------------------------------------------
void PardaloteClass::sendFrame(uint8_t clientNum, FrameBuilder& fb) {
    if (clientNum >= MAX_WS_CLIENTS) return;   // loopback client (sketch command) has no socket
    size_t len = fb.finish();
    if (len == 0) return;
    _emitFrameOut(fb.buf, len);
    _ws.sendBIN(clientNum, fb.buf, len);
}

// -------------------------------------------------------------------
// Local command dispatch — a sketch drives an extension through the same
// handler the browser uses. Params are int32, packed big-endian, then run
// against the extension with a loopback client id (>= MAX_WS_CLIENTS, so
// any reply is dropped by sendFrame; command frames don't reply anyway).
// -------------------------------------------------------------------
void PardaloteClass::_command(uint16_t deviceId, uint8_t cmd, const int32_t* params, uint8_t n) {
    if (n > MAX_PARAMS) n = MAX_PARAMS;
    uint8_t buf[MAX_PARAMS * 4];
    for (uint8_t i = 0; i < n; i++) {
        int32_t p = params[i];
        buf[i * 4]     = (p >> 24) & 0xFF;
        buf[i * 4 + 1] = (p >> 16) & 0xFF;
        buf[i * 4 + 2] = (p >>  8) & 0xFF;
        buf[i * 4 + 3] =  p        & 0xFF;
    }
    dispatchExtension(0xFF, deviceId, cmd, 0, buf, n, nullptr, 0);
}

void PardaloteClass::broadcastFrame(FrameBuilder& fb) {
    size_t len = fb.finish();
    if (len == 0) return;
    _emitFrameOut(fb.buf, len);
    for (int c = 0; c < MAX_WS_CLIENTS; c++) {
        if (_connectedClients & (1 << c))
            _ws.sendBIN((uint8_t)c, fb.buf, len);
    }
}

// -------------------------------------------------------------------
// Action registry helpers
// -------------------------------------------------------------------
int PardaloteClass::_getSlot(int id) {
    int empty = -1;
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (_actions[i].id == id)  return i;
        if (empty == -1 && _actions[i].id == -1) empty = i;
    }
    if (empty == -1) Serial.println(F("Action table full"));
    return empty;
}

void PardaloteClass::_unregisterAction(int id) {
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (_actions[i].id == id) { _actions[i].id = -1; return; }
    }
}

// -------------------------------------------------------------------
// Platform init / loop
// -------------------------------------------------------------------
void PardaloteClass::_platformInit() {
    ledMatrixBegin();
}

void PardaloteClass::_platformLoop() {
    ledMatrixLoop();
}
