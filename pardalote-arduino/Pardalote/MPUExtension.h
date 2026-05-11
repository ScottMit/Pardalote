// ==============================================================
// MPUExtension.h
// Pardalote Generic IMU Extension
// Version v1.1
// by Scott Mitchell
// GPL-3.0 License
//
// Include this file in Pardalote.ino to add IMU support.
// No other changes to the sketch are required.
//
//   #include "MPUExtension.h"
//
// Supports multiple sensor families through a descriptor table.
// The JS side selects the sensor by passing a modelCode in the
// CMD_MPU_ATTACH frame. See mpu.js for the name → code mapping.
//
// Currently supported sensors (SENSORS[] table, code = index):
//   0  MPU-6050   TDK InvenSense   6-DOF   I2C 0x68 / 0x69
//   1  MPU-6500   TDK InvenSense   6-DOF   I2C 0x68 / 0x69
//   2  MPU-9250   TDK InvenSense   9-DOF*  I2C 0x68 / 0x69
//   3  MPU-9255   TDK InvenSense   9-DOF*  I2C 0x68 / 0x69
//   4  LSM6DS3    STMicroelectronics  6-DOF I2C 0x6A / 0x6B
//   5  LSM6DSOX   STMicroelectronics  6-DOF I2C 0x6A / 0x6B
//   (* magnetometer not yet implemented — 6-DOF data only)
//
// Adding a new sensor:
//   1. Add scale arrays if the sensor uses different sensitivity values.
//   2. Add a row to SENSORS[] with the correct register addresses,
//      byte offsets, and endianness. The model name appears in Serial
//      debug output only — the actual lookup uses the table index.
//   3. Add a matching entry to MPU_MODELS in mpu.js.
//   Everything else — the protocol, commands, calibration — is generic.
//
// Response data (CMD_MPU_READ):
//   ax, ay, az  in g         (float, calibration-corrected)
//   gx, gy, gz  in °/s       (float, calibration-corrected)
//   temp        in °C         (float, sensor formula applied)
// ==============================================================

#ifndef MPU_EXTENSION_H
#define MPU_EXTENSION_H

#include <Wire.h>
#include "defs.h"
#include "protocol.h"
#include "extensions.h"

#define MAX_MPUS 2

// -------------------------------------------------------------------
// Sensor descriptor — one row per supported sensor in SENSORS[].
//
// To add a sensor, fill in all fields from the datasheet and push
// a new row onto the end of SENSORS[]. Match it with a new entry
// in mpu.js MPU_MODELS with code = that row's index.
// -------------------------------------------------------------------
struct SensorDef {
    const char*    name;         // for Serial debug messages

    uint8_t        dof;          // 6 or 9 (9 = has magnetometer, data not yet sent)

    // WHO_AM_I identity check — run once on attach.
    uint8_t        whoReg;       // register address of WHO_AM_I
    uint8_t        whoVal;       // expected value

    // Pre-init write — runs before the WHO_AM_I check.
    // For MPU family: clears SLEEP bit in PWR_MGMT_1 (0x6B → 0x00).
    // For LSM6 family: sets BDU and IF_INC in CTRL3_C (0x12 → 0x44).
    // Set preReg = 0 to skip.
    uint8_t        preReg;
    uint8_t        preVal;
    uint8_t        preDelayMs;   // settling time after the write

    // 14-byte data burst — all sensors pack accel + temp + gyro into
    // a contiguous block readable with a single I2C transaction.
    uint8_t        dataStart;    // first register of the block
    bool           littleEndian; // false = MSB first (MPU), true = LSB first (LSM6)

    // Byte offsets within the 14-byte block for each measurement.
    // Each offset points to the first byte of a 2-byte signed value.
    // For big-endian: first byte = high byte.
    // For little-endian: first byte = low byte.
    uint8_t        axOff, ayOff, azOff;  // accelerometer
    uint8_t        txOff;                // temperature
    uint8_t        gxOff, gyOff, gzOff;  // gyroscope

    // Range configuration registers
    uint8_t        accelCfgReg;
    uint8_t        gyroCfgReg;

    // Scale tables — indexed by range param (0–3).
    // accelFs/gyroFs contain the full byte written to the config register.
    // For MPU family these are pure FS bits; for LSM6 they include ODR bits.
    const float*   accelLsb;   // [4] inverse sensitivity: LSB per g
    const float*   gyroLsb;    // [4] inverse sensitivity: LSB per °/s
    const uint8_t* accelFs;    // [4] byte written to accelCfgReg for each range
    const uint8_t* gyroFs;     // [4] byte written to gyroCfgReg  for each range

    // Temperature formula: temp_°C = raw_int16 / tempDiv + tempOff
    float          tempDiv;
    float          tempOff;
};

// -------------------------------------------------------------------
// Scale and config tables
// -------------------------------------------------------------------

// MPU family — same sensitivity across 6050, 6500, 9250, 9255
static const float    MPU_A_LSB[4] = { 16384.0f, 8192.0f, 4096.0f, 2048.0f };
static const float    MPU_G_LSB[4] = { 131.0f, 65.5f, 32.8f, 16.4f };
static const uint8_t  MPU_A_FS[4]  = { 0x00, 0x08, 0x10, 0x18 };   // AFS_SEL bits → ACCEL_CONFIG (0x1C)
static const uint8_t  MPU_G_FS[4]  = { 0x00, 0x08, 0x10, 0x18 };   // FS_SEL bits  → GYRO_CONFIG  (0x1B)

// LSM6 family — ±2g/4g/8g/16g accel; ±250/500/1000/2000 °/s gyro
// Full register bytes include ODR=416 Hz (bits [7:4] = 0x07) ORed with FS bits.
// Accel CTRL1_XL: FS bits [3:2] → 00=±2g 10=±4g 11=±8g 01=±16g
// Gyro  CTRL2_G : FS bits [3:1] → 000=±250 010=±500 011=±1000 100=±2000
static const float    LSM_A_LSB[4] = { 16393.0f, 8197.0f, 4098.0f, 2049.0f };
static const float    LSM_G_LSB[4] = { 114.3f, 57.1f, 28.6f, 14.3f };
static const uint8_t  LSM_A_FS[4]  = { 0x70, 0x78, 0x7C, 0x74 };   // ODR|FS → CTRL1_XL (0x10)
static const uint8_t  LSM_G_FS[4]  = { 0x70, 0x74, 0x76, 0x78 };   // ODR|FS → CTRL2_G  (0x11)

// -------------------------------------------------------------------
// Sensor table — each row is one supported sensor.
// The JS modelCode is the row index (0-based).
//
// MPU data block (big-endian, 14 bytes from 0x3B):
//   [0-1]=AX  [2-3]=AY  [4-5]=AZ  [6-7]=TEMP  [8-9]=GX  [10-11]=GY  [12-13]=GZ
//
// LSM6 data block (little-endian, 14 bytes from 0x20):
//   [0-1]=TEMP  [2-3]=GX  [4-5]=GY  [6-7]=GZ  [8-9]=AX  [10-11]=AY  [12-13]=AZ
// -------------------------------------------------------------------
static const SensorDef SENSORS[] = {
// ── TDK InvenSense MPU family ─────────────────────────────────────────────────────────
//  name         dof  whoReg  whoVal  preReg  preVal  preDelay  dataStart  LE
//               axOff ayOff azOff txOff gxOff gyOff gzOff  accelCfg  gyroCfg
//               accelLsb  gyroLsb  accelFs  gyroFs  tempDiv  tempOff
    { "MPU-6050",  6,  0x75, 0x68,   0x6B,  0x00,    10,      0x3B,    false,
      0, 2, 4, 6, 8, 10, 12,   0x1C, 0x1B,
      MPU_A_LSB, MPU_G_LSB, MPU_A_FS, MPU_G_FS,   340.0f, 36.53f },

    { "MPU-6500",  6,  0x75, 0x70,   0x6B,  0x00,    10,      0x3B,    false,
      0, 2, 4, 6, 8, 10, 12,   0x1C, 0x1B,
      MPU_A_LSB, MPU_G_LSB, MPU_A_FS, MPU_G_FS,   340.0f, 36.53f },

    { "MPU-9250",  9,  0x75, 0x71,   0x6B,  0x00,    10,      0x3B,    false,
      0, 2, 4, 6, 8, 10, 12,   0x1C, 0x1B,
      MPU_A_LSB, MPU_G_LSB, MPU_A_FS, MPU_G_FS,   340.0f, 36.53f },

    { "MPU-9255",  9,  0x75, 0x73,   0x6B,  0x00,    10,      0x3B,    false,
      0, 2, 4, 6, 8, 10, 12,   0x1C, 0x1B,
      MPU_A_LSB, MPU_G_LSB, MPU_A_FS, MPU_G_FS,   340.0f, 36.53f },

// ── STMicroelectronics LSM6 family ────────────────────────────────────────────────────
//  name         dof  whoReg  whoVal  preReg  preVal  preDelay  dataStart  LE
//               axOff ayOff azOff txOff gxOff gyOff gzOff  accelCfg  gyroCfg
//               accelLsb  gyroLsb  accelFs  gyroFs  tempDiv  tempOff
    { "LSM6DS3",   6,  0x0F, 0x69,   0x12,  0x44,     5,      0x20,    true,
      8, 10, 12, 0, 2, 4, 6,   0x10, 0x11,
      LSM_A_LSB, LSM_G_LSB, LSM_A_FS, LSM_G_FS,   256.0f, 25.0f },

    { "LSM6DSOX",  6,  0x0F, 0x6C,   0x12,  0x44,     5,      0x20,    true,
      8, 10, 12, 0, 2, 4, 6,   0x10, 0x11,
      LSM_A_LSB, LSM_G_LSB, LSM_A_FS, LSM_G_FS,   256.0f, 25.0f },
};
static constexpr uint8_t NUM_SENSORS = sizeof(SENSORS) / sizeof(SENSORS[0]);

// -------------------------------------------------------------------
// MpuExt — extension class
// -------------------------------------------------------------------
class MpuExt {
private:
    static uint8_t            _addr[MAX_MPUS];
    static uint8_t            _accelRange[MAX_MPUS];
    static uint8_t            _gyroRange[MAX_MPUS];
    static bool               _attached[MAX_MPUS];
    static bool               _calibrated[MAX_MPUS];
    static const SensorDef*   _def[MAX_MPUS];   // pointer into SENSORS[]

    // Software calibration offsets applied in readSensor()
    static float _calAx[MAX_MPUS], _calAy[MAX_MPUS], _calAz[MAX_MPUS];
    static float _calGx[MAX_MPUS], _calGy[MAX_MPUS], _calGz[MAX_MPUS];

    static bool validId(int id)   { return id >= 0 && id < MAX_MPUS; }
    static bool validCode(int mc) { return mc >= 0 && mc < NUM_SENSORS; }

    // ---- I2C helpers ------------------------------------------------
    static void writeReg(uint8_t addr, uint8_t reg, uint8_t val) {
        Wire.beginTransmission(addr);
        Wire.write(reg);
        Wire.write(val);
        Wire.endTransmission();
    }

    static uint8_t readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t count) {
        Wire.beginTransmission(addr);
        Wire.write(reg);
        Wire.endTransmission(false);
        uint8_t n = (uint8_t)Wire.requestFrom((int)addr, (int)count);
        for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
        return n;
    }

    // Assemble two consecutive bytes into a signed int16.
    // littleEndian = false → buf[0] is high byte (MPU family)
    // littleEndian = true  → buf[0] is low  byte (LSM6 family)
    static inline int16_t get16(const uint8_t* buf, uint8_t off, bool le) {
        return le
            ? (int16_t)((uint16_t)buf[off + 1] << 8 | buf[off])
            : (int16_t)((uint16_t)buf[off]     << 8 | buf[off + 1]);
    }

    // ---- Sensor init ------------------------------------------------
    // Runs the pre-init write, checks WHO_AM_I, and applies initial ranges.
    static bool initDevice(int id) {
        const SensorDef* def  = _def[id];
        const uint8_t    addr = _addr[id];

        // Pre-init write (wake-up or global config enable)
        if (def->preReg != 0) {
            writeReg(addr, def->preReg, def->preVal);
            if (def->preDelayMs) delay(def->preDelayMs);
        }

        // Identity check
        uint8_t who = 0;
        readRegs(addr, def->whoReg, &who, 1);
        if (who != def->whoVal) {
            Serial.print(F("IMU WHO_AM_I=0x")); Serial.print(who, HEX);
            Serial.print(F(", expected 0x"));   Serial.println(def->whoVal, HEX);
            return false;
        }

        // Apply initial range configuration
        writeReg(addr, def->accelCfgReg, def->accelFs[_accelRange[id]]);
        writeReg(addr, def->gyroCfgReg,  def->gyroFs[_gyroRange[id]]);
        return true;
    }

    // ---- Data read --------------------------------------------------
    // Reads the 14-byte burst block and converts to physical units.
    // Byte offsets and endianness come from the sensor descriptor.
    static bool readSensor(int id,
                           float& ax, float& ay, float& az,
                           float& gx, float& gy, float& gz,
                           float& temp) {
        const SensorDef* def = _def[id];
        uint8_t buf[14];
        if (readRegs(_addr[id], def->dataStart, buf, 14) != 14) return false;

        const bool  le     = def->littleEndian;
        const float aScale = def->accelLsb[_accelRange[id]];
        const float gScale = def->gyroLsb[_gyroRange[id]];

        ax   = (float)get16(buf, def->axOff, le) / aScale - _calAx[id];
        ay   = (float)get16(buf, def->ayOff, le) / aScale - _calAy[id];
        az   = (float)get16(buf, def->azOff, le) / aScale - _calAz[id];
        gx   = (float)get16(buf, def->gxOff, le) / gScale - _calGx[id];
        gy   = (float)get16(buf, def->gyOff, le) / gScale - _calGy[id];
        gz   = (float)get16(buf, def->gzOff, le) / gScale - _calGz[id];
        temp = (float)get16(buf, def->txOff, le) / def->tempDiv + def->tempOff;
        return true;
    }

public:
    // -------------------------------------------------------------------
    // Main dispatch
    // -------------------------------------------------------------------
    static void handle(uint8_t clientNum,
                       uint8_t cmd, uint16_t typeMask,
                       uint8_t* params, uint8_t nparams,
                       uint8_t* payload, uint16_t payloadLen) {
        if (nparams < 1) return;
        int id = (int)paramInt(params, 0);
        if (!validId(id)) {
            Serial.print(F("IMU: invalid id ")); Serial.println(id);
            return;
        }

        switch (cmd) {

            // ── Attach ──────────────────────────────────────────────
            case CMD_MPU_ATTACH: {
                if (nparams < 3) return;
                uint8_t addr      = (uint8_t)paramInt(params, 1);
                int     modelCode = (int)paramInt(params, 2);

                if (!validCode(modelCode)) {
                    Serial.print(F("IMU: unknown modelCode ")); Serial.println(modelCode);
                    return;
                }

                // Initialise I2C. On ESP32, optional custom SDA/SCL via params[3,4].
#if defined(PLATFORM_ESP32)
                if (nparams >= 5 && !_wireInitialised) {
                    int sda = (int)paramInt(params, 3);
                    int scl = (int)paramInt(params, 4);
                    if (sda >= 0 && scl >= 0) { Wire.begin(sda, scl); _wireInitialised = true; }
                    else ensureWire();
                } else { ensureWire(); }
#else
                ensureWire();
#endif

                _addr[id]        = addr;
                _def[id]         = &SENSORS[modelCode];
                _accelRange[id]  = 0;
                _gyroRange[id]   = 0;
                _calibrated[id]  = false;
                _calAx[id] = _calAy[id] = _calAz[id] = 0.0f;
                _calGx[id] = _calGy[id] = _calGz[id] = 0.0f;

                if (!initDevice(id)) return;
                _attached[id] = true;

                Serial.print(F("IMU ")); Serial.print(id);
                Serial.print(F(" attached: ")); Serial.print(_def[id]->name);
                Serial.print(F(" at 0x")); Serial.println(addr, HEX);
                break;
            }

            // ── Detach ──────────────────────────────────────────────
            case CMD_MPU_DETACH:
                _attached[id]   = false;
                _calibrated[id] = false;
                _def[id]        = nullptr;
                Serial.print(F("IMU ")); Serial.print(id);
                Serial.println(F(" detached"));
                break;

            // ── Read ────────────────────────────────────────────────
            case CMD_MPU_READ: {
                if (!_attached[id]) return;
                float ax, ay, az, gx, gy, gz, temp;
                if (!readSensor(id, ax, ay, az, gx, gy, gz, temp)) return;

                FrameBuilder fb;
                fb.begin(CMD_MPU_READ, DEVICE_MPU);
                fb.addInt(id);
                fb.addFloat(ax); fb.addFloat(ay); fb.addFloat(az);
                fb.addFloat(gx); fb.addFloat(gy); fb.addFloat(gz);
                fb.addFloat(temp);
                broadcastFrame(fb);
                break;
            }

            // ── Accel range ─────────────────────────────────────────
            case CMD_MPU_SET_ACCEL_RANGE: {
                if (!_attached[id] || nparams < 2) return;
                uint8_t r = (uint8_t)constrain((int)paramInt(params, 1), 0, 3);
                _accelRange[id] = r;
                writeReg(_addr[id], _def[id]->accelCfgReg, _def[id]->accelFs[r]);
                const int gs[] = { 2, 4, 8, 16 };
                Serial.print(F("IMU ")); Serial.print(id);
                Serial.print(F(" accel ±")); Serial.print(gs[r]); Serial.println(F("g"));
                break;
            }

            // ── Gyro range ──────────────────────────────────────────
            case CMD_MPU_SET_GYRO_RANGE: {
                if (!_attached[id] || nparams < 2) return;
                uint8_t r = (uint8_t)constrain((int)paramInt(params, 1), 0, 3);
                _gyroRange[id] = r;
                writeReg(_addr[id], _def[id]->gyroCfgReg, _def[id]->gyroFs[r]);
                const int dps[] = { 250, 500, 1000, 2000 };
                Serial.print(F("IMU ")); Serial.print(id);
                Serial.print(F(" gyro ±")); Serial.print(dps[r]); Serial.println(F("°/s"));
                break;
            }

            // ── Calibrate ───────────────────────────────────────────
            // Place sensor flat, Z-axis pointing UP before calling.
            // After calibration: ax≈0g, ay≈0g, az≈+1g, gx≈gy≈gz≈0.
            // Blocks the loop for approx. samples × 2 ms.
            case CMD_MPU_CALIBRATE: {
                if (!_attached[id]) return;
                int samples = (nparams > 1)
                    ? constrain((int)paramInt(params, 1), 10, 1000)
                    : 200;

                Serial.print(F("IMU ")); Serial.print(id);
                Serial.print(F(": calibrating (")); Serial.print(samples);
                Serial.println(F(" samples — keep flat and still)"));

                _calAx[id] = _calAy[id] = _calAz[id] = 0.0f;
                _calGx[id] = _calGy[id] = _calGz[id] = 0.0f;

                double sAx=0, sAy=0, sAz=0, sGx=0, sGy=0, sGz=0;
                int good = 0;
                for (int i = 0; i < samples; i++) {
                    float ax, ay, az, gx, gy, gz, t;
                    if (readSensor(id, ax, ay, az, gx, gy, gz, t)) {
                        sAx+=ax; sAy+=ay; sAz+=az;
                        sGx+=gx; sGy+=gy; sGz+=gz;
                        good++;
                    }
                    delay(2);
                }
                if (good < 10) {
                    Serial.println(F("IMU: calibration failed — too few good reads"));
                    return;
                }

                _calAx[id] = (float)(sAx / good);
                _calAy[id] = (float)(sAy / good);
                _calAz[id] = (float)(sAz / good) - 1.0f;  // preserve +1g on Z
                _calGx[id] = (float)(sGx / good);
                _calGy[id] = (float)(sGy / good);
                _calGz[id] = (float)(sGz / good);
                _calibrated[id] = true;
                Serial.println(F("IMU: calibration complete"));

                FrameBuilder fb;
                fb.begin(CMD_MPU_CALIBRATE, DEVICE_MPU);
                fb.addInt(id);
                fb.addFloat(_calAx[id]); fb.addFloat(_calAy[id]); fb.addFloat(_calAz[id]);
                fb.addFloat(_calGx[id]); fb.addFloat(_calGy[id]); fb.addFloat(_calGz[id]);
                broadcastFrame(fb);
                break;
            }

            default:
                Serial.print(F("IMU: unknown cmd 0x")); Serial.println(cmd, HEX);
                break;
        }
    }

    // -------------------------------------------------------------------
    // Called on each new client connection
    // -------------------------------------------------------------------
    static void announce(uint8_t clientNum) {
        FrameBuilder fb;
        fb.begin(CMD_ANNOUNCE, DEVICE_MPU);
        fb.addInt(PROTOCOL_VERSION_MAJOR);
        fb.addInt(MAX_MPUS);
        sendFrame(clientNum, fb);

        for (int i = 0; i < MAX_MPUS; i++) {
            if (!_attached[i] || !_def[i]) continue;

            // Re-send attach state (includes modelCode so JS can restore _def)
            FrameBuilder fa;
            fa.begin(CMD_MPU_ATTACH, DEVICE_MPU);
            fa.addInt(i);
            fa.addInt(_addr[i]);
            fa.addInt((int32_t)(_def[i] - SENSORS));  // modelCode = index in table
            sendFrame(clientNum, fa);

            FrameBuilder fr;
            fr.begin(CMD_MPU_SET_ACCEL_RANGE, DEVICE_MPU);
            fr.addInt(i); fr.addInt(_accelRange[i]);
            sendFrame(clientNum, fr);

            FrameBuilder fg;
            fg.begin(CMD_MPU_SET_GYRO_RANGE, DEVICE_MPU);
            fg.addInt(i); fg.addInt(_gyroRange[i]);
            sendFrame(clientNum, fg);

            if (_calibrated[i]) {
                FrameBuilder fc;
                fc.begin(CMD_MPU_CALIBRATE, DEVICE_MPU);
                fc.addInt(i);
                fc.addFloat(_calAx[i]); fc.addFloat(_calAy[i]); fc.addFloat(_calAz[i]);
                fc.addFloat(_calGx[i]); fc.addFloat(_calGy[i]); fc.addFloat(_calGz[i]);
                sendFrame(clientNum, fc);
            }
        }
    }
};

// Static member definitions
uint8_t           MpuExt::_addr[MAX_MPUS]       = {};
uint8_t           MpuExt::_accelRange[MAX_MPUS] = {};
uint8_t           MpuExt::_gyroRange[MAX_MPUS]  = {};
bool              MpuExt::_attached[MAX_MPUS]    = {};
bool              MpuExt::_calibrated[MAX_MPUS]  = {};
const SensorDef*  MpuExt::_def[MAX_MPUS]         = {};
float             MpuExt::_calAx[MAX_MPUS]       = {};
float             MpuExt::_calAy[MAX_MPUS]       = {};
float             MpuExt::_calAz[MAX_MPUS]       = {};
float             MpuExt::_calGx[MAX_MPUS]       = {};
float             MpuExt::_calGy[MAX_MPUS]       = {};
float             MpuExt::_calGz[MAX_MPUS]       = {};

INSTALL_EXTENSION(DEVICE_MPU, MpuExt::handle, MpuExt::announce)

#endif
