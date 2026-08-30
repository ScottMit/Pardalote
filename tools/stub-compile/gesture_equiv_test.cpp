// ==============================================================
// Byte-equivalence check — board startGesture() vs the JS gesture() wire path.
//
// A board-authored gesture (PardaloteServo.gesture / startGesture) and a
// JS-authored one (servo.gesture -> CMD_SERVO_GESTURE frame -> firmware
// unpack) must PLAY identically. This test replicates the exact field logic
// of both paths — copied verbatim from the sources named below — and compares
// (a) the stored Seg {curve,dur,value} and (b) the target loadSegment() will
// actually drive to, across in-range/out-of-range/relative/zero-dur cases.
//
// Sources mirrored (servo; stepper/bus share the same structure):
//   JS encode ...... lib/src/pardalote-servo.js  _gestureBlock()
//   wire unpack .... PardaloteServo.h  handle() CMD_SERVO_GESTURE branch
//   board fill ..... PardaloteServo.h  startGesture()
//   play target .... PardaloteServo.h  loadSegment()
//
// Build+run:  g++ -std=gnu++17 gesture_equiv_test.cpp -o /tmp/ge && /tmp/ge
// ==============================================================
#include <cstdint>
#include <cstdio>
#include <cmath>

// clampAngle() from PardaloteServo.h: constrain 0..180, then soft limits.
static int clampAngle(long angle, bool limSet, int lo, int hi) {
    if (angle < 0) angle = 0;
    if (angle > 180) angle = 180;
    if (limSet) { if (angle < lo) angle = lo; if (angle > hi) angle = hi; }
    return (int)angle;
}

struct Seg { uint8_t curve; uint16_t dur; int32_t value; };

// What a sketch/JS author expresses for one segment.
struct InSeg { uint8_t curve; long dur; bool absolute; long value; };  // value = to (abs) or by (rel)

// ---- JS _gestureBlock encode (servo): dur=max(1,round); absolute pre-clamps
//      the target, relative sends the raw delta; pack {curve u8, dur u16 BE,
//      value i32 BE}. ----
static void js_encode(const InSeg& s, bool limSet, int lo, int hi, uint8_t out[7]) {
    long dur = s.dur < 1 ? 1 : s.dur;
    long val = s.absolute ? clampAngle(s.value, limSet, lo, hi) : s.value;
    out[0] = s.curve;
    out[1] = (uint8_t)((dur >> 8) & 0xFF); out[2] = (uint8_t)(dur & 0xFF);
    out[3] = (uint8_t)((val >> 24) & 0xFF); out[4] = (uint8_t)((val >> 16) & 0xFF);
    out[5] = (uint8_t)((val >> 8) & 0xFF);  out[6] = (uint8_t)(val & 0xFF);
}

// ---- firmware wire unpack (handle CMD_SERVO_GESTURE) ----
static Seg fw_unpack(const uint8_t r[7]) {
    Seg s;
    s.curve = r[0];
    s.dur   = (uint16_t)(((uint16_t)r[1] << 8) | r[2]);
    s.value = (int32_t)(((uint32_t)r[3] << 24) | ((uint32_t)r[4] << 16) |
                        ((uint32_t)r[5] << 8)  |  (uint32_t)r[6]);
    return s;
}

// ---- board startGesture() field fill (dur guard; value stored RAW) ----
static Seg board_fill(const InSeg& s) {
    Seg o;
    o.curve = s.curve;
    o.dur   = s.dur ? (uint16_t)s.dur : 1;
    o.value = (int32_t)s.value;   // NOT pre-clamped — loadSegment clamps
    return o;
}

// ---- loadSegment() played target: absolute -> value; relative -> base+value;
//      then clampAngle. This is the byte that actually reaches the servo. ----
static int play_target(const Seg& seg, bool absolute, int base, bool limSet, int lo, int hi) {
    long target = absolute ? seg.value : (long)base + seg.value;
    return clampAngle(target, limSet, lo, hi);
}

int main() {
    struct Case { const char* name; InSeg in; int base; bool limSet; int lo; int hi; };
    Case cases[] = {
        { "abs in-range",        { 2, 400, true,   90 },  0, false, 0, 0 },
        { "abs out-of-range hi", { 4, 260, true,  250 },  0, false, 0, 0 },
        { "abs out-of-range lo", { 0, 300, true,  -30 },  0, false, 0, 0 },
        { "abs vs soft-limit",   { 3, 500, true,  170 }, 90, true, 30, 120 },
        { "relative +",          { 2, 250, false,  30 }, 90, false, 0, 0 },
        { "relative - clamps",   { 1, 250, false,-200 }, 90, false, 0, 0 },
        { "zero dur -> 1",       { 0,   0, true,   45 },  0, false, 0, 0 },
        { "big value/dur",       { 4, 65535, true, 4095}, 0, false, 0, 0 },
    };

    int segMismatch = 0, playMismatch = 0;
    printf("%-22s | seg(wire)      seg(board)     seg== | play wire/board  play==\n", "case");
    printf("-----------------------+------------------------------------+-------------------------\n");
    for (const auto& c : cases) {
        uint8_t bytes[7];
        js_encode(c.in, c.limSet, c.lo, c.hi, bytes);
        Seg w = fw_unpack(bytes);
        Seg b = board_fill(c.in);
        bool segEq  = (w.curve == b.curve && w.dur == b.dur && w.value == b.value);
        int  pw = play_target(w, c.in.absolute, c.base, c.limSet, c.lo, c.hi);
        int  pb = play_target(b, c.in.absolute, c.base, c.limSet, c.lo, c.hi);
        bool playEq = (pw == pb);
        if (!segEq)  segMismatch++;
        if (!playEq) playMismatch++;
        printf("%-22s | {%d,%u,%d} {%d,%u,%d} %-5s | %4d / %-4d      %s\n",
               c.name, w.curve, w.dur, w.value, b.curve, b.dur, b.value,
               segEq ? "yes" : "NO",
               pw, pb, playEq ? "yes" : "NO <<<");
    }

    printf("\nseg-store mismatches: %d   PLAYED-target mismatches: %d\n", segMismatch, playMismatch);
    printf("%s\n", playMismatch == 0
        ? "PASS — board and JS gestures PLAY identically (loadSegment is the single clamp authority)."
        : "FAIL — a played target differs.");
    return playMismatch == 0 ? 0 : 1;
}
