// Stub <Arduino_LED_Matrix.h> — host -fsyntax-only.
#pragma once
#include <Arduino.h>
#include <ArduinoGraphics.h>
#include <TextAnimation.h>
class ArduinoLEDMatrix {
public:
    void begin() {}
    void beginDraw() {}
    void endDraw() {}
    void stroke(uint32_t) {}
    void clear() {}
    void textFont(const Font&) {}
    void textScrollSpeed(uint32_t) {}
    void beginText(int, int, uint32_t) {}
    void print(const char*) {}
    void println(const char*) {}
    int  endText(int = 0) { return 0; }
    void endTextAnimation(int, TextAnimation&) {}
    void loadTextAnimationSequence(TextAnimation&) {}
    void loadSequence(const uint32_t (*)[4]) {}
    void play(bool = false) {}
    void setCallback(void (*)()) {}
    bool sequenceDone() { return true; }
};
