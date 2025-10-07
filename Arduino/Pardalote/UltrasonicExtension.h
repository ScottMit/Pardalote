#ifndef ULTRASONIC_EXTENSION_H
#define ULTRASONIC_EXTENSION_H

// -------------------------------------------------------------------
// Ultrasonic Extension Actions (match defs.h)
// -------------------------------------------------------------------
#define ULTRASONIC_ATTACH 30       // Attach sensor: params = [sensorId, trigPin, echoPin] (echoPin = -1 for 3-wire)
#define ULTRASONIC_DETACH 31       // Detach sensor: params = [sensorId]
#define ULTRASONIC_READ 32         // Read distance: params = [sensorId, unit] (0=CM, 1=INCH)
#define ULTRASONIC_SET_TIMEOUT 33  // Set timeout: params = [sensorId, timeoutMs]

#define MAX_ULTRASONIC 8  // Maximum number of ultrasonic sensors supported

// Unit constants
#define UNIT_CM 0
#define UNIT_INCH 1

class UltrasonicExt {
private:
  static int trigPins[MAX_ULTRASONIC];
  static int echoPins[MAX_ULTRASONIC];
  static unsigned long timeoutMs[MAX_ULTRASONIC];
  static bool sensorAttached[MAX_ULTRASONIC];

  static bool isValidSensorId(int sensorId) {
    return sensorId >= 0 && sensorId < MAX_ULTRASONIC;
  }

  static float measureDistance(int sensorId, int unit) {
    if (!sensorAttached[sensorId]) return -1;

    int trigPin = trigPins[sensorId];
    int echoPin = echoPins[sensorId];

    // For 3-wire sensors, we need to switch pin modes
    if (echoPin == -1) {
      echoPin = trigPin;

      // Set pin as output for trigger
      pinMode(trigPin, OUTPUT);
      digitalWrite(trigPin, LOW);
      delayMicroseconds(2);
      digitalWrite(trigPin, HIGH);
      delayMicroseconds(10);
      digitalWrite(trigPin, LOW);

      // Switch to input for echo
      pinMode(trigPin, INPUT);

      // Read echo pulse duration
      unsigned long duration = pulseIn(trigPin, HIGH, timeoutMs[sensorId] * 1000UL);

      if (duration == 0) {
        return -1;
      }

      // Calculate distance
      float distance;
      if (unit == UNIT_INCH) {
        distance = duration * 0.0135 / 2.0;
      } else {
        distance = duration * 0.0343 / 2.0;
      }

      return distance;
    } else {
      // 4-wire sensor - standard operation

      pinMode(trigPin, OUTPUT);  // Sets the trigPin as an Output
      digitalWrite(trigPin, LOW);
      delayMicroseconds(2);
      digitalWrite(trigPin, HIGH);
      delayMicroseconds(10);
      digitalWrite(trigPin, LOW);

      pinMode(echoPin, INPUT);  // Sets the trigPin as an Output
      // Read echo pulse duration
      unsigned long duration = pulseIn(echoPin, HIGH, timeoutMs[sensorId] * 1000UL);

      if (duration == 0) {
        return -1;
      }

      // Calculate distance
      float distance;
      if (unit == UNIT_INCH) {
        distance = duration * 0.0135 / 2.0;
      } else {
        distance = duration * 0.0343 / 2.0;
      }

      return distance;
    }
  }

public:
  static void handle(int action, JsonArray& params) {
    // All actions require sensorId as first parameter
    if (params.size() == 0) return;

    int sensorId = (int)params[0];
    if (!isValidSensorId(sensorId)) {
      Serial.print("Invalid ultrasonic sensor ID: ");
      Serial.println(sensorId);
      return;
    }

    switch (action) {
      case ULTRASONIC_ATTACH:
        {
          if (params.size() < 2) {
            Serial.println("ULTRASONIC_ATTACH: Insufficient parameters");
            return;
          }

          int trigPin = (int)params[1];
          int echoPin = (params.size() > 2) ? (int)params[2] : -1;  // -1 for 3-wire sensors

          Serial.print("ULTRASONIC_ATTACH received: sensorId=");
          Serial.print(sensorId);
          Serial.print(", trigPin=");
          Serial.print(trigPin);
          Serial.print(", echoPin=");
          Serial.println(echoPin == -1 ? "same as trig (3-wire)" : String(echoPin));

          // Store configuration
          trigPins[sensorId] = trigPin;
          echoPins[sensorId] = echoPin;
          timeoutMs[sensorId] = 30;  // Increased default timeout
          sensorAttached[sensorId] = true;

          Serial.print("Ultrasonic sensor ");
          Serial.print(sensorId);
          Serial.print(" attached to trig pin ");
          Serial.print(trigPin);
          if (echoPin != -1) {
            Serial.print(" and echo pin ");
            Serial.println(echoPin);
          } else {
            Serial.println(" (3-wire mode)");
          }
          break;
        }

      case ULTRASONIC_DETACH:
        {
          if (sensorAttached[sensorId]) {
            sensorAttached[sensorId] = false;
            trigPins[sensorId] = -1;
            echoPins[sensorId] = -1;
            timeoutMs[sensorId] = 20;

            Serial.print("Ultrasonic sensor ");
            Serial.print(sensorId);
            Serial.println(" detached");
          }
          break;
        }

      case ULTRASONIC_READ:
        {
          if (!sensorAttached[sensorId]) {
            sendUltrasonicReturnMessage(sensorId, ULTRASONIC_READ, -1);
            return;
          }

          // Defaults
          int unit = UNIT_CM;
          int interval = 0;

          // Parse params
          if (params.size() > 1) {
            unit = (int)params[1];
          }
          if (params.size() > 2) {
            interval = (int)params[2];
          }

          if (interval > 0) {
            // Register this sensor for periodic reads
            registerAction(sensorId + 2000, ULTRASONIC_READ, interval, unit);

            Serial.print("Ultrasonic sensor ");
            Serial.print(sensorId);
            Serial.print(" registered for periodic reads every ");
            Serial.print(interval);
            Serial.print("ms (unit=");
            Serial.print(unit == UNIT_INCH ? "INCH" : "CM");
            Serial.println(")");
          } else {
            // One-shot read
            float distance = measureDistance(sensorId, unit);
            sendUltrasonicReturnMessage(sensorId, ULTRASONIC_READ, distance);

            Serial.print("Ultrasonic one-shot read (sensor ");
            Serial.print(sensorId);
            Serial.print("): ");
            if (distance >= 0) {
              Serial.print(distance);
              Serial.println(unit == UNIT_INCH ? " inches" : " cm");
            } else {
              Serial.println("TIMEOUT/ERROR");
            }
          }
          break;
        }

      case ULTRASONIC_SET_TIMEOUT:
        {
          if (!sensorAttached[sensorId]) return;
          if (params.size() < 2) return;

          unsigned long timeout = (unsigned long)params[1];
          timeout = max(1UL, min(timeout, 1000UL));  // Limit timeout between 1ms and 1000ms

          timeoutMs[sensorId] = timeout;

          Serial.print("Ultrasonic sensor ");
          Serial.print(sensorId);
          Serial.print(" timeout set to ");
          Serial.print(timeout);
          Serial.println(" ms");
          break;
        }

      case END:
        {
          // Stop periodic reads for this ultrasonic sensor
          unregisterAction(sensorId + 2000);
          Serial.print("Ultrasonic sensor ");
          Serial.print(sensorId);
          Serial.println(" stopped periodic reads");
          break;
        }

      default:
        Serial.print("Unknown ultrasonic action: ");
        Serial.println(action);
        break;
    }
  }

  static void performPeriodicRead(int sensorId) {
    if (!sensorAttached[sensorId]) return;

    float distance = measureDistance(sensorId, UNIT_CM);  // Default to CM for periodic reads
    sendUltrasonicReturnMessage(sensorId, ULTRASONIC_READ, distance);
  }

  // Utility method to get sensor info (for debugging)
  static void printSensorInfo() {
    Serial.println("=== Ultrasonic Sensor Status ===");
    for (int i = 0; i < MAX_ULTRASONIC; i++) {
      if (sensorAttached[i]) {
        Serial.print("Sensor ");
        Serial.print(i);
        Serial.print(": Trig pin ");
        Serial.print(trigPins[i]);
        if (echoPins[i] != -1) {
          Serial.print(", Echo pin ");
          Serial.print(echoPins[i]);
        } else {
          Serial.print(" (3-wire mode)");
        }
        Serial.print(", Timeout ");
        Serial.print(timeoutMs[i]);
        Serial.println(" ms");
      }
    }
    Serial.println("===============================");
  }

  // Cleanup method (call in setup if needed)
  static void cleanup() {
    for (int i = 0; i < MAX_ULTRASONIC; i++) {
      if (sensorAttached[i]) {
        sensorAttached[i] = false;
        trigPins[i] = -1;
        echoPins[i] = -1;
        timeoutMs[i] = 20;
      }
    }
  }

private:
  // Forward declaration - this function should be available in main sketch
  static void sendUltrasonicReturnMessage(int sensorId, int type, float value) {
    // Use the existing sendReturnMessage function from main sketch
    // with ultrasonic-specific ID offset to distinguish from pins
    sendReturnMessage(sensorId + 2000, type, value);
  }
};

// Static member definitions
int UltrasonicExt::trigPins[MAX_ULTRASONIC] = { -1 };
int UltrasonicExt::echoPins[MAX_ULTRASONIC] = { -1 };
unsigned long UltrasonicExt::timeoutMs[MAX_ULTRASONIC] = { 20 };
bool UltrasonicExt::sensorAttached[MAX_ULTRASONIC] = { false };

#endif