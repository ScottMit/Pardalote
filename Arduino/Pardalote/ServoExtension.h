#ifndef SERVO_EXTENSION_H
#define SERVO_EXTENSION_H

#if defined(ESP32)
  #include <ESP32Servo.h>
#else
  #include <Servo.h>
#endif

// -------------------------------------------------------------------
// Servo Extension Actions (match defs.h)
// -------------------------------------------------------------------
#define SERVO_ATTACH      20     // Attach servo: params = [servoId, pin]
#define SERVO_DETACH      21     // Detach servo: params = [servoId]
#define SERVO_WRITE       22     // Write angle: params = [servoId, angle]
#define SERVO_WRITE_MICROSECONDS 23 // Write microseconds: params = [servoId, microseconds]
#define SERVO_READ        24     // Read current angle: params = [servoId]
#define SERVO_ATTACHED    25     // Check if attached: params = [servoId]

#define MAX_SERVOS 12  // Maximum number of servos supported

class ServoExt {
private:
  static Servo servos[MAX_SERVOS];
  static int servoPins[MAX_SERVOS];
  static int lastAngles[MAX_SERVOS];
  static bool servoAttached[MAX_SERVOS];

  static bool isValidServoId(int servoId) {
    return servoId >= 0 && servoId < MAX_SERVOS;
  }

public:
  static void handle(int action, JsonArray& params) {
    // All actions require servoId as first parameter
    if (params.size() == 0) return;

    int servoId = (int)params[0];
    if (!isValidServoId(servoId)) {
      Serial.print("Invalid servo ID: ");
      Serial.println(servoId);
      return;
    }

    switch (action) {
      case SERVO_ATTACH:
        {
          if (params.size() < 2) {
            Serial.println("SERVO_ATTACH: Insufficient parameters");
            return;
          }

          int pin = (int)params[1];
          int minPulse = (params.size() > 2) ? (int)params[2] : 544;   // Default min
          int maxPulse = (params.size() > 3) ? (int)params[3] : 2400;  // Default max

          Serial.print("SERVO_ATTACH received: servoId=");
          Serial.print(servoId);
          Serial.print(", pin=");
          Serial.print(pin);
          Serial.print(", minPulse=");
          Serial.print(minPulse);
          Serial.print(", maxPulse=");
          Serial.println(maxPulse);

          // Detach if already attached
          if (servoAttached[servoId]) {
            servos[servoId].detach();
          }

          // Attach servo
          if (params.size() > 3) {
            servos[servoId].attach(pin, minPulse, maxPulse);
          } else {
            servos[servoId].attach(pin);
          }

          servoPins[servoId] = pin;
          servoAttached[servoId] = true;
          lastAngles[servoId] = 90; // Default middle position

          Serial.print("Servo ");
          Serial.print(servoId);
          Serial.print(" attached to pin ");
          Serial.println(pin);
          break;
        }

      case SERVO_DETACH:
        {
          if (servoAttached[servoId]) {
            servos[servoId].detach();
            servoAttached[servoId] = false;
            servoPins[servoId] = -1;
            
            Serial.print("Servo ");
            Serial.print(servoId);
            Serial.println(" detached");
          }
          break;
        }

      case SERVO_WRITE:
        {
          if (!servoAttached[servoId]) {
            Serial.print("Servo ");
            Serial.print(servoId);
            Serial.println(" not attached");
            return;
          }
          
          if (params.size() < 2) return;

          int angle = (int)params[1];
          angle = constrain(angle, 0, 180); // Ensure valid range
          
          servos[servoId].write(angle);
          lastAngles[servoId] = angle;

          Serial.print("Servo ");
          Serial.print(servoId);
          Serial.print(" angle set to ");
          Serial.println(angle);
          break;
        }

      case SERVO_WRITE_MICROSECONDS:
        {
          if (!servoAttached[servoId]) return;
          if (params.size() < 2) return;

          int microseconds = (int)params[1];
          microseconds = constrain(microseconds, 544, 2400); // Typical servo range
          
          servos[servoId].writeMicroseconds(microseconds);

          Serial.print("Servo ");
          Serial.print(servoId);
          Serial.print(" microseconds set to ");
          Serial.println(microseconds);
          break;
        }

      case SERVO_READ:
        {
          if (!servoAttached[servoId]) {
            sendServoReturnMessage(servoId, SERVO_READ, -1);
            return;
          }

          int currentAngle = servos[servoId].read();
          lastAngles[servoId] = currentAngle;
          sendServoReturnMessage(servoId, SERVO_READ, currentAngle);

          Serial.print("Servo ");
          Serial.print(servoId);
          Serial.print(" current angle: ");
          Serial.println(currentAngle);
          break;
        }

      case SERVO_ATTACHED:
        {
          bool attached = servoAttached[servoId] && servos[servoId].attached();
          sendServoReturnMessage(servoId, SERVO_ATTACHED, attached ? 1 : 0);

          Serial.print("Servo ");
          Serial.print(servoId);
          Serial.print(" attached status: ");
          Serial.println(attached ? "true" : "false");
          break;
        }

      default:
        Serial.print("Unknown servo action: ");
        Serial.println(action);
        break;
    }
  }

  // Utility method to get servo info (for debugging)
  static void printServoInfo() {
    Serial.println("=== Servo Status ===");
    for (int i = 0; i < MAX_SERVOS; i++) {
      if (servoAttached[i]) {
        Serial.print("Servo ");
        Serial.print(i);
        Serial.print(": Pin ");
        Serial.print(servoPins[i]);
        Serial.print(", Last angle ");
        Serial.println(lastAngles[i]);
      }
    }
    Serial.println("===================");
  }

  // Cleanup method (call in setup if needed)
  static void cleanup() {
    for (int i = 0; i < MAX_SERVOS; i++) {
      if (servoAttached[i]) {
        servos[i].detach();
        servoAttached[i] = false;
        servoPins[i] = -1;
        lastAngles[i] = 90;
      }
    }
  }

private:
  // Forward declaration - this function should be available in main sketch
  static void sendServoReturnMessage(int servoId, int type, float value) {
    // Use the existing sendReturnMessage function from main sketch
    // with servo-specific ID offset to distinguish from pins
    sendReturnMessage(servoId + 1000, type, value);
  }
};

// Static member definitions
Servo ServoExt::servos[MAX_SERVOS];
int ServoExt::servoPins[MAX_SERVOS] = { -1 };
int ServoExt::lastAngles[MAX_SERVOS] = { 90 };
bool ServoExt::servoAttached[MAX_SERVOS] = { false };

#endif