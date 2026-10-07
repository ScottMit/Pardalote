// ==============================================================
// paced_stepper.h — AccelStepper with error-compensated step timing
//
// AccelStepper::runSpeed() times each step from the moment the previous one
// ACTUALLY fired. A step can only fire when loop() calls it, so it usually
// lands a little late, and that lateness pushes every later step back too: the
// real speed rounds DOWN to a whole number of loop passes per step. Bench-
// measured with a ~30 µs Pardalote loop: 16,000 steps/s asked → 11,450 achieved,
// accelerated moves 25% slow.
//
// PardaloteStepperMotor is a small subclass that times each step from when it
// was DUE instead, so the average speed is exact (each step may still land up
// to one loop pass late). Short stalls are caught up on the next few passes —
// e.g. Pardalote's ~200 µs WebSocket poll once per ms, which otherwise cost ~1
// step per ms per 8,000 steps/s (bench: 16,000 asked → 13,500). Only a step more
// than PACED_RESYNC_US late (the loop was genuinely blocked) resyncs instead of
// bursting to catch up, which could make a motor miss steps. Pardalote calls the *Paced() methods instead of
// run() / runSpeed() / runSpeedToPosition(); everything else — pin handling,
// 4-wire motors, the acceleration maths — is the installed AccelStepper.
//
// Needs AccelStepper 1.64 or newer (the Library Manager version), which made
// stepForward() / stepBackward() available to subclasses.
// ==============================================================

#ifndef PARDALOTE_PACED_STEPPER_H
#define PARDALOTE_PACED_STEPPER_H

#include <AccelStepper.h>

class PardaloteStepperMotor : public AccelStepper {
public:
    // Lateness tolerated before resyncing (or one step interval, if longer):
    // covers routine loop stalls, never a genuine block.
    static const unsigned long PACED_RESYNC_US = 2000;

    using AccelStepper::AccelStepper;

    // runSpeed() with the next step timed from when the last one was DUE.
    // _idealUs is the ideal time of the last step; the current interval is added
    // at each check (as AccelStepper does), so a speed change takes effect at once.
    bool runSpeedPaced() {
        if (!_stepInterval) { _primed = false; return false; }   // stopped
        unsigned long now = micros();
        if (!_primed) { _idealUs = now - _stepInterval; _primed = true; }   // first step after a stop fires now
        unsigned long due = _idealUs + _stepInterval;
        if ((long)(now - due) < 0) return false;                  // not due yet
        if (_direction == DIRECTION_CW) stepForward(); else stepBackward();
        unsigned long resyncUs = (_stepInterval > PACED_RESYNC_US) ? _stepInterval : PACED_RESYNC_US;
        _idealUs = (now - due > resyncUs) ? now : due;            // badly late: resync, no burst
        return true;
    }

    // run() — accelerated move to the target — on the paced clock.
    bool runPaced() {
        if (runSpeedPaced()) computeNewSpeed();
        return speed() != 0.0f || distanceToGo() != 0;
    }

    // runSpeedToPosition() — constant speed, stop at the target — on the paced clock.
    bool runSpeedToPositionPaced() {
        long togo = distanceToGo();
        if (togo == 0) return false;
        _direction = (togo > 0) ? DIRECTION_CW : DIRECTION_CCW;
        return runSpeedPaced();
    }

private:
    unsigned long _idealUs = 0;      // ideal time of the last step (µs)
    bool          _primed  = false;  // _idealUs is valid (reset whenever the motor stops)
};

#endif
