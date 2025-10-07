# P5js Bouncing Circle Example

An interactive p5.js example showing how to control an Arduino LED based on mouse position and read sensor data to control graphics using the Pardalote WebSocket communication system.

## What This Example Does

This example demonstrates bidirectional Arduino-to-web communication by creating an interactive bouncing circle:
- **Circle bounces around the canvas** - Using p5.js animation
- **Circle size controlled by Arduino sensor** - Connect a potentiometer to pin A0 to control the circle size
- **LED controlled by mouse position** - When you hover your mouse over the bouncing circle, the Arduino LED turns on
- **Real-time sensor feedback** - The potentiometer reading directly affects the circle size in real-time

## Hardware Requirements

- **Arduino UNO R4 WiFi** OR **ESP32 development board**
- **WiFi network** (Arduino and computer must be on the same network)
- **Potentiometer** (10kΩ recommended)
- **Breadboard and jumper wires**

### For Arduino UNO R4 WiFi
- Pin 13 has a built-in LED - no additional LED components needed
- Connect potentiometer: center pin to A0, outer pins to 5V and GND

### For ESP32
- **LED** (any color) and **220Ω resistor**
- Connect LED + resistor between pin 13 and ground (LED long leg to pin 13)
- Connect potentiometer: center pin to pin 1, outer pins to 3.3V and GND

## Software Requirements

- **Arduino IDE** (for uploading code to Arduino)
- **Web browser** (Chrome, Firefox, Safari, etc.)
- **Text editor** (for updating the IP address)

## Quick Start

### 1. Set Up Arduino Hardware

1. **Connect the potentiometer:**
   - Center pin → A0
   - One outer pin → 5V (UNO R4) or 3.3V (ESP32)
   - Other outer pin → GND

2. **For ESP32 only - Connect LED:**
   - LED long leg → Pin 13
   - LED short leg → 220Ω resistor → GND

### 2. Set Up Arduino Software

1. Download the Pardalote folder and open the `Pardalote.ino` file in the Arduino IDE
2. Update your WiFi credentials in the `secrets.h` tab
3. Upload the sketch to your Arduino
4. Open the Arduino IDE Serial Monitor and note the IP address shown
   - **UNO R4:** IP also displays on the board's LED matrix

### 3. Set Up Web Interface

1. Open `sketch.js` in a text or code editor
2. Update this line with your Arduino's IP address:
   ```javascript
   let ArduinoIP = '192.168.1.134';
   ```
3. Open `index.html` in your web browser

### 4. Test It

- **Circle should be bouncing** around the canvas
- **Turn the potentiometer** - the circle size should change
- **Hover over the circle** - the Arduino LED should turn on
- **Move mouse away** - the LED should turn off

## How It Works

The example demonstrates both input and output communication:

```javascript
// Connect to Arduino
arduino = new Arduino();
arduino.connect(ArduinoIP);

// Set up pins
arduino.pinMode(13, OUTPUT);           // LED output
arduino.pinMode(A0, ANALOG_INPUT);     // Potentiometer input

// Read sensor data
let sensorValue = arduino.analogRead(A0);  // Returns 0-1023

// Control LED based on interaction
arduino.digitalWrite(13, HIGH);  // Turn LED on
arduino.digitalWrite(13, LOW);   // Turn LED off
```

## Code Explanation

### sketch.js
- **p5.js setup():** Creates canvas, connects to Arduino, configures pins
- **p5.js draw():** Main animation loop that:
  - Reads potentiometer value with `arduino.analogRead(A0)`
  - Maps sensor value to circle size
  - Checks if mouse is over the circle
  - Controls LED based on mouse position
  - Animates bouncing circle movement

### index.html
- Loads p5.js library for graphics and animation
- Loads the Arduino communication library (`arduinoComs.js`)
- Loads the example code (`sketch.js`)
- Includes basic CSS styling

### Interactive Features
- **Sensor Input:** Potentiometer on A0 controls circle size (0-1023 → small to large circle)
- **Mouse Interaction:** LED turns on when mouse hovers over the moving circle
- **Visual Feedback:** Circle changes color (white/green) when mouse hovers
- **Physics:** Circle bounces off canvas edges realistically

## Troubleshooting

**"Circle doesn't change size"**
- Check potentiometer wiring (center pin to A0, outer pins to power/ground)
- Try turning the potentiometer - you should see the circle size change
- Check browser console for connection messages

**"LED doesn't turn on when hovering"**
- **UNO R4:** Built-in LED should be visible on the board
- **ESP32:** Check LED wiring (long leg to pin 13, short leg through resistor to ground)
- Make sure mouse cursor is actually over the circle

**"Circle doesn't bounce/move"**
- This is normal p5.js animation - should work if the page loads correctly
- Check browser console for JavaScript errors

**"General connection issues"**
- Check the IP address in `sketch.js` matches your Arduino's IP
- Make sure Arduino and computer are on the same WiFi network
- Check Arduino Serial Monitor and browser console for connection messages

**"Arduino won't connect to WiFi"**
- Check `secrets.h` has correct WiFi name and password
- Make sure WiFi network allows device connections
- Try restarting the Arduino

## Understanding the Code

This example shows several important concepts:

1. **Bidirectional Communication:** Both reading from Arduino (sensor) and writing to Arduino (LED)
2. **Real-time Interaction:** Sensor changes immediately affect the graphics
3. **Event-driven Control:** Mouse position determines Arduino output
4. **Animation Integration:** Arduino data seamlessly integrated with p5.js animation

## Next Steps

Once this example works, you can:

1. **Add more sensors** - Temperature, light, distance sensors
2. **Add more outputs** - Multiple LEDs, servo motors, buzzers
3. **Try different interactions** - Keyboard control, button presses
4. **Advanced graphics** - More complex animations driven by sensor data
5. **Try the NeoPixel extension** - Control colorful LED strips

## File Structure
```
Ultrasonic Sensor example/
├── index.html      # Web interface with p5.js
├── sketch.js       # Your example code (edit the IP here!)
├── style.css       # Basic styling
├── pardalote.js    # Arduino communication library
└── README.md       # This file
```

## Learn More

This example uses the Pardalote system. See the main project README for:
- More complex examples
- NeoPixel LED strip control
- Complete sensor reading examples  
- Full API documentation