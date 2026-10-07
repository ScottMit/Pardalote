// stepper-test.pde
//
//

#include <AccelStepper.h>

// Define some steppers and the pins they will use
AccelStepper stepper1(AccelStepper::DRIVER, 14, 12);
// AccelStepper stepper2(AccelStepper::FULL4WIRE, 6, 7, 8, 9);
// AccelStepper stepper3(AccelStepper::FULL2WIRE, 10, 11);

int targetSteps = 1600*8;

unsigned long legStart = 0;

void setup() {
  Serial.begin(115200);
  stepper1.setMaxSpeed(20000.0);
  stepper1.setAcceleration(15000.0);
  stepper1.moveTo(targetSteps);
  legStart = millis();
}

void loop() {
  if (stepper1.distanceToGo() == 0) {
    Serial.printf("leg took %lu ms\n", millis() - legStart);   // only at the end of a leg
    targetSteps = -targetSteps;
    stepper1.moveTo(targetSteps);
    legStart = millis();
  }
  stepper1.run();
}