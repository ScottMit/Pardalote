// ==============================================================
// NeoPixelExtension.h
// Pardalote NeoPixel Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Include this file in Pardalote.ino to add NeoPixel support.
// Requires the Adafruit NeoPixel library.
//
// Pixel updates are buffered on the Arduino side by the
// Adafruit library — LEDs only update when CMD_NEO_SHOW arrives.
// ==============================================================

#ifndef NEOPIXEL_EXTENSION_H
#define NEOPIXEL_EXTENSION_H

#include <Adafruit_NeoPixel.h>
#include "defs.h"
#include "protocol.h"
#include "extensions.h"

#define MAX_STRIPS 4

class NeoPixelExt {
private:
    static Adafruit_NeoPixel* _strips[MAX_STRIPS];
    static int16_t  _pins[MAX_STRIPS];
    static int16_t  _numPixels[MAX_STRIPS];
    static uint32_t _types[MAX_STRIPS];
    static bool     _initialized[MAX_STRIPS];

    static bool validId(int id) { return id >= 0 && id < MAX_STRIPS; }

public:
    // -------------------------------------------------------------------
    // Main dispatch
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {
        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("NeoPixel: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            case CMD_NEO_INIT: {
                if (nparams < 4) return;
                int     pin   = (int)paramInt(params, 1);
                int     num   = (int)paramInt(params, 2);
                uint32_t type = (uint32_t)paramInt(params, 3);

                if (_strips[id]) { delete _strips[id]; _strips[id] = nullptr; }
                _strips[id]      = new Adafruit_NeoPixel(num, pin, type);
                _pins[id]        = (int16_t)pin;
                _numPixels[id]   = (int16_t)num;
                _types[id]       = type;
                _initialized[id] = true;

                _strips[id]->begin();
                _strips[id]->clear();
                _strips[id]->show();

                Serial.print(F("NeoPixel ")); Serial.print(id);
                Serial.print(F(" init: pin=")); Serial.print(pin);
                Serial.print(F(" pixels=")); Serial.println(num);
                break;
            }

            case CMD_NEO_SET_PIXEL: {
                if (!_initialized[id] || nparams < 5) return;
                int index = (int)paramInt(params, 1);
                if (index < 0 || index >= _numPixels[id]) return;
                uint8_t r = (uint8_t)paramInt(params, 2);
                uint8_t g = (uint8_t)paramInt(params, 3);
                uint8_t b = (uint8_t)paramInt(params, 4);
                if (nparams > 5) {
                    uint8_t w = (uint8_t)paramInt(params, 5);
                    _strips[id]->setPixelColor(index, _strips[id]->Color(r, g, b, w));
                } else {
                    _strips[id]->setPixelColor(index, _strips[id]->Color(r, g, b));
                }
                break;
            }

            case CMD_NEO_FILL: {
                if (!_initialized[id] || nparams < 2) return;
                uint32_t color = (uint32_t)paramInt(params, 1);
                uint16_t first = (nparams > 2) ? (uint16_t)paramInt(params, 2) : 0;
                uint16_t count = (nparams > 3) ? (uint16_t)paramInt(params, 3) : 0;
                _strips[id]->fill(color, first, count);
                break;
            }

            case CMD_NEO_CLEAR:
                if (!_initialized[id]) return;
                _strips[id]->clear();
                break;

            case CMD_NEO_BRIGHTNESS:
                if (!_initialized[id] || nparams < 2) return;
                _strips[id]->setBrightness((uint8_t)paramInt(params, 1));
                break;

            case CMD_NEO_SHOW:
                if (!_initialized[id]) return;
                _strips[id]->show();
                break;

            default:
                Serial.print(F("NeoPixel: unknown cmd 0x"));
                Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Called on each new client connection.
    // Sends full strip state — init config, brightness, and every pixel
    // colour — so connecting clients immediately reflect the live state.
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_NEO_PIXEL);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_STRIPS);
        sendFrame(clientNum, fb);

        for (int i = 0; i < MAX_STRIPS; i++) {
            if (!_initialized[i]) continue;

            // Init frame — tells JS the pin, length, and pixel type
            FrameBuilder fi;
            fi.begin(CMD_NEO_INIT, DEVICE_NEO_PIXEL);
            fi.addInt(i);
            fi.addInt(_pins[i]);
            fi.addInt(_numPixels[i]);
            fi.addInt((int32_t)_types[i]);
            sendFrame(clientNum, fi);

            // Brightness frame
            FrameBuilder fbr;
            fbr.begin(CMD_NEO_BRIGHTNESS, DEVICE_NEO_PIXEL);
            fbr.addInt(i);
            fbr.addInt(_strips[i]->getBrightness());
            sendFrame(clientNum, fbr);

            // One SET_PIXEL frame per pixel using getPixelColor() readback.
            // Adafruit stores colours in its own software buffer so this is
            // reliable regardless of whether show() has been called.
            for (int j = 0; j < _numPixels[i]; j++) {
                uint32_t c = _strips[i]->getPixelColor(j);
                uint8_t w = (c >> 24) & 0xFF;
                uint8_t r = (c >> 16) & 0xFF;
                uint8_t g = (c >>  8) & 0xFF;
                uint8_t b =  c        & 0xFF;

                FrameBuilder fp;
                fp.begin(CMD_NEO_SET_PIXEL, DEVICE_NEO_PIXEL);
                fp.addInt(i);
                fp.addInt(j);
                fp.addInt(r);
                fp.addInt(g);
                fp.addInt(b);
                if (w > 0) fp.addInt(w);
                sendFrame(clientNum, fp);
            }
        }
    }
};

// Static member definitions
Adafruit_NeoPixel* NeoPixelExt::_strips[MAX_STRIPS]   = {};
int16_t  NeoPixelExt::_pins[MAX_STRIPS]                = { -1,-1,-1,-1 };
int16_t  NeoPixelExt::_numPixels[MAX_STRIPS]           = {};
uint32_t NeoPixelExt::_types[MAX_STRIPS]               = {};
bool     NeoPixelExt::_initialized[MAX_STRIPS]         = {};

INSTALL_EXTENSION(DEVICE_NEO_PIXEL, NeoPixelExt::handle, NeoPixelExt::announce)

#endif
