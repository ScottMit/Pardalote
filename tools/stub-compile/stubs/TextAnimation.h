// Stub <TextAnimation.h> — host -fsyntax-only.
#pragma once
#include <Arduino.h>
class TextAnimation {
public:
    void loadWrapper(const uint32_t*, uint32_t) {}
};
// Real macro declares a fixed-capacity animation buffer named `name`.
#define TEXT_ANIMATION_DEFINE(name, frames) static TextAnimation name;
