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
// Future: DEVICE_OLED 203, DEVICE_MMWAVE 204

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
// I2C register reads in MPUExtension.h (see comments there).
// -------------------------------------------------------------------
#define DEVICE_MPU  203

#define CMD_MPU_ATTACH          0x28  // JS→Ar: [id, addr, modelCode, sda?, scl?]
#define CMD_MPU_DETACH          0x29  // JS→Ar: [id]
#define CMD_MPU_READ            0x2A  // JS→Ar: [id]
                                      // Ar→JS: [id, ax, ay, az, gx, gy, gz, temp]  (floats, g and °/s)
#define CMD_MPU_SET_ACCEL_RANGE 0x2B  // JS→Ar: [id, range]  0=±2g, 1=±4g, 2=±8g, 3=±16g
#define CMD_MPU_SET_GYRO_RANGE  0x2C  // JS→Ar: [id, range]  0=±250, 1=±500, 2=±1000, 3=±2000 °/s
#define CMD_MPU_CALIBRATE       0x2D  // JS→Ar: [id, samples?]
                                      // Ar→JS: [id, ax, ay, az, gx, gy, gz]  offset floats
// modelCode values are assigned by MPUExtension.h's SENSORS[] table (0-based index).
// See mpu.js MPU_MODELS for the JS-side name → code mapping.

#endif
