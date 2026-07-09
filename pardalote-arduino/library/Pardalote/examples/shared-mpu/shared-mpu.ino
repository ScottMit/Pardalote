// ==============================================================
// Pardalote — Shared MPU / IMU
//
// The SKETCH creates the IMU:
//
//     imu = PardaloteMPU.attach("imu", "6050");
//
// and the browser sees it automatically as arduino.imu — a full MPU
// instance, identical to one created with arduino.add(). No JS-side
// setup at all.
//
// The sketch reads accel/gyro locally while the browser can poll
// arduino.imu on its own timer.
//
// Models: "6050" / "6500" / "9250" / "9255" (I2C 0x68), "LSM6DS3" /
// "LSM6DSOX" (0x6A). Pass an address for the AD0-HIGH variant, e.g.
//   imu = PardaloteMPU.attach("imu", "6050", 0x69);
//
// Wiring:
//   SDA → SDA, SCL → SCL, 3.3 V (or per your board) + GND.
// ==============================================================

#include <Pardalote.h>
#include <PardaloteMPU.h>

int imu = -1;                     // logical id, assigned by attach()
unsigned long lastRead = 0;

void setup() {
    Pardalote.begin();

    // Create the IMU and make it visible to every browser as arduino.imu.
    imu = PardaloteMPU.attach("imu", "6050");

    // Optional: place flat & still, then zero the offsets.
    // PardaloteMPU.calibrate(imu);
}

void loop() {
    Pardalote.run();

    // Read on-board a few times a second.
    if (millis() - lastRead > 200) {
        lastRead = millis();
        PardaloteMPUReading r = PardaloteMPU.read(imu);
        if (r.ok && r.az > 0.8) Serial.println(F("right way up"));
    }
}
