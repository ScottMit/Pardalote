// Sketch-shaped TU for the stub-compile harness: pulls in all three motion
// extensions and exercises the sketch-callable gesture() API (per-actuator
// gesture + onGestureDone, and the coordinated Pardalote.gesture() builder),
// so INSTALL_GESTURE, startGesture(), and the Access methods are all
// instantiated. Mirrors examples/board-gestures. -fsyntax-only only.
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteStepper.h>
#include <PardaloteBusServo.h>

int pan, tilt, lift, grip;

static const PardaloteSeg PAN_IDLE[]  = { { CURVE_EASE_IN_OUT, 1600, 60 }, { CURVE_EASE_IN_OUT, 1200, 90 } };
static const PardaloteSeg TILT_IDLE[] = { { CURVE_EASE_IN_OUT, 1400, 80 } };
static const PardaloteSeg LIFT_G[]    = { { CURVE_EASE_OUT, 500, 800 }, { CURVE_BACK, 400, 0 } };
static const PardaloteSeg GRIP_G[]    = { { CURVE_LINEAR, 300, 2048 } };

void onPanDone(int /*id*/) { PardaloteServo.gesture(pan, PAN_IDLE, 2); }

void setup() {
    Pardalote.begin();

    pan  = PardaloteServo.attach("pan", 9);
    tilt = PardaloteServo.attach("tilt", 10);
    lift = PardaloteStepper.attach("lift", 2, 3);
    grip = PardaloteBusServo.attach("grip", 1);

    // per-actuator gesture() + whenDone hook
    PardaloteServo.gesture(pan, PAN_IDLE, 2);
    PardaloteServo.onGestureDone(pan, onPanDone);
    PardaloteStepper.gesture(lift, LIFT_G, 2, 0);        // relative
    PardaloteBusServo.gesture(grip, GRIP_G, 1);
    PardaloteBusServo.onGestureDone(grip, [](int){});

    // coordinated, cross-type, padded — the group.gesture() twin
    Pardalote.gesture()
        .add(DEVICE_SERVO,   pan,  PAN_IDLE,  2)
        .add(DEVICE_SERVO,   tilt, TILT_IDLE, 1)
        .add(DEVICE_STEPPER, lift, LIFT_G,    2, false)
        .add(DEVICE_BUSSERVO, grip, GRIP_G,   1)
        .play();

    // coordinated one-shot write / writeTimed — the arduino.write() twins
    Pardalote.write()
        .add(DEVICE_SERVO,   pan,  90)
        .add(DEVICE_STEPPER, lift, 0)
        .play();
    Pardalote.writeTimed(1500)
        .add(DEVICE_SERVO,    pan,  45)
        .add(DEVICE_SERVO,    tilt, 135)
        .add(DEVICE_BUSSERVO, grip, 2048)
        .play();
}

void loop() {
    Pardalote.run();
}
