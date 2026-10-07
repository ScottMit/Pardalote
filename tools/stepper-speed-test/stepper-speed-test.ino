// ==============================================================
// Stepper speed test — board side
// Pair with tools/stepper-speed-test/index.html (connect over WiFi — the
// USB connection shares this Serial port). While stepper 0 moves, prints the
// step rate and loop rate every 500 ms; when it stops, prints one summary:
// steps, time, average and peak steps/s, measured on the board's own clock.
// For soak tests it also prints why the board last reset (once, at boot) and a
// STATUS line every 30 s: uptime, free memory, lowest free memory, loop rate, and
// the longest single loop pass since the last STATUS. Any pass longer than
// BLOCK_MS also prints a BLOCK line straight away (when, how long, where the
// motor was) — the loop was stalled, and every motor stalled with it.
// A reboot shows up as a new boot banner + reset reason; a leak as falling memory.
//
// Requires AccelStepper by Mike McCauley (1.64 or newer), and ESP32Servo for the
// soak test's PWM servo.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

#include <Pardalote.h>
#include <PardaloteStepper.h>
#include <PardaloteServo.h>      // the soak test sweeps a PWM servo alongside the stepper

const int ID = 0;                    // the browser tool's stepper is the first one attached
const uint32_t WINDOW_MS = 100;      // peak-speed sampling window
const uint32_t PRINT_MS  = 500;      // live line interval while moving
const uint32_t SETTLE_MS = 150;      // stopped this long = the move is over (a gesture can pause briefly)
const uint32_t STATUS_MS = 30000;    // soak status line interval
const float    JUMP_SPS  = 100000;   // faster than this = a coordinate reset (setPosition), not motion
const uint32_t BLOCK_MS  = 20;       // a loop pass longer than this prints a BLOCK line
const bool     LIVE_LINES = true;    // per-500 ms lines while moving — set false for a quieter soak log

bool     moving = false;
uint32_t moveStart = 0, lastMotion = 0, winStart = 0, lastPrint = 0, passes = 0;
long     startPos = 0, winPos = 0, lastPos = 0;
float    peak = 0;
uint32_t lastStatus = 0, statusPasses = 0;
uint32_t passStartUs = 0, worstPassUs = 0;   // loop-pass timing (start to next start)

#if defined(ESP32)
const char* resetReason() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON:   return "power on";
        case ESP_RST_SW:        return "software restart";
        case ESP_RST_PANIC:     return "CRASH (panic)";
        case ESP_RST_INT_WDT:   return "INTERRUPT WATCHDOG";
        case ESP_RST_TASK_WDT:  return "TASK WATCHDOG";
        case ESP_RST_WDT:       return "WATCHDOG";
        case ESP_RST_BROWNOUT:  return "BROWNOUT (power dip)";
        case ESP_RST_DEEPSLEEP: return "deep sleep wake";
        case ESP_RST_EXT:       return "reset pin";
        default:                return "other/unknown";
    }
}
#endif

void setup() {
    Pardalote.begin();
#if defined(ESP32)
    Serial.printf("RESET reason: %s\n", resetReason());
#endif
    lastStatus = millis();
    passStartUs = micros();
}

void loop() {
    // Time from the previous pass's start to this one: everything the loop did,
    // plus anything that held it up (network stack, other tasks).
    uint32_t nowUs  = micros();
    uint32_t passUs = nowUs - passStartUs;
    passStartUs = nowUs;
    if (passUs > worstPassUs) worstPassUs = passUs;
#if defined(ESP32)
    if (passUs >= BLOCK_MS * 1000UL) {
        Serial.printf("BLOCK %lu ms at %lu.%03lu s · stepper at %ld\n", (unsigned long)(passUs / 1000),
                      (unsigned long)(millis() / 1000), (unsigned long)(millis() % 1000),
                      PardaloteStepper.attached(ID) ? PardaloteStepper.position(ID) : 0L);
        passStartUs = micros();   // don't count the print against the next pass
    }
#endif

    Pardalote.run();
    passes++;
    statusPasses++;
    uint32_t now = millis();

    if (now - lastStatus >= STATUS_MS) {               // soak status
#if defined(ESP32)
        Serial.printf("STATUS up %lu min · free %lu B · lowest %lu B · loop %lu passes/s · longest pass %lu us\n",
                      (unsigned long)(now / 60000), (unsigned long)ESP.getFreeHeap(),
                      (unsigned long)ESP.getMinFreeHeap(),
                      (unsigned long)(statusPasses * 1000UL / (now - lastStatus)),
                      (unsigned long)worstPassUs);
#endif
        lastStatus = now; statusPasses = 0; worstPassUs = 0;
    }
    if (!PardaloteStepper.attached(ID)) return;

    long pos = PardaloteStepper.position(ID);
    if (pos != lastPos) { lastMotion = now; lastPos = pos; }

    if (!moving && pos != startPos && PardaloteStepper.isRunning(ID)) {   // a move has started
        moving = true;
        moveStart = winStart = lastPrint = now;
        winPos = pos; peak = 0; passes = 0;
    }
    if (!moving) { startPos = pos; return; }

    if (now - winStart >= WINDOW_MS) {                 // peak speed over short windows
        float sps = labs(pos - winPos) * 1000.0f / (now - winStart);
        if (sps > peak && sps < JUMP_SPS) peak = sps;   // ignore setPosition() jumps
        winStart = now; winPos = pos;
    }
    if (LIVE_LINES && now - lastPrint >= PRINT_MS) {   // live readout
        Serial.printf("  pos %ld   peak so far %.0f steps/s   loop %lu passes/s\n",
                      pos, peak, (unsigned long)(passes * 1000UL / (now - lastPrint)));
        lastPrint = now; passes = 0;
    }
    if (now - lastMotion >= SETTLE_MS && !PardaloteStepper.isRunning(ID)) {   // the move is over
        uint32_t dt = lastMotion - moveStart;
        long d = labs(pos - startPos);
        Serial.printf("MOVE %ld steps in %lu ms — average %.0f steps/s, peak %.0f steps/s\n",
                      d, (unsigned long)dt, dt ? d * 1000.0f / dt : 0.0f, peak);
        moving = false;
        startPos = pos;
    }
}
