// Stub <AccelStepper.h> — host -fsyntax-only. Declarations only.
#pragma once
#include <Arduino.h>
class AccelStepper {
public:
    typedef enum { FUNCTION = 0, DRIVER = 1, FULL2WIRE = 2, FULL3WIRE = 3,
                   FULL4WIRE = 4, HALF3WIRE = 6, HALF4WIRE = 8 } MotorInterfaceType;
    AccelStepper(uint8_t = DRIVER, uint8_t = 2, uint8_t = 3, uint8_t = 4, uint8_t = 5, bool = true) {}
    void  moveTo(long) {}
    void  move(long) {}
    boolean run() { return false; }
    boolean runSpeed() { return false; }
    boolean runSpeedToPosition() { return false; }
    void  setMaxSpeed(float) {}
    float maxSpeed() { return 0; }
    void  setAcceleration(float) {}
    void  setSpeed(float) {}
    float speed() { return 0; }
    long  distanceToGo() { return 0; }
    long  targetPosition() { return 0; }
    long  currentPosition() { return 0; }
    void  setCurrentPosition(long) {}
    void  stop() {}
    void  disableOutputs() {}
    void  enableOutputs() {}
    void  setEnablePin(uint8_t = 0xff) {}
    void  setPinsInverted(bool = false, bool = false, bool = false) {}
    void  setPinsInverted(bool, bool, bool, bool, bool) {}
    bool  isRunning() { return false; }
};
