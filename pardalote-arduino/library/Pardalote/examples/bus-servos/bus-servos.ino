// ==============================================================
// Pardalote — Bus Servo example
//
// Including <PardaloteBusServo.h> is enough to add serial-bus servo
// support. The extension self-registers; no further setup is required.
//
// Requires the Feetech / Waveshare SCServo library (SMS_STS + SCSCL
// classes). Install "SCServo" by FT&WS from the Library Manager, or a ZIP
// from the Waveshare Bus Servo Adapter wiki / Feetech SDK.
//
// Hardware:
//   - A Waveshare Serial Bus Servo Driver board (or equivalent adapter)
//     wired to a hardware UART: UNO R4 WiFi → Serial1 (D0/D1),
//     ESP32 → Serial1 or Serial2 (set the pins with configureBus()).
//   - One or more Feetech ST/SMS (0–4095) or SC/SCS (0–1023) servos,
//     daisy-chained on the bus, each with a unique ID.
//   - The servos need their own power supply (6–7.4 V typical).
//
// Browser side:
//   arduino.add('joint', new BusServo());
//   arduino.on('ready', () => {
//       arduino.joint.attach(1);     // servo ID 1
//       arduino.joint.center();      // → 2048 (ST)
//   });
// ==============================================================

#include <Pardalote.h>
#include <PardaloteBusServo.h>

void setup() {
    Pardalote.begin();
    // USB instead of WiFi? Comment the line above and use this one, then pick
    // "USB" in the browser example. The servo bus stays on Serial1 (D0/D1) —
    // only the browser link moves to USB. Handy for ruling WiFi in or out when
    // the board resets near a servo's firmware limit.
    // Pardalote.begin(PARDALOTE_SERIAL);
}

void loop() {
    Pardalote.run();
}
