// ==============================================================
// internal/led_matrix.cpp
// UNO R4 LED matrix implementation.
// ==============================================================

#include "led_matrix.h"
#include "platform.h"

#ifdef PLATFORM_UNO_R4

#include <Arduino.h>

static ArduinoLEDMatrix _matrix;
TEXT_ANIMATION_DEFINE(_matrixAnim, 100)
static bool _matrixDisplayReady = true;

static void _matrixCallback() { _matrixDisplayReady = true; }

static void _matrixText(const char* text, int scroll) {
    _matrix.beginDraw();
    _matrix.stroke(0xFFFFFFFF);
    _matrix.textFont(Font_4x6);
    if (scroll) _matrix.textScrollSpeed(80);
    _matrix.setCallback(_matrixCallback);
    _matrix.beginText(0, 1, 0xFFFFFF);
    _matrix.print("   ");
    _matrix.println(text);
    _matrix.endTextAnimation(scroll, _matrixAnim);
    _matrix.loadTextAnimationSequence(_matrixAnim);
    _matrix.play();
}

static const char* _ipToString(const IPAddress& ip) {
    static char s[16];
    sprintf(s, "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
    return s;
}

void ledMatrixBegin() {
    _matrix.begin();
    _matrixText("Pardalote", SCROLL_LEFT);
}

void ledMatrixLoop() {
    if (_matrixDisplayReady) {
        _matrixDisplayReady = false;
        _matrixText(_ipToString(WiFi.localIP()), SCROLL_LEFT);
    }
}

#else  // not PLATFORM_UNO_R4

void ledMatrixBegin() {}
void ledMatrixLoop()  {}

#endif
