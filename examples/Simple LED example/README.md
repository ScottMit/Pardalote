# Simple LED Control Example

A minimal example showing how to control an Arduino LED from a web browser using the Pardalote WebSocket communication system.

## What This Example Does

This is the simplest possible example of Arduino-to-web communication. It creates a web page with two buttons:
- **Turn LED ON** - Lights up the built-in LED connected to Arduino pin 13
- **Turn LED OFF** - Turns off the built-in LED connected to pin 13

## Hardware Requirements

- **Arduino UNO R4 WiFi** OR **ESP32 development board**
- **WiFi network** (Arduino and computer must be on the same network)
- If you are using an Arduino UNO R4, that's it! The code will uses the built-in LED - no additional components needed. 
- If you are using an ESP32 then you will need to connect your own LED and resistor to pin 13.

## Software Requirements

- **Arduino IDE** (for uploading code to Arduino)
- **Web browser** (Chrome, Firefox, Safari, etc.)
- **Text editor** (for updating the IP address)

## Quick Start

### 1. Set Up Arduino

1. Download the Pardalote folder and open the `Pardalote.ino` file in the Arduino IDE
2. Update your WiFi credentials in the `secrets.h` tab.
3. Upload the sketch to your Arduino.
4. Open the Arduino IDE Serial Monitor and make a note of the IP address shown. If you are using an Arduino UNO R4 the address is also shown on the boards LED matrix.

### 2. Set Up Web Interface

1. Open `sketch.js` in a text or code editor
2. Update this line with your Arduino's IP address:
   ```javascript
   let ArduinoIP = '192.168.1.134';
   ```
3. Open `index.html` in your web browser

### 3. Test It

- Click "Turn LED ON" - the built-in LED should light up
- Click "Turn LED OFF" - the built-in LED should turn off

## How It Works

The example uses three simple Arduino communication functions:

```javascript
// Connect to Arduino
arduino = new Arduino();
arduino.connect(ArduinoIP);

// Set pin 13 as output
arduino.pinMode(13, OUTPUT);

// Turn LED on/off
arduino.digitalWrite(13, HIGH);  // ON
arduino.digitalWrite(13, LOW);   // OFF
```

## Code Explanation

### sketch.js
- Connects to Arduino via WebSocket
- Sets up pin 13 as an output (You can use a different pin if you like. On the UNO this pin connects to a built-in LED).
- Defines button click handlers that call `arduino.digitalWrite()`

### index.html  
- Creates two buttons with IDs `led-on` and `led-off`
- Loads the Arduino communication library (`arduinoComs.js`)
- Loads the example code (`sketch.js`)

### The Magic
The `arduinoComs.js` library handles all the complex WebSocket communication, JSON message formatting, and Arduino protocol details. You just call simple Arduino-like functions!

## Troubleshooting

**"Buttons don't work"**
- Check the IP address in `sketch.js` matches your Arduino's IP
- Make sure the Arduino and computer are connected to the same WiFi network
- Check Arduino Serial Monitor and Web browser for connection messages

**"Can't find Arduino IP address"**
- **UNO R4:** The IP should scroll on the LED matrix display. If the IP displays as 0.0.0.0 then the Arduino has a network connection error - see below.
- **ESP32:** The IP should show in Arduino IDE Serial Monitor when the ESP is starting up. If you can't see it try hitting the ESP's reset button while the Serial Monitor connection is open.

**"Arduino won't connect to WiFi"**
- Check `secrets.h` has correct WiFi name and password
- Make sure WiFi network allows device connections
- Try restarting the Arduino/ESP

## Next Steps

Once this basic example works, you can:

1. **Add more LEDs** - Control LEDs on other pins
2. **Read sensors** - Use `arduino.analogRead()` to get sensor data
3. **Add more buttons** - Control different devices
4. **Try the NeoPixel extension** - Control colorful LED strips

## File Structure
```
Simple LED example/
├── index.html      # Web interface
├── sketch.js       # Your example code (edit the IP here!)
├── pardalote.js    # Arduino communication library
└── README.md       # This file
```

## Learn More

This example uses the Pardalote system. See the main project README for:
- More complex examples
- NeoPixel LED strip control  
- Sensor reading examples
- Complete API documentation