// ==============================================================
// defs.h
// Protocol IDs and Action Codes
// Version v0.14
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

#ifndef DEFS_H
#define DEFS_H

// -------------------------------------------------------------------
// Core Actions (1-99)
// -------------------------------------------------------------------
#define PIN_MODE       1
#define DIGITAL_WRITE  2
#define DIGITAL_READ   3
#define ANALOG_WRITE   4
#define ANALOG_READ    5
#define END            6    // Stop a registered action

// -------------------------------------------------------------------
// Extension Device IDs (200+)
// -------------------------------------------------------------------
#define RESERVED_START 200
#define NEO_PIXEL      200
#define SERVO_CONTROL  201
#define ULTRASONIC_CONTROL 202

// -------------------------------------------------------------------
// NeoPixel Extension Actions (10-19)
// -------------------------------------------------------------------
#define NEO_INIT          10     // Setup strip: params = [stripId, pin, numPixels, type]
#define NEO_SET_PIXEL     11     // Set single pixel: params = [stripId, index, r, g, b (, w)]
#define NEO_FILL          12     // Fill range: params = [stripId, color, first, count]
#define NEO_CLEAR         13     // Clear all pixels: params = [stripId]
#define NEO_BRIGHTNESS    14     // Set global brightness: params = [stripId, value]
#define NEO_SHOW          15     // Push buffer to LEDs: params = [stripId]

// -------------------------------------------------------------------
// Servo Extension Actions (20-29)
// -------------------------------------------------------------------
#define SERVO_ATTACH      20     // Attach servo: params = [servoId, pin]
#define SERVO_DETACH      21     // Detach servo: params = [servoId]
#define SERVO_WRITE       22     // Write angle: params = [servoId, angle]
#define SERVO_WRITE_MICROSECONDS 23 // Write microseconds: params = [servoId, microseconds]
#define SERVO_READ        24     // Read current angle: params = [servoId]
#define SERVO_ATTACHED    25     // Check if attached: params = [servoId]

// -------------------------------------------------------------------
// Ultrasonic Extension Actions (30-39)
// -------------------------------------------------------------------
#define ULTRASONIC_ATTACH     30     // Attach sensor: params = [sensorId, trigPin, echoPin] (echoPin = -1 for 3-wire)
#define ULTRASONIC_DETACH     31     // Detach sensor: params = [sensorId]
#define ULTRASONIC_READ       32     // Read distance: params = [sensorId, unit] (0=CM, 1=INCH)
#define ULTRASONIC_SET_TIMEOUT 33    // Set timeout: params = [sensorId, timeoutMs]

// -------------------------------------------------------------------
// Future Extension IDs
// -------------------------------------------------------------------
// #define LCD_DISPLAY    202
// #define SENSOR_HUB     203

#endif