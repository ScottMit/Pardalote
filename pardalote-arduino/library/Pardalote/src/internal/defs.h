// ==============================================================
// defs.h
// Pardalote Protocol Constants
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

#ifndef DEFS_H
#define DEFS_H

// -------------------------------------------------------------------
// Protocol Version
// -------------------------------------------------------------------
#define PROTOCOL_VERSION_MAJOR 1
#define PROTOCOL_VERSION_MINOR 0

// -------------------------------------------------------------------
// ADC Resolution
// Default bits used by analogRead() on each platform.
// Override in your sketch before including Pardalote:
//   #define ADC_RESOLUTION_BITS 14   // e.g. after analogReadResolution(14)
// -------------------------------------------------------------------
#ifndef ADC_RESOLUTION_BITS
  #if defined(PLATFORM_UNO_R4)
    #define ADC_RESOLUTION_BITS 10   // Arduino compat default (hardware is 14-bit)
  #elif defined(PLATFORM_ESP32)
    #define ADC_RESOLUTION_BITS 12   // ESP32 default
  #else
    #define ADC_RESOLUTION_BITS 10   // safe fallback
  #endif
#endif

// -------------------------------------------------------------------
// Core Commands (CMD byte, 0x00–0x0A)
// Note: extension CMD values (0x0A+) are scoped to their device ID
// and are dispatched separately — there is no conflict.
// -------------------------------------------------------------------
#define CMD_HELLO         0x00  // Arduino → JS on connect: [major, minor, adcBits] + board string
#define CMD_ANNOUNCE      0x01  // Arduino → JS per extension: [version, maxInstances]
#define CMD_PIN_MODE      0x02  // JS → Arduino: set pin mode; Arduino → JS: announce pin config
#define CMD_DIGITAL_WRITE 0x03  // JS → Arduino: write value; Arduino → JS: announce output state
#define CMD_DIGITAL_READ  0x04
#define CMD_ANALOG_WRITE  0x05
#define CMD_ANALOG_READ   0x06
#define CMD_END           0x07  // Stop a periodic read
#define CMD_PING          0x08  // JS → Arduino: heartbeat request
#define CMD_PONG          0x09  // Arduino → JS: heartbeat response
#define CMD_SYNC_COMPLETE 0x0A  // Arduino → JS: all announce frames sent; JS fires 'ready'
#define CMD_MESSAGE       0x0B  // Both ways: user-defined key/value message (see Message Channel below)

// -------------------------------------------------------------------
// Pin tracking
// Upper bound on pin numbers the core will track for announce/re-register.
// Covers all pins on UNO R4 WiFi (~20) and ESP32 variants (~40).
// -------------------------------------------------------------------
#define MAX_PIN_NUMBER 64

// -------------------------------------------------------------------
// Pin Modes (param to CMD_PIN_MODE)
// -------------------------------------------------------------------
#define MODE_INPUT          0
#define MODE_OUTPUT         1
#define MODE_INPUT_PULLUP   2
#define MODE_INPUT_PULLDOWN 3   // ESP32 only
#define MODE_ANALOG_INPUT   8

// -------------------------------------------------------------------
// Extension Device IDs (TARGET >= 200)
// -------------------------------------------------------------------
#define RESERVED_START        200
#define DEVICE_NEO_PIXEL      200
#define DEVICE_SERVO          201
#define DEVICE_ULTRASONIC     202
// DEVICE_MPU 203, DEVICE_CAMERA 204 and DEVICE_STEPPER 205 are defined
// alongside their command blocks lower in this file. Next free ID: 206.

// -------------------------------------------------------------------
// NeoPixel Commands (0x0A–0x13)
// -------------------------------------------------------------------
#define CMD_NEO_INIT       0x0A  // params: [instanceId, pin, numPixels, type]
#define CMD_NEO_SET_PIXEL  0x0B  // params: [instanceId, index, r, g, b (, w)]
#define CMD_NEO_FILL       0x0C  // params: [instanceId, color, first, count]
#define CMD_NEO_CLEAR      0x0D  // params: [instanceId]
#define CMD_NEO_BRIGHTNESS 0x0E  // params: [instanceId, value]
#define CMD_NEO_SHOW       0x0F  // params: [instanceId]

// -------------------------------------------------------------------
// Servo Commands (0x14–0x1D)
// -------------------------------------------------------------------
#define CMD_SERVO_ATTACH             0x14  // params: [instanceId, pin, minPulse, maxPulse]
#define CMD_SERVO_DETACH             0x15  // params: [instanceId]
#define CMD_SERVO_WRITE              0x16  // params: [instanceId, angle]
#define CMD_SERVO_WRITE_MICROSECONDS 0x17  // params: [instanceId, microseconds]
#define CMD_SERVO_READ               0x18  // params: [instanceId]  — response: [instanceId, angle]
#define CMD_SERVO_ATTACHED           0x19  // params: [instanceId]  — response: [instanceId, 0|1]
#define CMD_SERVO_WRITE_TIMED        0x1A  // params: [instanceId, angle, durationMs] — board interpolates
#define CMD_SERVO_SYNC_TIMED         0x1B  // JS→Ar (global): [durationMs] + payload:
                                           //   N × { logicalId u8, targetAngle u8 } (2 bytes each)
                                           // All listed servos interpolate over the SAME duration → arrive together
#define CMD_SERVO_STOP               0x1C  // params: [instanceId] — cancel a timed move, hold current angle
#define CMD_SERVO_DONE          0x1D  // Ar→JS (unsolicited): [instanceId, angle] — timed move reached target
// Numbered after the stepper switch block (0x52–0x53) — the 0x14–0x1D servo
// block was full; dispatch is by (deviceId, cmd) so the gap is cosmetic only.
#define CMD_SERVO_SET_LIMITS    0x54  // JS→Ar: [instanceId, minAngle, maxAngle, enabled] — soft angle
                                      //   limits, clamped ON THE BOARD (browser and sketch writes alike).
                                      // Ar→JS (announce): same shape, replays limit state.

// -------------------------------------------------------------------
// Ultrasonic Commands (0x1E–0x27)
// -------------------------------------------------------------------
#define CMD_ULTRASONIC_ATTACH      0x1E  // params: [instanceId, trigPin, echoPin]
#define CMD_ULTRASONIC_DETACH      0x1F  // params: [instanceId]
#define CMD_ULTRASONIC_READ        0x20  // params: [instanceId, unit, interval]
#define CMD_ULTRASONIC_SET_TIMEOUT 0x21  // params: [instanceId, timeoutMs]

// -------------------------------------------------------------------
// Ultrasonic Units
// -------------------------------------------------------------------
#define UNIT_CM   0
#define UNIT_INCH 1

// -------------------------------------------------------------------
// MPU (6-DOF IMU) Device ID and Commands (0x28–0x2F)
// Designed for MPU-6050; adaptable to other I2C IMUs by swapping the
// I2C register reads in PardaloteMPU.h (see comments there).
// -------------------------------------------------------------------
#define DEVICE_MPU  203

// -------------------------------------------------------------------
// Camera Device ID and Commands (0x30–0x32)
// ESP32-S3 only — MJPEG stream and JPEG snapshot served over HTTP.
// -------------------------------------------------------------------
#define DEVICE_CAMERA          204

#define CMD_CAMERA_INIT        0x30  // JS→Ar: [id, port] — start camera + HTTP server
                                     // Ar→JS: [id, port] — confirms stream is live
#define CMD_CAMERA_SET_RES     0x31  // JS→Ar: [id, framesize]  (framesize_t enum value)
#define CMD_CAMERA_SET_QUALITY 0x32  // JS→Ar: [id, quality]    0 = best, 63 = worst

#define CMD_MPU_ATTACH          0x28  // JS→Ar: [id, addr, sda?, scl?] + model name string in payload
                                      // Ar→JS (announce): [id, addr] + model name string in payload
#define CMD_MPU_DETACH          0x29  // JS→Ar: [id]
#define CMD_MPU_READ            0x2A  // JS→Ar: [id]
                                      // Ar→JS: [id, ax, ay, az, gx, gy, gz, temp]  (floats, g and °/s)
#define CMD_MPU_SET_ACCEL_RANGE 0x2B  // JS→Ar: [id, range]  0=±2g, 1=±4g, 2=±8g, 3=±16g
#define CMD_MPU_SET_GYRO_RANGE  0x2C  // JS→Ar: [id, range]  0=±250, 1=±500, 2=±1000, 3=±2000 °/s
#define CMD_MPU_CALIBRATE       0x2D  // JS→Ar: [id, samples?]
                                      // Ar→JS: [id, ax, ay, az, gx, gy, gz]  offset floats
// Model name strings (e.g. "6050", "LSM6DSOX") are sent in the payload of
// CMD_MPU_ATTACH and matched against SENSORS[i].name in PardaloteMPU.h.
// See mpu.js MPU_MODELS for the JS-side list — row order in either table
// is irrelevant; the two are coupled by name only.

// -------------------------------------------------------------------
// Stepper Device ID and Commands (0x33–0x40)
// Motion executes on-board via AccelStepper::run() / runSpeed() in the
// extension loop hook. JS sends targets and motion profiles; the board
// generates the step pulses. Mirrors the AccelStepper API (non-blocking)
// rather than the built-in Stepper library (whose step() blocks and
// would stall Pardalote.run()).
//
// Requires the AccelStepper library (by Mike McCauley), installable via
// Arduino IDE → Manage Libraries.
// -------------------------------------------------------------------
#define DEVICE_STEPPER  205

#define CMD_STEPPER_ATTACH        0x33  // JS→Ar: [id, interface, pin1, pin2, pin3?, pin4?, enPin?, invertMask?]
                                        // Ar→JS (announce): same shape, replays attach state
#define CMD_STEPPER_DETACH        0x34  // JS→Ar: [id]
#define CMD_STEPPER_MOVE_TO       0x35  // JS→Ar: [id, absPosition]   — position mode, accel profile
#define CMD_STEPPER_MOVE          0x36  // JS→Ar: [id, relSteps]      — position mode, accel profile
#define CMD_STEPPER_SET_MAX_SPEED 0x37  // JS→Ar: [id, speed]         — steps/sec ceiling (int or float)
#define CMD_STEPPER_SET_ACCEL     0x38  // JS→Ar: [id, accel]         — steps/sec^2 (int or float)
#define CMD_STEPPER_RUN_SPEED     0x39  // JS→Ar: [id, speed]         — velocity mode, continuous rotation
#define CMD_STEPPER_STOP          0x3A  // JS→Ar: [id]                — decelerate to a stop
#define CMD_STEPPER_SET_POSITION  0x3B  // JS→Ar: [id, position]      — setCurrentPosition (zero / manual home)
#define CMD_STEPPER_ENABLE        0x3C  // JS→Ar: [id, enable]        — EN pin: 1=hold torque, 0=release
#define CMD_STEPPER_SET_LIMITS    0x3D  // JS→Ar: [id, min, max, enabled] — soft position limits (safety)
#define CMD_STEPPER_READ          0x3E  // JS→Ar: [id]
                                        // Ar→JS: [id, position, distanceToGo, speed(f), isRunning]
#define CMD_STEPPER_DONE          0x3F  // Ar→JS (unsolicited): [id, position] — position-mode target reached
#define CMD_STEPPER_HOME          0x40  // JS→Ar: [id, speed?, timeoutMs?] — run the homing routine: seek
                                        //   the limit switch (MIN if configured, else MAX) at `speed`
                                        //   (0 = default, maxSpeed/4), on trip set the counter to the
                                        //   switch's declared coordinate (SET_SWITCH_POS, default 0), back
                                        //   off until released, then travel to home — the origin, 0. DONE
                                        //   fires on arrival. With no switch: plain accel move to 0.
                                        //   timeoutMs caps the SEEK+BACKOFF legs (0 = default 30 s) —
                                        //   an unplugged/stuck switch can't spin the motor forever.
                                        // Ar→JS (unsolicited): [id, position] — homing GAVE UP (timeout);
                                        //   motor hard-stopped where it was. DONE follows (motion settled).
// Timed / coordinated moves. Numbered after the bus-servo block (0x41–0x4E)
// because the 0x33–0x40 stepper block was full; dispatch is by (deviceId, cmd)
// so the numeric gap is cosmetic only.
#define CMD_STEPPER_MOVE_TIMED    0x4F  // JS→Ar: [id, target, durationMs] — arrive in ~duration (constant speed)
#define CMD_STEPPER_SYNC_MOVE     0x50  // JS→Ar (global): [durationMs] + payload:
                                        //   N × { logicalId u8, target i32 } (5 bytes each)
                                        // Board computes matched speeds from its own positions → arrive together
// Limit switches (0x51 is CMD_BUSSERVO_DONE — numbered after it, same
// cosmetic-gap note as 0x4F–0x50).
#define CMD_STEPPER_SET_SWITCH    0x52  // JS→Ar: [id, which, pin, trigger] — configure one limit switch.
                                        //   which: LIMIT_MIN/LIMIT_MAX; pin -1 = clear; trigger 0=LOW,
                                        //   1=HIGH. The coordinate the switch sits at is set separately by
                                        //   SET_SWITCH_POS (default 0).
                                        // Ar→JS (announce): same shape, replays each configured switch.
#define CMD_STEPPER_LIMIT         0x53  // Ar→JS (unsolicited): [id, which, position] — switch tripped,
                                        //   motion was hard-stopped on the board. CMD_STEPPER_DONE follows.
#define CMD_STEPPER_SET_SWITCH_POS 0x54 // JS→Ar: [id, which, coord] — declare the coordinate a limit switch
                                        //   physically sits at, INDEPENDENT of the soft limits. Homing
                                        //   adopts this coordinate when the switch trips (default 0 = the
                                        //   switch is the origin). Lets home sit anywhere relative to the
                                        //   switch (e.g. switch at -500, home the origin at 0).
                                        // Ar→JS (echo + announce): same shape — silent JS sync.
#define CMD_STEPPER_SET_HOME      0x55  // JS→Ar: [id, value?] — re-zero the coordinate frame: the current
                                        //   physical position BECOMES `value` (default 0 = the origin/home).
                                        //   Soft limits and switch positions shift by the same offset so
                                        //   they keep pointing at the same physical spots. home() returns
                                        //   to the origin (0).
                                        // Ar→JS (echo): the board broadcasts the shifted SET_POSITION,
                                        //   SET_LIMITS and SET_SWITCH_POS frames — silent JS sync.
// Uses the next-free device-scoped code (0x57; 0x56 is CMD_SHARE) — sits
// outside the 0x3x stepper block by allocation order, not by category.
#define CMD_STEPPER_HARD_STOP     0x57  // JS→Ar: [id] — instant halt, no decel ramp (cf. CMD_STEPPER_STOP,
                                        //   which decelerates). Keeps the current position; DONE follows.

// -------------------------------------------------------------------
// Sketch-created hardware objects (Ar→JS)
//
// The sketch-facing API is the same verb the browser uses — e.g.
// PardaloteServo.attach("pan", 9) — creation and browser visibility are
// one act (unlike raw pins, where the hardware exists outside Pardalote
// and share() only informs). On the wire, the board tells browsers about
// the new object with CMD_SHARE: a device-scoped command like any other,
// but the VALUE is reserved across ALL extension device IDs — the JS
// core intercepts it generically (before per-instance routing) and
// materialises a browser object of the right class. Shape, for every
// device type:
//
//   Ar→JS: [logicalId] + payload: UTF-8 name → browser creates the
//   extension instance and binds it as arduino.<name>. The normal
//   announce/state frames (ATTACH, WRITE, …) follow and sync it.
//
// Board-created objects allocate logical ids from the TOP of each
// extension's range downward; browser-created ids grow from 0 upward,
// so the two sides can't collide until the range is full.
// Currently implemented by: DEVICE_SERVO.
// -------------------------------------------------------------------
#define CMD_SHARE  0x56

// Longest browser-visible name a sketch can give an object (excl. NUL).
#define MAX_SHARE_NAME  15

// Limit-switch ends (param 1 of SET_SWITCH / LIMIT). Named LIMIT_* because
// some cores define MIN/MAX macros.
#define LIMIT_MIN  0
#define LIMIT_MAX  1

// Stepper interface types (param 1 of CMD_STEPPER_ATTACH) — match AccelStepper
#define STEPPER_DRIVER     1   // STEP/DIR: pin1=STEP, pin2=DIR (TMC2208/2209, A4988, EasyDriver)
#define STEPPER_FULL4WIRE  4   // 4 coil pins (28BYJ-48 via ULN2003, bare bipolar via H-bridge)

// invertMask bits (optional param of CMD_STEPPER_ATTACH):
//   bit0 = DIR inverted, bit1 = STEP inverted, bit2 = ENABLE inverted.
// ENABLE defaults to inverted (mask 0x04) — most driver EN pins are active-LOW.

// -------------------------------------------------------------------
// Bus Servo Device ID and Commands (0x41–0x4E)
// Serial-bus smart servos (Feetech ST/SMS and SC/SCS series) on a shared
// half-duplex UART, e.g. via a Waveshare Serial Bus Servo Driver board.
// Unlike PWM servos, all bus servos share ONE UART and are addressed by a
// hardware servo ID (1–253); positions are raw encoder counts
// (ST: 0–4095, SC: 0–1023), not degrees.
//
// Requires the Feetech/Waveshare SCServo library (SMS_STS + SCSCL classes),
// which handles the packet protocol, half-duplex direction, and the
// sign-magnitude encoding of the offset/speed registers for us.
// -------------------------------------------------------------------
#define DEVICE_BUSSERVO  206

#define CMD_BUSSERVO_BUS_CONFIG  0x41  // JS→Ar (global): [serialIndex, baud, rxPin, txPin]
#define CMD_BUSSERVO_ATTACH      0x42  // JS→Ar: [id, servoId, series]  series 0=ST(0-4095), 1=SC(0-1023)
#define CMD_BUSSERVO_DETACH      0x43  // JS→Ar: [id]
#define CMD_BUSSERVO_WRITE       0x44  // JS→Ar: [id, position, speed, acc]  position-mode goal (counts)
#define CMD_BUSSERVO_WRITE_SPEED 0x45  // JS→Ar: [id, speed, acc]  wheel-mode speed (sign = direction)
#define CMD_BUSSERVO_SET_MODE    0x46  // JS→Ar: [id, mode]  0=position, 1=wheel (continuous)
#define CMD_BUSSERVO_TORQUE      0x47  // JS→Ar: [id, enable]  0 = go limp (hand-pose / read)
#define CMD_BUSSERVO_READ        0x48  // JS→Ar: [id]
                                       // Ar→JS: [id, position, speed, load, voltage, temp, current]
#define CMD_BUSSERVO_SET_LIMITS  0x49  // JS→Ar: [id, minPos, maxPos, enabled] — soft position limits,
                                       //   clamped ON THE BOARD (RAM only; deliberately does NOT touch
                                       //   the servo's EEPROM limit registers — no wear, no unverified
                                       //   unLockEprom path).
#define CMD_BUSSERVO_CALIBRATE   0x4A  // JS→Ar: [id]  set current position as centre (homing offset)
#define CMD_BUSSERVO_SET_ID      0x4B  // JS→Ar: [id, newServoId]  (renumber — one servo on the bus!)
#define CMD_BUSSERVO_PING        0x4C  // JS→Ar: [id, servoId]  Ar→JS: [id, servoId, found]
#define CMD_BUSSERVO_SCAN        0x4D  // JS→Ar: [firstId, lastId]  Ar→JS: [count, id1, id2, ...]
#define CMD_BUSSERVO_SYNC_WRITE  0x4E  // JS→Ar (global): [series] + payload:
                                       //   N × { servoId u8, position i16, speed u16, acc u8 } (6 bytes each)
                                       // One hardware SyncWrite packet — all listed servos latch together.
// (0x4F–0x50 are stepper timed commands, numbered after this block.)
#define CMD_BUSSERVO_DONE        0x51  // Ar→JS (unsolicited): [id, position] — servo settled at its goal.
                                       // The board polls the servo's Moving flag after a write and emits this
                                       // when it stops, so bus servos get a done like steppers/servos.

// Series (param 2 of CMD_BUSSERVO_ATTACH)
#define BUSSERVO_SERIES_ST  0   // STS / SMS series — 0–4095 counts (STS3215 etc.)
#define BUSSERVO_SERIES_SC  1   // SCS series      — 0–1023 counts (SCS15 etc.)

// Operating mode (param of CMD_BUSSERVO_SET_MODE)
#define BUSSERVO_MODE_POSITION  0
#define BUSSERVO_MODE_WHEEL     1

// -------------------------------------------------------------------
// Message Channel (CMD_MESSAGE 0x0B) — user-defined key/value messages
// that aren't tied to any pin or hardware device. Symmetric: the same
// frame shape flows JS→Ar and Ar→JS.
//
// Routed by CMD (like HELLO/ANNOUNCE/PONG), NOT by the target range —
// the flags in the TARGET high byte can push it past RESERVED_START, so
// the target range check would misroute it to the extension dispatch.
//
// Frame:
//   TARGET      low byte  = value type (MSG_TYPE_*)
//               high byte = flags (MSG_FLAG_*)
//   NPARAMS     = 1 for INT/BOOL/FLOAT/CHAR (the value) ; 0 for TEXT/BLOB
//   TYPE_MASK   = bit0 set iff FLOAT (so the param decodes as float32)
//   PAYLOAD     = [keyLen:u8][key UTF-8 …][value bytes … (TEXT/BLOB only)]
// -------------------------------------------------------------------
#define MSG_TYPE_INT    0   // int32 param
#define MSG_TYPE_BOOL   1   // int32 param (0/1)
#define MSG_TYPE_FLOAT  2   // float32 param (TYPE_MASK bit0 set)
#define MSG_TYPE_CHAR   3   // int32 param (one code unit)
#define MSG_TYPE_TEXT   4   // UTF-8 string in payload (after the key)
#define MSG_TYPE_BLOB   5   // raw bytes in payload (after the key)

// TARGET high-byte flags.
#define MSG_FLAG_RETAIN     0x01  // board stores the latest value, replays it on connect
#define MSG_FLAG_BROADCAST  0x02  // board relays a browser message to the OTHER browsers too

// Pack / unpack the TARGET field of a message frame.
#define MSG_TARGET(type, flags)  ((uint16_t)(((uint16_t)(flags) << 8) | ((type) & 0xFF)))
#define MSG_TYPE(target)         ((uint8_t)((target) & 0xFF))
#define MSG_FLAGS(target)        ((uint8_t)(((target) >> 8) & 0xFF))

// Longest message key (excl. NUL). Keys are length-prefixed with a u8.
#define MAX_MESSAGE_KEY  24

#endif
