#ifndef NEOPIXEL_EXTENSION_H
#define NEOPIXEL_EXTENSION_H

#include <Adafruit_NeoPixel.h>

// -------------------------------------------------------------------
// NeoPixel Extension Actions (match defs.h)
// -------------------------------------------------------------------
#define NEO_INIT 10        // Setup strip: params = [stripId, pin, numPixels, type]
#define NEO_SET_PIXEL 11   // Set single pixel: params = [stripId, index, r, g, b (, w)]
#define NEO_FILL 12        // Fill range: params = [stripId, color, first, count]
#define NEO_CLEAR 13       // Clear all pixels: params = [stripId]
#define NEO_BRIGHTNESS 14  // Set global brightness: params = [stripId, value]
#define NEO_SHOW 15        // Push buffer to LEDs: params = [stripId]

#define MAX_STRIPS 8  // Maximum number of NeoPixel strips supported

class NeoPixelExt {
private:
  static Adafruit_NeoPixel* strips[MAX_STRIPS];
  static int stripPins[MAX_STRIPS];
  static int stripSizes[MAX_STRIPS];
  static bool stripInitialized[MAX_STRIPS];

  static bool isValidStripId(int stripId) {
    return stripId >= 0 && stripId < MAX_STRIPS;
  }

public:
  static void handle(int action, JsonArray& params) {
    // All actions now require stripId as first parameter
    if (params.size() == 0) return;

    int stripId = (int)params[0];
    if (!isValidStripId(stripId)) {
      Serial.print("Invalid strip ID: ");
      Serial.println(stripId);
      return;
    }

    switch (action) {
      case NEO_INIT:
        {
          if (params.size() < 4) {
            Serial.println("NEO_INIT: Insufficient parameters");
            return;
          }

          Serial.print("NEO_INIT received: stripId=");
          Serial.print((int)params[0]);
          Serial.print(", pin=");
          Serial.print((int)params[1]);
          Serial.print(", numPixels=");
          Serial.print((int)params[2]);
          Serial.print(", type=");
          Serial.println((int)params[3]);

          // Clean up existing strip if it exists
          if (strips[stripId] != nullptr) {
            delete strips[stripId];
            strips[stripId] = nullptr;
          }

          // params: [stripId, pin, numPixels, type]
          int pin = (int)params[1];
          int numPixels = (int)params[2];
          int typeVal = (int)params[3];

          stripPins[stripId] = pin;
          stripSizes[stripId] = numPixels;

          // Create new strip
          strips[stripId] = new Adafruit_NeoPixel(numPixels, pin, typeVal);
          strips[stripId]->begin();
          strips[stripId]->clear();
          strips[stripId]->show();
          stripInitialized[stripId] = true;

          Serial.print("Initialized NeoPixel strip ");
          Serial.print(stripId);
          Serial.print(" on pin ");
          Serial.print(pin);
          Serial.print(" with ");
          Serial.print(numPixels);
          Serial.println(" pixels");
          break;
        }

      case NEO_SET_PIXEL:
        {
          if (!stripInitialized[stripId] || strips[stripId] == nullptr) return;
          if (params.size() < 5) return;

          int index = (int)params[1];
          if (index >= 0 && index < stripSizes[stripId]) {
            int r = (int)params[2];
            int g = (int)params[3];
            int b = (int)params[4];
            int w = (params.size() > 5) ? (int)params[5] : 0;

            if (w > 0) {
              strips[stripId]->setPixelColor(index, strips[stripId]->Color(r, g, b, w));
            } else {
              strips[stripId]->setPixelColor(index, strips[stripId]->Color(r, g, b));
            }
          }
          break;
        }

      case NEO_FILL:
        {
          if (!stripInitialized[stripId] || strips[stripId] == nullptr) return;
          if (params.size() < 2) return;

          uint32_t color = (uint32_t)params[1];
          int first = (params.size() > 2) ? (int)params[2] : 0;
          int count = (params.size() > 3) ? (int)params[3] : 0;

          if (first >= stripSizes[stripId]) break;
          if (first < 0) first = 0;
          count = min(count, stripSizes[stripId] - first);
          if (count <= 0) count = stripSizes[stripId] - first;

          strips[stripId]->fill(color, first, count);
          break;
        }

      case NEO_CLEAR:
        {
          if (!stripInitialized[stripId] || strips[stripId] == nullptr) return;
          strips[stripId]->clear();
          break;
        }

      case NEO_BRIGHTNESS:
        {
          if (!stripInitialized[stripId] || strips[stripId] == nullptr) return;
          if (params.size() < 2) return;

          int brightness = (int)params[1];
          strips[stripId]->setBrightness(brightness);
          break;
        }

      case NEO_SHOW:
        {
          if (!stripInitialized[stripId] || strips[stripId] == nullptr) return;
          strips[stripId]->show();
          break;
        }

      default:
        Serial.print("Unknown NeoPixel action: ");
        Serial.println(action);
        break;
    }
  }

  // Utility method to get strip info (for debugging)
  static void printStripInfo() {
    Serial.println("=== NeoPixel Strip Status ===");
    for (int i = 0; i < MAX_STRIPS; i++) {
      if (stripInitialized[i]) {
        Serial.print("Strip ");
        Serial.print(i);
        Serial.print(": Pin ");
        Serial.print(stripPins[i]);
        Serial.print(", ");
        Serial.print(stripSizes[i]);
        Serial.println(" pixels");
      }
    }
    Serial.println("=============================");
  }

  // Cleanup method (call in setup if needed)
  static void cleanup() {
    for (int i = 0; i < MAX_STRIPS; i++) {
      if (strips[i] != nullptr) {
        delete strips[i];
        strips[i] = nullptr;
      }
      stripInitialized[i] = false;
      stripPins[i] = -1;
      stripSizes[i] = 0;
    }
  }
};

// Static member definitions
Adafruit_NeoPixel* NeoPixelExt::strips[MAX_STRIPS] = { nullptr };
int NeoPixelExt::stripPins[MAX_STRIPS] = { -1 };
int NeoPixelExt::stripSizes[MAX_STRIPS] = { 0 };
bool NeoPixelExt::stripInitialized[MAX_STRIPS] = { false };

#endif