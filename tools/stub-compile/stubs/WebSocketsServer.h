// Stub <WebSocketsServer.h> — host -fsyntax-only.
#pragma once
#include <Arduino.h>
#include <IPAddress.h>
typedef enum { WStype_ERROR, WStype_DISCONNECTED, WStype_CONNECTED, WStype_TEXT,
               WStype_BIN, WStype_FRAGMENT_TEXT_START, WStype_FRAGMENT_BIN_START,
               WStype_FRAGMENT, WStype_FRAGMENT_FIN, WStype_PING, WStype_PONG } WStype_t;
class WebSocketsServer {
public:
    WebSocketsServer(uint16_t, const String& = "", const String& = "") {}
    typedef void (*WebSocketServerEvent)(uint8_t, WStype_t, uint8_t*, size_t);
    void begin() {}
    void loop() {}
    void onEvent(WebSocketServerEvent) {}
    bool sendBIN(uint8_t, const uint8_t*, size_t) { return true; }
    bool broadcastBIN(const uint8_t*, size_t) { return true; }
    bool sendTXT(uint8_t, const char*) { return true; }
    void disconnect() {}
    void disconnect(uint8_t) {}
    IPAddress remoteIP(uint8_t) { return IPAddress(); }
    void close() {}
};
