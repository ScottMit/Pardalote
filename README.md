# Pardalote

Connect your Arduino to web interfaces and create interactive projects that bridge the digital and physical worlds. Perfect for design students, makers, and anyone wanting to prototype connected devices and interfaces.

## What is this?

The Pardalote project lets you control Arduino hardware (like LEDs, sensors, servo motors, ultrasonic sensors, and NeoPixel strips) directly from a web page in real-time. No complex networking code needed - just connect your Arduino to your WiFi network and start building interactive experiences.

**Perfect for:**
- Interactive art installations
- IoT prototypes
- Smart home experiments  
- Data visualization with physical feedback
- Learning how web interfaces connect to hardware
- Design course projects

## What You Can Build

- **Web dashboards** that display real sensor data
- **Interactive installations** controlled by web interfaces
- **Smart lighting** systems with web-based controls
- **Data visualizations** from live sensor streams
- **IoT prototypes** that respond to web inputs
- **Servo-controlled mechanisms** with web interfaces
- **Multi-strip LED displays** with independent control
- **Distance sensing systems** for proximity detection and measurement

## What You Need

### Hardware
- **Arduino UNO R4 WiFi** OR **ESP32 development board**
- **WiFi network** (your home/school network - Arduino and web browser must be on the same network)
- **Optional components:**
  - NeoPixel LED strips (WS2812B/SK6812)
  - Servo motors (standard 180° servos)
  - Ultrasonic sensors (HC-SR04, 3-wire or 4-wire)
  - Sensors (temperature, light, motion)
  - Regular LEDs and resistors
  - Potentiometers/knobs

### Software (all free)
- **Arduino IDE** - for programming your Arduino
- **Web browser** - Chrome, Firefox, Safari, etc.
- **Text editor** - VS Code, Atom, or even Notepad

## Quick Start (15 minutes)

### Step 1: Set Up Your Arduino

1. **Download this project** and unzip it
2. **Install Arduino IDE** from arduino.cc
3. **Install these libraries** in Arduino IDE (Tools → Manage Libraries):
   - WebSocketsServer
   - ArduinoJson
   - Adafruit_NeoPixel (if using LED strips)
   - Servo library (built-in, or ESP32Servo for ESP32)

4. **Open the Arduino sketch:**
   - Open `Pardalote.ino` in Arduino IDE

5. **Add your WiFi details:**
   - Edit the `secrets.h` file:
   ```cpp
   #define SECRET_SSID "YourWiFiName"
   #define SECRET_PASS "YourWiFiPassword"
   ```

6. **Upload to your Arduino:**
   - Connect Arduino via USB
   - Select your board type (UNO R4 WiFi or ESP32)
   - Click Upload

7. **Find your Arduino's IP address:**
   - **UNO R4:** Look at the LED matrix display (scrolls automatically)
   - **ESP32:** Open Serial Monitor (Tools → Serial Monitor)

### Step 2: Set Up Your Web Interface

1. **Choose an example:**
   - Navigate to the examples folder and choose from one of the included examples

2. **Edit the connection:**
   - Open `sketch.js` in a text editor (in the examples folder)
   - Change this line to match your Arduino's IP:
   ```javascript
   let ArduinoIP = '192.168.1.134';
   ```

3. **Test it:**
   - Open `index.html` in your web browser
   - You should see connection status in the browser console

## Build Your Own Project: LED Control

Let's make a web page that turns an LED on and off:

### Arduino Side (Hardware):
- Connect an LED to pin 13 (built-in LED works too)

### Web Side (JavaScript):
```javascript
// Connect to Arduino
arduino = new Arduino();
arduino.connect('YOUR_ARDUINO_IP');

// Set up the LED pin
arduino.pinMode(13, OUTPUT);

// Turn LED on
arduino.digitalWrite(13, HIGH);

// Turn LED off  
arduino.digitalWrite(13, LOW);
```

### Complete Web Example:
```html
<button onclick="arduino.digitalWrite(13, HIGH)">LED On</button>
<button onclick="arduino.digitalWrite(13, LOW)">LED Off</button>
```

That's it! Click the buttons to control your LED.

## Common Examples

### Reading a Sensor
```javascript
// Read a light sensor on pin A0
let lightLevel = arduino.analogRead(A0);

// Analog value range 0-1023 on UNO R4, 0-4095 on ESP32
console.log("Light level:", lightLevel);
```

### Controlling Brightness
```javascript
// Control LED brightness with PWM
arduino.pinMode(9, OUTPUT);
arduino.analogWrite(9, sliderValue); // 0-255
```

### NeoPixel LED Strips

#### Single Strip
```javascript
// Set up a strip of 8 LEDs on pin 6
arduino.add('strip', new NeoPixel(arduino));
arduino.strip.init(6, 8);

// Make first LED red
arduino.strip.setPixelColor(0, 255, 0, 0);
arduino.strip.show(); // Always call show() to update LEDs

// Fill all LEDs blue
let blue = arduino.strip.Color(0, 0, 255);
arduino.strip.fill(blue);
arduino.strip.show();
```

#### Multiple Strips
```javascript
// Add multiple NeoPixel strips
arduino.add('mainLights', new NeoPixel(arduino));
arduino.add('accentLights', new NeoPixel(arduino));
arduino.add('backgroundLights', new NeoPixel(arduino));

// Initialize each strip independently
arduino.mainLights.init(6, 16);        // pin 6, 16 pixels
arduino.accentLights.init(7, 8);       // pin 7, 8 pixels  
arduino.backgroundLights.init(8, 32);  // pin 8, 32 pixels

// Set different brightness for each strip
arduino.mainLights.setBrightness(200);
arduino.accentLights.setBrightness(100);
arduino.backgroundLights.setBrightness(50);

// Control each strip independently
arduino.mainLights.fill(arduino.mainLights.Color(255, 0, 0));     // Red
arduino.accentLights.fill(arduino.accentLights.Color(0, 255, 0)); // Green
arduino.backgroundLights.fill(arduino.backgroundLights.Color(0, 0, 255)); // Blue

// Show all changes
arduino.mainLights.show();
arduino.accentLights.show();
arduino.backgroundLights.show();
```

### Servo Motors

#### Single Servo
```javascript
// Add a servo motor extension
arduino.add('myServo', new Servo(arduino));

// Attach servo to pin 9
arduino.myServo.attach(9);

// Move to specific angles
arduino.myServo.write(90);  // Center position
arduino.myServo.write(0);   // Min position
arduino.myServo.write(180); // Max position

// Convenience methods
arduino.myServo.center(); // Go to 90°
arduino.myServo.min();    // Go to 0°
arduino.myServo.max();    // Go to 180°
```

#### Multiple Servos
```javascript
// Control multiple servos independently
arduino.add('pan', new Servo(arduino));
arduino.add('tilt', new Servo(arduino));

arduino.pan.attach(9);
arduino.tilt.attach(10);

// Move both servos
arduino.pan.write(45);
arduino.tilt.write(135);
```

#### Servo Sweeps
```javascript
// Smooth servo sweep from 0° to 180° over 2 seconds
await arduino.myServo.sweep(0, 180, 2000);

// Custom sweep with more steps for smoother motion
await arduino.myServo.sweep(0, 180, 3000, 100);
```

### Ultrasonic Distance Sensors

#### Single Sensor
```javascript
// Add an ultrasonic sensor
arduino.add('mySensor', new Ultrasonic(arduino));

// Attach sensor (4-wire mode: separate trigger and echo pins)
arduino.mySensor.attach(6, 7); // Trig pin 6, Echo pin 7

// For 3-wire sensors (single pin for trigger/echo):
arduino.mySensor.attach(6); // Single pin mode

// Read distance
let distance = arduino.mySensor.read(); // Returns distance in cm
let distanceInches = arduino.mySensor.read(INCH); // Returns distance in inches

// Convenience methods
let distanceCM = arduino.mySensor.readCM();
let distanceInches = arduino.mySensor.readInches();

// Set timeout for longer range detection
arduino.mySensor.setTimeout(40); // 40ms timeout (default: 20ms)

// Check if object is within range
if (arduino.mySensor.isInRange(50)) { // Within 50cm
    console.log("Object detected nearby");
}
```

#### Multiple Sensors
```javascript
// Control multiple ultrasonic sensors independently
arduino.add('frontSensor', new Ultrasonic(arduino));
arduino.add('backSensor', new Ultrasonic(arduino));
arduino.add('sideSensor', new Ultrasonic(arduino));

arduino.frontSensor.attach(6, 7);  // Trig pin 6, Echo pin 7
arduino.backSensor.attach(8, 9);   // Trig pin 8, Echo pin 9
arduino.sideSensor.attach(10);     // 3-wire sensor on pin 10

// Read from each sensor
let frontDistance = arduino.frontSensor.readCM();
let backDistance = arduino.backSensor.readCM(); 
let sideDistance = arduino.sideSensor.readCM();
```

### Multiple Device Support

You can control multiple instances of the same device type. Each extension automatically gets a unique logical ID:

```javascript
// Multiple NeoPixel strips with custom names
arduino.add('ceiling', new NeoPixel(arduino));     // Gets logical ID 0
arduino.add('floor', new NeoPixel(arduino));       // Gets logical ID 1
arduino.add('wall', new NeoPixel(arduino));        // Gets logical ID 2

// Multiple servos
arduino.add('servo1', new Servo(arduino));         // Gets logical ID 0
arduino.add('servo2', new Servo(arduino));         // Gets logical ID 1

// Multiple ultrasonic sensors
arduino.add('frontSensor', new Ultrasonic(arduino)); // Gets logical ID 0
arduino.add('backSensor', new Ultrasonic(arduino));  // Gets logical ID 1

// Each device can have different configurations
arduino.ceiling.init(6, 20);    // 20 LEDs on pin 6
arduino.floor.init(7, 50);      // 50 LEDs on pin 7
arduino.wall.init(8, 10);       // 10 LEDs on pin 8

arduino.servo1.attach(9);       // Servo on pin 9
arduino.servo2.attach(10);      // Servo on pin 10

arduino.frontSensor.attach(6, 7); // Ultrasonic trig pin 6, echo pin 7
arduino.backSensor.attach(8, 9);  // Ultrasonic trig pin 8, echo pin 9

// Debug: see what's added
console.log(arduino.listExtensions());
// Output: [
//   { id: 'ceiling', logicalId: 0, deviceId: 200, type: 'NeoPixel' },
//   { id: 'floor', logicalId: 1, deviceId: 200, type: 'NeoPixel' },
//   { id: 'wall', logicalId: 2, deviceId: 200, type: 'NeoPixel' },
//   { id: 'servo1', logicalId: 0, deviceId: 201, type: 'Servo' },
//   { id: 'servo2', logicalId: 1, deviceId: 201, type: 'Servo' },
//   { id: 'frontSensor', logicalId: 0, deviceId: 202, type: 'Ultrasonic' },
//   { id: 'backSensor', logicalId: 1, deviceId: 202, type: 'Ultrasonic' }
// ]
```

## Advanced Features

### Connection Management
The system includes automatic reconnection with exponential backoff:

```javascript
// Check connection status
let status = arduino.getStatus();
console.log(status.connected); // true/false
console.log(status.isReconnecting); // true/false

// Manual reconnection
arduino.reconnect();

// Disconnect (disables auto-reconnection)
arduino.disconnect();
```

### Message Batching and Throttling
Commands are automatically batched and throttled to prevent overwhelming the Arduino:

```javascript
// These will be batched together automatically
arduino.strip.setPixelColor(0, 255, 0, 0);
arduino.strip.setPixelColor(1, 0, 255, 0);
arduino.strip.setPixelColor(2, 0, 0, 255);
arduino.strip.show(); // Sends all changes at once

// Analog writes are throttled to prevent spam
arduino.analogWrite(9, mouseX); // Won't flood with messages
```

### Performance Optimization
Extensions include intelligent change detection:

```javascript
// NeoPixel color changes below threshold are ignored
arduino.strip.setThreshold(10); // Only send if color change > 10

// Servo movements below 1° threshold are ignored  
arduino.myServo.setThreshold(2); // Only move if change > 2°

// Ultrasonic reading throttling
arduino.mySensor.setReadThrottle(100); // Max one reading every 100ms
```

## Pin Reference

### Arduino UNO R4 WiFi
```
Digital pins: 0-13 (pin 13 has built-in LED)
Analog pins:  A0-A5 (also numbered 14-19)
PWM pins:     3, 5, 6, 9, 10, 11 (for analogWrite/servos)
Good for ultrasonic: 2-12 (avoid pin 1 and serial pins 0,1)
```

### ESP32
```
Most pins: 0-39 (avoid pins 6-11, used internally)
Good for LEDs: 2, 4, 5, 12, 13
Good for servos: 16, 17, 18, 19
Good for ultrasonic: 2, 4, 5, 12-19, 21-23, 25-27, 32-39
Input only: 34-39 (can't be outputs - use only for ultrasonic echo pins)
```

## Extension System

### Supported Extensions

1. **NeoPixel** (Device ID: 200)
   - Support for up to 8 independent strips
   - RGB and RGBW pixels supported
   - Brightness control per strip
   - Optimized batching of pixel updates

2. **Servo** (Device ID: 201)
   - Support for up to 12 servos
   - Standard 180° servo control
   - Microsecond-level control
   - Smooth sweep animations
   - Throttling to prevent jitter

3. **Ultrasonic** (Device ID: 202)
   - Support for up to 8 sensors
   - 3-wire and 4-wire sensor support
   - Configurable timeout settings
   - Distance measurement in cm or inches
   - Range detection and proximity alerts

### Creating Custom Extensions

Extensions follow a standard pattern. Here's the structure:

```javascript
class MyExtension {
    constructor(arduino) {
        this.arduino = arduino;
        this.deviceId = YOUR_DEVICE_ID; // 203+
        this.logicalId = null; // Automatically assigned
    }
    
    // Your methods here
    init(params) {
        this.arduino.send({
            id: this.deviceId,
            action: YOUR_INIT_ACTION,
            params: [this.logicalId, ...params]
        });
    }
}
```

## Protocol Details

### Core Actions (1-6)
- `PIN_MODE` (1): Configure pin modes
- `DIGITAL_WRITE` (2): Digital output control  
- `DIGITAL_READ` (3): Digital input reading
- `ANALOG_WRITE` (4): PWM output control
- `ANALOG_READ` (5): Analog input reading
- `END` (6): Stop registered actions

### Extension Actions
- **NeoPixel** (10-15): Init, set pixel, fill, clear, brightness, show
- **Servo** (20-25): Attach, detach, write angle, write microseconds, read, attached
- **Ultrasonic** (30-33): Attach, detach, read distance, set timeout

### Message Format
```javascript
{
    header: { version: 1 },
    data: [
        { id: pin_or_device_id, action: action_code, params: [...] }
    ]
}
```

## Common Issues & Solutions

### "Can't connect to Arduino"
- Check the IP address matches what Arduino displays
- Make sure Arduino and computer are on same WiFi network
- Ensure you're running the web page locally (not in online IDE)
- Try refreshing the web page

### "Arduino keeps disconnecting" (UNO R4)
- This is a known issue with UNO R4 WiFi module
- The system handles reconnection automatically
- Your commands still work despite console messages

### "ESP32 won't start"
- Check board selection in Arduino IDE
- For ESP32 Wrover boards, try selecting "ESP32 Dev Module"
- Ensure proper power supply (USB should be sufficient for development)

### "NeoPixels don't light up"
- Check power connections - strips need adequate current
- Try different pins (avoid pin 1 on UNO R4)
- Verify LED strip type (NEO_GRB vs NEO_RGB)
- Connect strip VCC to 5V, data pin works with 3.3V or 5V logic

### "Servos jitter or don't move smoothly"
- Check power supply - servos need adequate current
- Use appropriate pins (PWM-capable pins)
- Adjust servo movement thresholds if too sensitive
- Ensure servo.show() timing isn't too frequent

### "Ultrasonic sensor doesn't work"
- Check wiring: VCC to 5V, GND to GND, Trig and Echo to correct pins
- Try increasing timeout: `arduino.mySensor.setTimeout(50)`
- Ensure sensor is pointed at flat, perpendicular surfaces
- Check Serial Monitor/browser console for connection errors

### "Ultrasonic readings are erratic"
- Mount sensor stable and level
- Point at flat surfaces (avoid soft materials like fabric)
- Increase timeout for longer distances
- Use averaging in JavaScript code to smooth readings

### "Multiple devices interfere"
- Each device instance gets a unique logical ID automatically
- Use `arduino.listExtensions()` to verify device assignments
- Check that you're using updated Arduino firmware

### "Sensor readings are noisy"
- This is normal - implement averaging in your JavaScript
- Increase reading intervals for slower updates
- Use threshold settings to ignore minor changes

## Understanding the Code

### JavaScript Side (Web Interface)
- `arduino.pinMode()` - configures pin modes (like Arduino IDE)
- `arduino.digitalWrite()` - digital output control
- `arduino.analogWrite()` - PWM output control (0-255)
- `arduino.digitalRead()` - reads digital inputs (0 or 1)
- `arduino.analogRead()` - reads analog inputs (0-1023 UNO R4, 0-4095 ESP32)
- `arduino.add(id, extension)` - adds device extensions
- `arduino.listExtensions()` - debug info about attached devices

### Arduino Side (Firmware)
- Modular extension system for adding device support
- WebSocket server on port 81
- JSON-based command protocol
- Automatic periodic reading registration
- Memory-efficient action management

### System Features
- **Automatic reconnection** with exponential backoff
- **Message batching** for performance optimization
- **Command throttling** to prevent Arduino overload
- **Change detection** to minimize unnecessary updates
- **Multi-device support** with logical ID assignment
- **Platform abstraction** for UNO R4 and ESP32 compatibility

## Project Structure
```
Pardalote/                # Arduino code
├── Pardalote.ino         # Main Arduino sketch
├── defs.h                 # Protocol definitions and action codes
├── NeoPixelExtension.h    # NeoPixel support (up to 8 strips)
├── ServoExtension.h       # Servo support (up to 12 servos)
├── UltrasonicExtension.h  # Ultrasonic support (up to 8 sensors)
└── secrets.h              # Your WiFi credentials (create this file)

JavaScript/                # Web interface code  
├── index.html             # Main web page template
├── sketch.js              # Your project code (edit this!)
├── pardalote.js         # Arduino communication system
├── neoPixel.js            # NeoPixel JavaScript extension
├── servo.js               # Servo JavaScript extension
├── ultrasonic.js          # Ultrasonic JavaScript extension
└── package.json           # Project metadata
```

## Performance Tips

1. **Batch NeoPixel updates:** Set multiple pixels, then call `show()` once
2. **Use thresholds:** Set appropriate thresholds to avoid unnecessary updates  
3. **Optimize reading intervals:** Don't read sensors faster than needed
4. **Minimize servo writes:** Large angle changes work better than many small ones
5. **Monitor connection:** Use `getStatus()` to check connection health
6. **Ultrasonic optimization:** Use `setReadThrottle()` to limit sensor update frequency

## Learning Resources

- **Arduino basics**: [arduino.cc/en/Tutorial](https://arduino.cc/en/Tutorial)
- **p5.js graphics**: [p5js.org/get-started](https://p5js.org/get-started)
- **Web development**: [developer.mozilla.org](https://developer.mozilla.org)
- **Electronics**: [sparkfun.com/tutorials](https://sparkfun.com/tutorials)
- **WebSocket protocol**: [developer.mozilla.org/en-US/docs/Web/API/WebSockets_API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

## Contributing

Found a bug or want to add a feature? Contributions welcome!

1. Fork this repository
2. Make your changes
3. Test with both UNO R4 and ESP32 if possible
4. Submit a pull request

### Adding Extensions

To add support for new devices:

1. **Arduino side:** Create a new extension header file following the pattern in `NeoPixelExtension.h`
2. **JavaScript side:** Create a corresponding JavaScript class following the pattern in `neoPixel.js`
3. **Update definitions:** Add new device IDs and action codes to `defs.h`
4. **Register extension:** Add the new extension to the handler in the main Arduino sketch

## License

GNU General Public License v3.0 - free to use and modify for any purpose.

## Author

Scott Mitchell - Created for design education and creative technology projects.