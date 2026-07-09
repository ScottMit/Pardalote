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
#include "internal/frame_names.h"
#include "internal/extensions.h"
#include "internal/wifi_config.h"

// -------------------------------------------------------------------
// Message channel — a user-defined key/value delivered to watch() /
// onMessage() callbacks. The `type` field says which accessor is valid.
// For TEXT, `text` is a NUL-terminated copy (truncated if very long);
// `length` is the true byte length. For BLOB, `blob`/`length` point
// straight into the receive buffer (valid only during the callback).
// -------------------------------------------------------------------
struct Message {
    const char*    key;
    uint8_t        type;        // MSG_TYPE_*
    int32_t        intValue;    // INT / BOOL / CHAR
    float          floatValue;  // FLOAT
    const char*    text;        // TEXT (NUL-terminated)
    const uint8_t* blob;        // BLOB
    uint16_t       length;      // TEXT / BLOB byte length

    bool  asBool()  const { return intValue != 0; }
    int   asInt()   const { return (int)intValue; }
    float asFloat() const { return floatValue; }
    char  asChar()  const { return (char)intValue; }
};
typedef void (*PardaloteMessageHandler)(const Message&);

// -------------------------------------------------------------------
// Frame monitor — every frame in/out, decoded. `params`/`payload`
// point into the working buffer and are valid only during the callback.
// -------------------------------------------------------------------
enum PardaloteFrameDir { PARDALOTE_FRAME_IN = 0, PARDALOTE_FRAME_OUT = 1 };

struct FrameEvent {
    uint8_t        dir;         // PARDALOTE_FRAME_IN / _OUT
    uint8_t        cmd;
    uint16_t       target;
    uint8_t        nparams;
    uint16_t       typeMask;
    const uint8_t* params;
    uint16_t       payloadLen;
    const uint8_t* payload;
    const char*    name;        // decoded command name, or nullptr
};
typedef void (*PardaloteFrameHandler)(const FrameEvent&);

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
    void command(uint16_t deviceId, uint8_t cmd, int32_t a, int32_t b, int32_t c, int32_t d) { int32_t p[4] = { a, b, c, d }; _command(deviceId, cmd, p, 4); }
    void command(uint16_t deviceId, uint8_t cmd, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e) { int32_t p[5] = { a, b, c, d, e }; _command(deviceId, cmd, p, 5); }
    void command(uint16_t deviceId, uint8_t cmd, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e, int32_t f) { int32_t p[6] = { a, b, c, d, e, f }; _command(deviceId, cmd, p, 6); }

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

    // -----------------------------------------------------------------------
    // Message channel — send a named value that isn't tied to any pin or
    // device. The key is a string, so these overloads never collide with the
    // pin send(pin, value) above (pins are numeric). Every connected browser
    // receives it (arduino.watch(key) / arduino.on('message')). Pass
    // MSG_FLAG_RETAIN so browsers that connect later get the latest value on
    // connect; MSG_FLAG_BROADCAST is a browser-side flag (see the docs) and
    // is a no-op here (a sketch send already reaches every browser).
    //
    //   Pardalote.send("temp", 22.5);                 // float
    //   Pardalote.send("mode", "idle", MSG_FLAG_RETAIN);
    //   Pardalote.watch("cmd", onCmd);                // handler for one key
    //   Pardalote.onMessage(onAny);                   // handler for all keys
    // -----------------------------------------------------------------------
    void send(const char* key, int         value, uint8_t flags = 0);
    void send(const char* key, double      value, uint8_t flags = 0);
    void send(const char* key, bool        value, uint8_t flags = 0);
    void send(const char* key, char        value, uint8_t flags = 0);
    void send(const char* key, const char* text,  uint8_t flags = 0);
    void sendBlob(const char* key, const uint8_t* data, uint16_t len, uint8_t flags = 0);

    void watch(const char* key, PardaloteMessageHandler cb);
    void onMessage(PardaloteMessageHandler cb);

    // Frame monitor — cb fires for every frame in and out (decoded). Costs
    // nothing until a handler is registered.
    void onFrame(PardaloteFrameHandler cb);

private:
    void _command(uint16_t deviceId, uint8_t cmd, const int32_t* params, uint8_t n);

    static constexpr uint8_t  MAX_WS_CLIENTS  = 4;
    static constexpr uint32_t HELLO_DELAY_MS  = 50;
    static constexpr int      NUM_ACTIONS     = 20;

    // Message channel capacities.
    static constexpr int      NUM_WATCHERS    = 12;   // watch(key) callbacks
    static constexpr int      NUM_RETAINED    = 8;    // retained keys re-announced on connect
    static constexpr int      RETAIN_VALUE_MAX = 48;  // bytes stored per retained TEXT/BLOB

    struct Action {
        int16_t       id;        // pin number; -1 = empty slot
        uint8_t       cmd;       // CMD_DIGITAL_READ or CMD_ANALOG_READ
        unsigned long lastUpdate;
        unsigned long interval;  // ms
    };

    struct Watcher {
        char                    key[MAX_MESSAGE_KEY + 1];
        PardaloteMessageHandler cb;
    };

    struct Retained {
        bool     used = false;
        uint8_t  keyLen;
        char     key[MAX_MESSAGE_KEY + 1];
        uint8_t  type;
        int32_t  intVal;                       // INT / BOOL / CHAR
        float    floatVal;                     // FLOAT
        uint8_t  valueBuf[RETAIN_VALUE_MAX];   // TEXT / BLOB bytes
        uint16_t valueLen;                     // TEXT / BLOB length
    };

    WebSocketsServer _ws{81};
    WifiStore        _wifiStore;

    Action   _actions[NUM_ACTIONS];
    uint8_t  _corePinModes[MAX_PIN_NUMBER];
    uint8_t  _corePinValues[MAX_PIN_NUMBER];
    uint8_t  _connectedClients = 0;
    bool     _pendingHello[MAX_WS_CLIENTS] = {};
    uint32_t _helloAfter[MAX_WS_CLIENTS]   = {};

    Watcher  _watchers[NUM_WATCHERS];
    uint8_t  _watcherCount = 0;
    Retained _retained[NUM_RETAINED];
    PardaloteMessageHandler _messageHandler = nullptr;
    PardaloteFrameHandler   _frameHandler   = nullptr;

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

    // Message channel internals.
    void _emitMessage(uint8_t type, uint8_t flags, const char* key,
                      int32_t intVal, float floatVal,
                      const uint8_t* value, uint16_t valueLen);
    void _buildMessageFrame(FrameBuilder& fb, uint8_t type, uint8_t flags,
                            const char* key, uint8_t keyLen,
                            int32_t intVal, float floatVal,
                            const uint8_t* value, uint16_t valueLen);
    void _handleMessageFrame(uint8_t clientNum, const Frame& f, uint8_t* frameStart);
    void _dispatchMessage(const Message& m);
    void _storeRetained(const char* key, uint8_t keyLen, uint8_t type,
                        int32_t intVal, float floatVal,
                        const uint8_t* value, uint16_t valueLen);
    void _announceMessages(uint8_t clientNum);
    void _emitFrame(uint8_t dir, const Frame& f);
    void _emitFrameOut(uint8_t* buf, size_t len);

    void _platformInit();
    void _platformLoop();
};

extern PardaloteClass Pardalote;

#endif
