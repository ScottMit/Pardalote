// ==============================================================
// Pardalote
// Arduino to JavaScript Binary WebSocket Communication
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Supported platforms: Arduino UNO R4 WiFi, ESP32
// ==============================================================

#include <Arduino.h>

// ── Platform flags — drive includes and conditional compilation ──────────
// These are set from hardware and are not user-overridable.
#if defined(ARDUINO_UNOR4_WIFI)
  #include "WiFiS3.h"
  #include "ArduinoGraphics.h"
  #include "Arduino_LED_Matrix.h"
  #include "TextAnimation.h"
  #define PLATFORM_UNO_R4
#elif defined(ESP32)
  #include <WiFi.h>
  #define PLATFORM_ESP32
#else
  #error "Unsupported platform — only UNO R4 WiFi and ESP32 are supported"
#endif

// ── Board name sent in the HELLO handshake ───────────────────────────────
// Auto-detected from the build system. To override (e.g. for a custom board
// or a specific ESP32 variant), define PARDALOTE_BOARD before this file:
//   #define PARDALOTE_BOARD "My Custom Board"
#ifndef PARDALOTE_BOARD
  #if defined(ARDUINO_UNOR4_WIFI)
    #define PARDALOTE_BOARD "UNO R4 WiFi"
  #elif defined(ARDUINO_DFROBOT_FIREBEETLE_2_ESP32C5)
    #define PARDALOTE_BOARD "FireBeetle 2 ESP32-C5"
  #elif defined(ARDUINO_ESP32_WROVER_KIT) || defined(ARDUINO_UPESY_WROVER) || defined(ARDUINO_ESP32_DEV)
    #define PARDALOTE_BOARD "ESP32-WROVER-DEV"
  #else
    #define PARDALOTE_BOARD "unknown"
    #warning "PARDALOTE_BOARD not recognised — add '#define PARDALOTE_BOARD \"Your Board\"' at the top of your sketch"
  #endif
#endif

#include <WebSocketsServer.h>
#include "defs.h"
#include "protocol.h"
#include "extensions.h"
#include "wifi_config.h"

// -------------------------------------------------------------------
// Extension includes — each self-registers via INSTALL_EXTENSION.
// Add or remove lines here to include/exclude hardware support.
// -------------------------------------------------------------------
#include "ServoExtension.h"
// #include "NeoPixelExtension.h"
// #include "UltrasonicExtension.h"

// -------------------------------------------------------------------
// Forward declarations
// -------------------------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
void handleCoreFrame(uint8_t clientNum, const Frame& f);
void performRead(int pin, uint8_t cmd);
void broadcastFrame(FrameBuilder& fb);
void sendHello(uint8_t clientNum);
void announcePins(uint8_t clientNum);
void sendSyncComplete(uint8_t clientNum);
void sendFrame(uint8_t clientNum, FrameBuilder& fb);
int  getSlot(int id);
void unregisterAction(int id);
void platformInit();
void platformLoop();

#ifdef PLATFORM_UNO_R4
void displayIP();
void matrixCallback();
void matrixText(const char* text, int scroll);
const char* ipToString(const IPAddress& ip);
#endif

// -------------------------------------------------------------------
// WebSocket server
// -------------------------------------------------------------------
WebSocketsServer webSocket = WebSocketsServer(81);
WifiStore wifiStore;

// -------------------------------------------------------------------
// Platform variables
// -------------------------------------------------------------------
#ifdef PLATFORM_UNO_R4
ArduinoLEDMatrix matrix;
TEXT_ANIMATION_DEFINE(anim, 100)
bool matrixDisplayReady = true;
#endif

// -------------------------------------------------------------------
// Registered periodic read actions
// -------------------------------------------------------------------
#define NUM_ACTIONS 20
struct Action {
    int16_t       id;        // pin number; -1 = empty slot
    uint8_t       cmd;       // CMD_DIGITAL_READ or CMD_ANALOG_READ
    unsigned long lastUpdate;
    unsigned long interval;  // ms
};
Action actions[NUM_ACTIONS];

// -------------------------------------------------------------------
// Core pin state — tracked so new clients can be told the current
// configuration without needing to set it up again themselves.
// -------------------------------------------------------------------
uint8_t _corePinModes[MAX_PIN_NUMBER];   // 0xFF = not configured
uint8_t _corePinValues[MAX_PIN_NUMBER];  // last digitalWrite value (OUTPUT pins)

// Connected client bitmask — bit N set means client N is connected.
// WebSocketsServer supports up to 4 simultaneous clients.
#define MAX_WS_CLIENTS 4
uint8_t connectedClients = 0;
static inline bool anyConnected() { return connectedClients != 0; }

// HELLO is deferred out of the WStype_CONNECTED callback and sent after
// a short settling delay. This ensures the WebSocket handshake has fully
// completed on all platforms (critical on ESP32) before any application
// data flows in either direction. Tracked per-client.
bool     pendingHello[MAX_WS_CLIENTS] = {};
uint32_t helloAfter[MAX_WS_CLIENTS]   = {};
const uint32_t HELLO_DELAY_MS = 50;

// -------------------------------------------------------------------
// Setup
// -------------------------------------------------------------------
void setup() {
    Serial.begin(115200);

    for (int i = 0; i < NUM_ACTIONS; i++) actions[i].id = -1;
    memset(_corePinModes,  0xFF, sizeof(_corePinModes));
    memset(_corePinValues, 0,    sizeof(_corePinValues));

    platformInit();

    // WiFi connection — credentials stored in EEPROM via wifi_config.h
    wifiConfigInit(wifiStore);      // startup banner + optional config window
    wifiConfigConnect(wifiStore);   // try each stored network in order

#ifdef PLATFORM_UNO_R4
    // WiFiS3 sets WL_CONNECTED before DHCP completes — wait for a real IP
    while (WiFi.localIP() == IPAddress(0, 0, 0, 0)) delay(100);
#endif

    Serial.print(F("IP: "));
    Serial.println(WiFi.localIP());

    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    Serial.println(F("WebSocket server started on port 81"));
}

// -------------------------------------------------------------------
// Loop
// -------------------------------------------------------------------
void loop() {
    webSocket.loop();
    platformLoop();

#ifdef PLATFORM_ESP32
    delay(1);   // yield to FreeRTOS idle task — prevents TG0WDT watchdog reset
#endif

    if (!anyConnected()) return;

    unsigned long now = millis();

    // Send deferred HELLO + announce to any newly connected client.
    for (int c = 0; c < MAX_WS_CLIENTS; c++) {
        if (!(connectedClients & (1 << c))) continue;
        if (!pendingHello[c] || now < helloAfter[c]) continue;
        pendingHello[c] = false;
        sendHello(c);
        announcePins(c);
        announceAll(c);
        sendSyncComplete(c);
    }

    // Broadcast periodic reads to all connected clients.
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (actions[i].id == -1) continue;
        if (now - actions[i].lastUpdate < actions[i].interval) continue;
        performRead(actions[i].id, actions[i].cmd);
        actions[i].lastUpdate = now;
    }
}

// -------------------------------------------------------------------
// WebSocket event handler
// -------------------------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {

        case WStype_DISCONNECTED:
            connectedClients  &= ~(1 << num);
            pendingHello[num]  = false;
            // Only clear actions when the last client disconnects.
            if (!anyConnected()) {
                for (int i = 0; i < NUM_ACTIONS; i++) actions[i].id = -1;
            }
            Serial.print('['); Serial.print(num); Serial.println(F("] Disconnected"));
            break;

        case WStype_CONNECTED:
            connectedClients |= (1 << num);
            pendingHello[num]  = true;
            helloAfter[num]    = millis() + HELLO_DELAY_MS;
            Serial.print('['); Serial.print(num); Serial.println(F("] Connected"));
            break;

        case WStype_BIN: {
            size_t pos = 0;
            while (pos < length) {
                Frame f = parseFrame(payload, pos, length);
                if (!f.valid) break;

                if (f.target < RESERVED_START) {
                    handleCoreFrame(num, f);
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
void handleCoreFrame(uint8_t clientNum, const Frame& f) {
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
            unregisterAction(pin);
            if (pin >= 0 && pin < MAX_PIN_NUMBER)
                _corePinModes[pin] = (uint8_t)pardaloteMode;
            break;
        }

        case CMD_DIGITAL_WRITE:
            if (f.nparams < 1) return;
            digitalWrite(pin, (int)paramInt(f.params, 0));
            if (pin >= 0 && pin < MAX_PIN_NUMBER)
                _corePinValues[pin] = (uint8_t)paramInt(f.params, 0);
            break;

        case CMD_ANALOG_WRITE:
            if (f.nparams < 1) return;
            analogWrite(pin, (int)paramInt(f.params, 0));
            break;

        case CMD_DIGITAL_READ:
            performRead(pin, CMD_DIGITAL_READ);
            if (f.nparams > 0 && paramInt(f.params, 0) > 0) {
                int slot = getSlot(pin);
                if (slot >= 0) {
                    actions[slot] = {
                        (int16_t)pin, CMD_DIGITAL_READ,
                        millis(), (unsigned long)paramInt(f.params, 0)
                    };
                }
            }
            break;

        case CMD_ANALOG_READ:
            performRead(pin, CMD_ANALOG_READ);
            if (f.nparams > 0 && paramInt(f.params, 0) > 0) {
                int slot = getSlot(pin);
                if (slot >= 0) {
                    actions[slot] = {
                        (int16_t)pin, CMD_ANALOG_READ,
                        millis(), (unsigned long)paramInt(f.params, 0)
                    };
                }
            }
            break;

        case CMD_END:
            unregisterAction(pin);
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
void performRead(int pin, uint8_t cmd) {
    int32_t val = (cmd == CMD_ANALOG_READ) ? analogRead(pin) : digitalRead(pin);

    FrameBuilder fb;
    fb.begin(cmd, (uint16_t)pin);
    fb.addInt(val);
    broadcastFrame(fb);
}

// -------------------------------------------------------------------
// Send HELLO frame to a newly connected client
// -------------------------------------------------------------------
void sendHello(uint8_t clientNum) {
    FrameBuilder fb;
    fb.begin(CMD_HELLO, 0x0000);
    fb.addInt(PROTOCOL_VERSION_MAJOR);
    fb.addInt(PROTOCOL_VERSION_MINOR);
    fb.addInt(ADC_RESOLUTION_BITS);  // JS computes analogMax = (1 << bits) - 1
    fb.addString(PARDALOTE_BOARD);   // board name in payload — JS loads aliases from this
    sendFrame(clientNum, fb);
}

// -------------------------------------------------------------------
// Announce core pin state to a newly connected client.
// Sends CMD_PIN_MODE for each configured pin, and CMD_DIGITAL_WRITE
// for each OUTPUT pin so the JS side knows the current output level.
// -------------------------------------------------------------------
void announcePins(uint8_t clientNum) {
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

// -------------------------------------------------------------------
// Signal to the JS client that all announce frames have been sent.
// JS holds the 'ready' event until this arrives.
// -------------------------------------------------------------------
void sendSyncComplete(uint8_t clientNum) {
    FrameBuilder fb;
    fb.begin(CMD_SYNC_COMPLETE, 0x0000);
    sendFrame(clientNum, fb);
}

// -------------------------------------------------------------------
// sendFrame     — send to one specific client (announce, ping/pong).
// broadcastFrame — send to all currently connected clients.
// Both declared extern in protocol.h so extension headers can call them.
// -------------------------------------------------------------------
void sendFrame(uint8_t clientNum, FrameBuilder& fb) {
    size_t len = fb.finish();
    webSocket.sendBIN(clientNum, fb.buf, len);
}

void broadcastFrame(FrameBuilder& fb) {
    size_t len = fb.finish();
    for (int c = 0; c < MAX_WS_CLIENTS; c++) {
        if (connectedClients & (1 << c))
            webSocket.sendBIN((uint8_t)c, fb.buf, len);
    }
}

// -------------------------------------------------------------------
// Action registry helpers
// -------------------------------------------------------------------
int getSlot(int id) {
    int empty = -1;
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (actions[i].id == id)  return i;
        if (empty == -1 && actions[i].id == -1) empty = i;
    }
    if (empty == -1) Serial.println(F("Action table full"));
    return empty;
}

void unregisterAction(int id) {
    for (int i = 0; i < NUM_ACTIONS; i++) {
        if (actions[i].id == id) { actions[i].id = -1; return; }
    }
}

// -------------------------------------------------------------------
// Platform initialisation
// -------------------------------------------------------------------
void platformInit() {
#ifdef PLATFORM_UNO_R4
    matrix.begin();
    matrixText("Pardalote", SCROLL_LEFT);
#endif
}

void platformLoop() {
#ifdef PLATFORM_UNO_R4
    if (matrixDisplayReady) {
        matrixDisplayReady = false;
        displayIP();
    }
#endif
}

// -------------------------------------------------------------------
// UNO R4 LED matrix helpers
// -------------------------------------------------------------------
#ifdef PLATFORM_UNO_R4
void displayIP() {
    matrixText(ipToString(WiFi.localIP()), SCROLL_LEFT);
}

void matrixCallback() { matrixDisplayReady = true; }

void matrixText(const char* text, int scroll) {
    matrix.beginDraw();
    matrix.stroke(0xFFFFFFFF);
    matrix.textFont(Font_4x6);
    if (scroll) matrix.textScrollSpeed(80);
    matrix.setCallback(matrixCallback);
    matrix.beginText(0, 1, 0xFFFFFF);
    matrix.print("   ");
    matrix.println(text);
    matrix.endTextAnimation(scroll, anim);
    matrix.loadTextAnimationSequence(anim);
    matrix.play();
}

const char* ipToString(const IPAddress& ip) {
    static char s[16];
    sprintf(s, "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
    return s;
}
#endif
