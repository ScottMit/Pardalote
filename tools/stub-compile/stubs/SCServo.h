// Stub <SCServo.h> — host -fsyntax-only. Feetech/Waveshare SMS_STS + SCSCL.
#pragma once
#include <Arduino.h>

// EEPROM/RAM register addresses used by Pardalote (real values from SCServo.h).
#define SMS_STS_ID                   5
#define SMS_STS_MIN_ANGLE_LIMIT_L    9
#define SMS_STS_MAX_ANGLE_LIMIT_L    11
#define SCSCL_ID                     5
#define SCSCL_MIN_ANGLE_LIMIT_L      6
#define SCSCL_MAX_ANGLE_LIMIT_L      8

// Shared serial/protocol base (writeByte/readWord/pSerial/IOTimeOut + the
// common commands both series implement).
class SCSerial {
public:
    Stream* pSerial = nullptr;
    unsigned long IOTimeOut = 100;
    uint8_t End = 0;
    uint8_t Err = 0;
    int  writeByte(uint8_t, uint8_t, uint8_t) { return 0; }
    int  readByte(uint8_t, uint8_t) { return 0; }
    int  readWord(uint8_t, uint8_t) { return 0; }
    int  Ping(uint8_t) { return -1; }
    int  EnableTorque(uint8_t, uint8_t) { return 0; }
    int  unLockEprom(uint8_t) { return 0; }
    int  LockEprom(uint8_t) { return 0; }
    int  CalibrationOfs(uint8_t) { return 0; }
    int  FeedBack(int) { return 0; }
    int  ReadPos(int) { return 0; }
    int  ReadSpeed(int) { return 0; }
    int  ReadLoad(int) { return 0; }
    int  ReadVoltage(int) { return 0; }
    int  ReadTemper(int) { return 0; }
    int  ReadMove(int) { return 0; }
    int  WritePos(uint8_t, int16_t, uint16_t, uint8_t = 0) { return 0; }
    int  WritePosEx(uint8_t, int16_t, uint16_t, uint8_t = 0) { return 0; }
    int  WriteSpe(uint8_t, int16_t, uint8_t = 0) { return 0; }
};

// ST/SMS series (0–4095). Adds wheel mode, sync write, current read.
class SMS_STS : public SCSerial {
public:
    int  WheelMode(uint8_t) { return 0; }
    int  ReadCurrent(int) { return 0; }
    int  SyncWritePosEx(uint8_t*, uint8_t, int16_t*, uint16_t*, uint8_t*) { return 0; }
};

// SC/SCS series (0–1023).
class SCSCL : public SCSerial {
};
