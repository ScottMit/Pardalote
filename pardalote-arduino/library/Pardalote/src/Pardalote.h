// ==============================================================
// Pardalote.h
// Arduino-side library for the Pardalote project.
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Minimal sketch:
//   #include <Pardalote.h>
//   void setup() { Pardalote.begin(); }
//   void loop()  { Pardalote.run(); }
//
// Optional extensions:
//   #include <PardaloteServo.h>
//   #include <PardaloteNeoPixel.h>
// ==============================================================

#ifndef PARDALOTE_H
#define PARDALOTE_H

#include <Arduino.h>

#include "internal/platform.h"
#include <WebSocketsServer.h>
#include "internal/defs.h"
#include "internal/protocol.h"
#include "internal/extensions.h"
#include "internal/wifi_config.h"

// -------------------------------------------------------------------
// Compile-time WiFi credentials via secrets.h in the sketch folder.
//
// The sketch folder is on the include path when the .ino compiles,
// but NOT when the library .cpps compile. So __has_include("secrets.h")
// can only succeed in the user's TU. The binder below copies the macros
// into _pardaloteSecrets (declared in wifi_config.h, defined in
// wifi_config.cpp), which wifiConfigConnect() reads at runtime.
// -------------------------------------------------------------------
#if __has_include("secrets.h")
  #include "secrets.h"
#endif

#ifdef SECRET_SSID
  namespace {
    struct _PardaloteSecretBinder {
        _PardaloteSecretBinder() {
            _pardaloteSecrets.ssid = SECRET_SSID;
            #ifdef SECRET_PASS
              _pardaloteSecrets.pass = SECRET_PASS;
            #else
              _pardaloteSecrets.pass = nullptr;
            #endif
        }
    };
    static _PardaloteSecretBinder _pardalote_secret_binder;
  }
#endif

// -------------------------------------------------------------------
// PardaloteClass
// -------------------------------------------------------------------
class PardaloteClass {
public:
    PardaloteClass();

    // Call from setup() — connects WiFi, starts the WebSocket server.
    void begin();

    // Call from loop() — services the WebSocket, runs periodic reads,
    // dispatches per-extension housekeeping.
    void run();

    // Used by extensions to push frames back to clients.
    // Phase 5 makes these the only API (the free-function wrappers go away).
    void sendFrame(uint8_t clientNum, FrameBuilder& fb);
    void broadcastFrame(FrameBuilder& fb);

    // Run an extension command locally from the sketch — the same code path a
    // browser command takes. Used by the PardaloteServo / PardaloteStepper
    // write helpers; not usually called directly.
    void command(uint16_t deviceId, uint8_t cmd, int32_t a)                       { int32_t p[1] = { a };       _command(deviceId, cmd, p, 1); }
    void command(uint16_t deviceId, uint8_t cmd, int32_t a, int32_t b)            { int32_t p[2] = { a, b };    _command(deviceId, cmd, p, 2); }
    void command(uint16_t deviceId, uint8_t cmd, int32_t a, int32_t b, int32_t c) { int32_t p[3] = { a, b, c }; _command(deviceId, cmd, p, 3); }

    // Inspection helpers.
    const char* boardName() const { return PARDALOTE_BOARD; }
    bool        anyConnected() const { return _connectedClients != 0; }

    // -----------------------------------------------------------------------
    // Sharing pin state with the browser.
    //
    // share(pin, mode) — tell the browser "this pin exists, it's in this mode."
    //     Accepts Arduino's INPUT / OUTPUT / INPUT_PULLUP / INPUT_PULLDOWN, or
    //     Pardalote's MODE_ANALOG_INPUT. For input modes the JS side will start
    //     polling automatically — so the browser gets values flowing without
    //     having to declare the pin itself.
    //
    // send(pin, value) — push a current value to the browser. JS caches it,
    //     fires arduino.onChange(pin, ...) handlers, makes it available via
    //     arduino.digitalRead(pin) / analogRead(pin).
    //
    // Both calls do NOT manipulate the pin — they only inform the browser.
    // The sketch is still responsible for the actual pinMode / digitalWrite /
    // digitalRead via the standard Arduino API. share() and send() exist
    // purely to keep the browser in sync.
    //
    // See examples/shared-control-example/ and examples/shared-input-example/.
    // -----------------------------------------------------------------------
    void share(uint8_t pin, uint8_t mode);
    void send (uint8_t pin, int     value);

private:
    void _command(uint16_t deviceId, uint8_t cmd, const int32_t* params, uint8_t n);

    static constexpr uint8_t  MAX_WS_CLIENTS  = 4;
    static constexpr uint32_t HELLO_DELAY_MS  = 50;
    static constexpr int      NUM_ACTIONS     = 20;

    struct Action {
        int16_t       id;        // pin number; -1 = empty slot
        uint8_t       cmd;       // CMD_DIGITAL_READ or CMD_ANALOG_READ
        unsigned long lastUpdate;
        unsigned long interval;  // ms
    };

    WebSocketsServer _ws{81};
    WifiStore        _wifiStore;

    Action   _actions[NUM_ACTIONS];
    uint8_t  _corePinModes[MAX_PIN_NUMBER];
    uint8_t  _corePinValues[MAX_PIN_NUMBER];
    uint8_t  _connectedClients = 0;
    bool     _pendingHello[MAX_WS_CLIENTS] = {};
    uint32_t _helloAfter[MAX_WS_CLIENTS]   = {};

    // WebSocket library wants a free/static function pointer — this
    // trampoline forwards to the global Pardalote instance.
    static void _wsEventTrampoline(uint8_t num, WStype_t type,
                                   uint8_t* payload, size_t length);

    void _handleWsEvent(uint8_t num, WStype_t type,
                        uint8_t* payload, size_t length);
    void _handleCoreFrame(uint8_t clientNum, const Frame& f);
    void _performRead(int pin, uint8_t cmd);
    void _sendHello(uint8_t clientNum);
    void _announcePins(uint8_t clientNum);
    void _sendSyncComplete(uint8_t clientNum);
    int  _getSlot(int id);
    void _unregisterAction(int id);

    void _platformInit();
    void _platformLoop();
};

extern PardaloteClass Pardalote;

#endif
