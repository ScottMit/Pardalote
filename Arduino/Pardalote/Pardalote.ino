// ==============================================================
// Pardalote
// Arduino to JavaScript Communication
//
// by Scott Mitchell
// LGPL-2.1 License
// ==============================================================
// 
// Version v0.13
// Works with UNO R4 WiFi and ESP32
// ==============================================================

#include <Arduino.h>

// Platform-specific includes
#ifdef ARDUINO_UNOR4_WIFI
#include "WiFiS3.h"
#include "ArduinoGraphics.h"
#include "Arduino_LED_Matrix.h"
#include "TextAnimation.h"
#define PLATFORM_UNO_R4
#elif defined(ESP32)
#include <WiFi.h>
#define PLATFORM_ESP32
#else
#error "Unsupported platform - only ESP32 and UNO R4 WiFi are supported"
#endif

#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include "defs.h"
#include "secrets.h"

// -------------------------------------------------------------------
// Function Declarations
// -------------------------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
void handleCoreAction(int pin, int action, JsonArray& params);
void performRead(int pin, int action);
void registerRead(int pin, int action, unsigned long interval);
void registerAction(int id, int type, unsigned long interval, int extraParam = 0);
void handleExtensionAction(int deviceId, int action, JsonArray& params);
void sendReturnMessage(int id, int type, float value);
int getIndex(int theId);
void unregisterAction(int pin);
void platformInit();
void platformLoop();

#ifdef PLATFORM_UNO_R4
void displayIP();
void matrixCallback();
void matrixText(const char* text, int scroll);
const char* ipAddressToString(const IPAddress& ip);
#endif

// -------------------------------------------------------------------
// Extension includes
// -------------------------------------------------------------------
#include "NeoPixelExtension.h"
#include "ServoExtension.h"
#include "UltrasonicExtension.h"

// -------------------------------------------------------------------
// WebSocket
// -------------------------------------------------------------------
WebSocketsServer webSocket = WebSocketsServer(81);
const char* ssid = SECRET_SSID;
const char* password = SECRET_PASS;

// -------------------------------------------------------------------
// Platform-specific variables
// -------------------------------------------------------------------
#ifdef PLATFORM_UNO_R4
ArduinoLEDMatrix matrix;
TEXT_ANIMATION_DEFINE(anim, 100)
bool matrixDisplayReady = true;
#endif

// -------------------------------------------------------------------
// Registered actions
// -------------------------------------------------------------------
#define NUM_ACTIONS 100
struct Actions {
  int16_t id;
  int16_t type;
  unsigned long lastUpdate;
  unsigned long interval;
};
Actions registeredActions[NUM_ACTIONS];

// -------------------------------------------------------------------
// Setup
// -------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

#ifdef PLATFORM_UNO_R4
  Serial.println("UNO R4 WiFi WebSocket Server Starting...");
#elif defined(PLATFORM_ESP32)
  Serial.println("ESP32 WebSocket Server Starting...");
#endif

  // Initialize registered actions array
  for (int i = 0; i < NUM_ACTIONS; i++) {
    registeredActions[i].id = -1;
  }

  // Platform-specific initialization
  platformInit();

  // Connect to WiFi
#ifdef PLATFORM_UNO_R4
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println("WiFi module not found!");
    while (true) delay(1000);
  }

  while (WiFi.begin(ssid, password) != WL_CONNECTED) {
    Serial.print("Attempting to connect to SSID: ");
    Serial.println(ssid);
    delay(1000);
  }
#elif defined(PLATFORM_ESP32)
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
#endif

  Serial.println("WiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Start WebSocket server
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");
}

// -------------------------------------------------------------------
// Loop
// -------------------------------------------------------------------
void loop() {
  webSocket.loop();

  // Platform-specific loop tasks
  platformLoop();

  unsigned long now = millis();

  // Handle periodic registered actions
  for (int i = 0; i < NUM_ACTIONS; i++) {
    if (registeredActions[i].id == -1) continue;
    if (now - registeredActions[i].lastUpdate < registeredActions[i].interval) continue;

    int pin = registeredActions[i].id;
    int type = registeredActions[i].type;

    if (type == DIGITAL_READ || type == ANALOG_READ) {
      performRead(pin, type);
    } else if (pin >= 2000 && pin < 3000) {
      // Handle extension actions
      if (type == ULTRASONIC_READ) {
        // Ultrasonic sensor periodic read
        int sensorId = pin - 2000;
        UltrasonicExt::performPeriodicRead(sensorId);
      }
      // Add other extension ranges here as needed
    }

    registeredActions[i].lastUpdate = now;
  }
}

// -------------------------------------------------------------------
// Platform-specific initialization
// -------------------------------------------------------------------
void platformInit() {
#ifdef PLATFORM_UNO_R4
  matrix.begin();
  matrixText("WebSocket Server", SCROLL_LEFT);
#elif defined(PLATFORM_ESP32)
  // ESP32 specific initialization (if needed)
#endif
}

// -------------------------------------------------------------------
// Platform-specific loop tasks
// -------------------------------------------------------------------
void platformLoop() {
#ifdef PLATFORM_UNO_R4
  if (matrixDisplayReady) {
    matrixDisplayReady = false;
    displayIP();
  }
#elif defined(PLATFORM_ESP32)
  // ESP32 specific loop tasks (if needed)
#endif
}

// -------------------------------------------------------------------
// WebSocket Event
// -------------------------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      // Removed because this overloads the monitor on the UNO R4
      // Serial.print("[");
      // Serial.print(num);
      // Serial.println("] Disconnected!");
      break;

    case WStype_CONNECTED:
      Serial.print("[");
      Serial.print(num);
      Serial.println("] Client connected");
      break;

    case WStype_TEXT:
      {
        Serial.print("[");
        Serial.print(num);
        Serial.print("] Received: ");
        Serial.println((char*)payload);

        StaticJsonDocument<512> doc;
        DeserializationError error = deserializeJson(doc, payload, length);
        if (error) {
          Serial.print("JSON parse error: ");
          Serial.println(error.c_str());
          return;
        }

        for (JsonObject actionObj : doc["data"].as<JsonArray>()) {
          int id = (int)actionObj["id"];
          int action = (int)actionObj["action"];
          JsonArray params = actionObj["params"].as<JsonArray>();

          if (action >= PIN_MODE && action <= END) {
            handleCoreAction(id, action, params);
          } else if (id >= RESERVED_START) {
            handleExtensionAction(id, action, params);
          }
        }
        break;
      }

    default:
      break;
  }
}

// -------------------------------------------------------------------
// Core Action Handler
// -------------------------------------------------------------------
void handleCoreAction(int pin, int action, JsonArray& params) {
  switch (action) {
    case PIN_MODE:
      {
        int modeParam = (int)params[0];
        uint8_t mode;

        // Map numeric params to Arduino constants
        switch (modeParam) {
          case 0: mode = INPUT; break;
          case 1: mode = OUTPUT; break;
          case 2: mode = INPUT_PULLUP; break;
#if defined(ESP32)
          case 3: mode = INPUT_PULLDOWN; break;  // Only on ESP32
#endif
          default:
            Serial.print("Invalid pinMode param: ");
            Serial.println(modeParam);
            return;
        }

        pinMode(pin, mode);
        unregisterAction(pin);
        Serial.print("pinMode set for pin ");
        Serial.print(pin);
        Serial.print(" to mode ");
        Serial.println(modeParam);
        break;
      }

    case DIGITAL_WRITE:
      digitalWrite(pin, (int)params[0]);
      Serial.print("pin: ");
      Serial.print(pin);
      Serial.print(" set to: ");
      Serial.println((int)params[0]);
      break;

    case DIGITAL_READ:
      performRead(pin, DIGITAL_READ);
      if (params.size() > 0 && params[0] > 0) {
        registerRead(pin, DIGITAL_READ, (unsigned long)params[0]);
      }
      break;

    case ANALOG_WRITE:
      analogWrite(pin, (int)params[0]);
      break;

    case ANALOG_READ:
      performRead(pin, ANALOG_READ);
      if (params.size() > 0 && params[0] > 0) {
        registerRead(pin, ANALOG_READ, (unsigned long)params[0]);
      }
      break;

    case END:
      unregisterAction(pin);
      break;
  }
}

// -------------------------------------------------------------------
// Extension Action Handler
// -------------------------------------------------------------------
void handleExtensionAction(int deviceId, int action, JsonArray& params) {
  switch (deviceId) {
    case NEO_PIXEL:
      NeoPixelExt::handle(action, params);
      break;

    case SERVO_CONTROL:
      ServoExt::handle(action, params);
      break;

    case ULTRASONIC_CONTROL:
      UltrasonicExt::handle(action, params);
      break;

      // Future extensions go here
  }
}

// -------------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------------
void performRead(int pin, int action) {
  int val = 0;

  switch (action) {
    case DIGITAL_READ:
      val = digitalRead(pin);
      break;

    case ANALOG_READ:
      val = analogRead(pin);
      break;

    default:
      return;
  }

  sendReturnMessage(pin, action, val);
}

void registerRead(int pin, int action, unsigned long interval) {
  int idx = getIndex(pin);
  if (idx >= 0) {
    registeredActions[idx] = { pin, action, millis(), interval };
  }
}

void sendReturnMessage(int id, int type, float value) {
  StaticJsonDocument<256> doc;
  doc["header"]["version"] = 0.8;
  doc["data"][0]["id"] = id;
  doc["data"][0]["type"] = type;
  doc["data"][0]["value"] = value;

  char JSONtxt[256];
  serializeJson(doc, JSONtxt);
  webSocket.broadcastTXT(JSONtxt);
  Serial.println(JSONtxt);
}

int getIndex(int theId) {
  int emptySlot = -1;
  for (int i = 0; i < NUM_ACTIONS; i++) {
    if (registeredActions[i].id == theId) return i;
    if (emptySlot == -1 && registeredActions[i].id == -1) emptySlot = i;
  }
  return emptySlot;
}

void registerAction(int id, int type, unsigned long interval, int extraParam) {
  int idx = getIndex(id);
  if (idx >= 0) {
    registeredActions[idx] = { id, type, millis(), interval };
  }
}

void unregisterAction(int pin) {
  int idx = getIndex(pin);
  if (idx < 0) return;
  registeredActions[idx] = { -1, 0, 0, 0 };
}

// -------------------------------------------------------------------
// UNO R4 specific functions
// -------------------------------------------------------------------
#ifdef PLATFORM_UNO_R4
void displayIP() {
  IPAddress myIP = WiFi.localIP();
  const char* ipStr = ipAddressToString(myIP);
  matrixText(ipStr, SCROLL_LEFT);
}

void matrixCallback() {
  matrixDisplayReady = true;
}

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

const char* ipAddressToString(const IPAddress& ip) {
  static char ipString[16];
  sprintf(ipString, "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
  return ipString;
}
#endif