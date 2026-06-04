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

                if (f.target < RESERVED_START) {
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
// Public send methods — extensions call Pardalote.sendFrame /
// Pardalote.broadcastFrame from phase 5 onward.
// -------------------------------------------------------------------
void PardaloteClass::sendFrame(uint8_t clientNum, FrameBuilder& fb) {
    size_t len = fb.finish();
    if (len == 0) return;
    _ws.sendBIN(clientNum, fb.buf, len);
}

void PardaloteClass::broadcastFrame(FrameBuilder& fb) {
    size_t len = fb.finish();
    if (len == 0) return;
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
