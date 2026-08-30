// Stub <Arduino.h> for HOST -fsyntax-only structural compiles. NOT a runtime
// core — just enough declarations for the Pardalote headers to parse. See
// tools/stub-compile/README.md.
#pragma once

// Real std headers FIRST, before the min/max macros below, so defining those
// as macros can't clobber <algorithm>/<vector> internals (the classic Arduino
// footgun the bench notes call out). The stubs here never include the STL.
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <cmath>
#include <cstddef>

typedef uint8_t  byte;
typedef bool     boolean;
typedef unsigned int word;

#define HIGH 1
#define LOW  0
#define INPUT           0x0
#define OUTPUT          0x1
#define INPUT_PULLUP    0x2
#define INPUT_PULLDOWN  0x3
#define LED_BUILTIN     13
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define PI 3.1415926535897932384626433832795

#define PROGMEM
#define PGM_P const char*
#define pgm_read_byte(a)  (*(const uint8_t*)(a))
#define pgm_read_word(a)  (*(const uint16_t*)(a))
#define F(str) (str)
#define PSTR(str) (str)

// Arduino provides these as function-like macros (constrain MUST be a macro —
// bench note). Defined after the std includes above.
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define abs(x) ((x)>0?(x):-(x))
#define constrain(x,lo,hi) ((x)<(lo)?(lo):((x)>(hi)?(hi):(x)))
#define radians(deg) ((deg)*DEG_TO_RAD)
#define sq(x) ((x)*(x))
#define lowByte(w)  ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bitRead(v,b)   (((v) >> (b)) & 0x01)
#define bitSet(v,b)    ((v) |= (1UL << (b)))
#define bitClear(v,b)  ((v) &= ~(1UL << (b)))
#define bit(b) (1UL << (b))

#define CHANGE 1
#define FALLING 2
#define RISING 3
#define digitalPinToInterrupt(p) (p)

typedef unsigned char uint8_t_dummy_;

// Pin / timing / misc core functions (declarations only — never linked).
void  pinMode(uint8_t, uint8_t);
void  digitalWrite(uint8_t, uint8_t);
int   digitalRead(uint8_t);
int   analogRead(uint8_t);
void  analogWrite(uint8_t, int);
void  analogReadResolution(int);
void  analogWriteResolution(int);
unsigned long millis(void);
unsigned long micros(void);
void  delay(unsigned long);
void  delayMicroseconds(unsigned int);
long  map(long, long, long, long, long);
long  random(long);
long  random(long, long);
void  randomSeed(unsigned long);
void  attachInterrupt(uint8_t, void (*)(void), int);
void  detachInterrupt(uint8_t);
void  yield(void);

// --- Print / Stream / HardwareSerial ---------------------------------------
class __FlashStringHelper;

class Print {
public:
    size_t print(const char*)       { return 0; }
    size_t print(char)              { return 0; }
    size_t print(int, int = DEC)    { return 0; }
    size_t print(unsigned int, int = DEC) { return 0; }
    size_t print(long, int = DEC)   { return 0; }
    size_t print(unsigned long, int = DEC) { return 0; }
    size_t print(double, int = 2)   { return 0; }
    size_t println(const char*)     { return 0; }
    size_t println(char)            { return 0; }
    size_t println(int, int = DEC)  { return 0; }
    size_t println(unsigned int, int = DEC) { return 0; }
    size_t println(long, int = DEC) { return 0; }
    size_t println(unsigned long, int = DEC) { return 0; }
    size_t println(double, int = 2) { return 0; }
    size_t println(void)            { return 0; }
    size_t write(uint8_t)           { return 0; }
    size_t write(const uint8_t*, size_t) { return 0; }
    size_t write(const char*)       { return 0; }
};

class Stream : public Print {
public:
    int  available()      { return 0; }
    int  read()           { return -1; }
    int  peek()           { return -1; }
    void flush()          {}
};

#define SERIAL_8N1 0x06

class HardwareSerial : public Stream {
public:
    void begin(unsigned long)                 {}
    void begin(unsigned long, int)            {}
    void begin(unsigned long, int, int, int)  {}   // ESP32 Serial.begin(baud,cfg,rx,tx)
    void end() {}
    operator bool() const { return true; }
    int  availableForWrite() { return 64; }
    size_t write(const uint8_t*, size_t) { return 0; }
    size_t write(uint8_t) { return 0; }
    using Print::write;
    int  IOTimeOut = 0;
};
extern HardwareSerial Serial;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;

// --- String (minimal) ------------------------------------------------------
class String {
public:
    String() {}
    String(const char*) {}
    String(int, int = DEC) {}
    const char* c_str() const { return ""; }
    unsigned length() const { return 0; }
    char operator[](int) const { return 0; }
    String operator+(const String&) const { return String(); }
    bool operator==(const char*) const { return false; }
};
