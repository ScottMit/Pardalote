# NeoPixel Color Control Example

An interactive p5.js example demonstrating real-time NeoPixel LED strip control using the Pardalote WebSocket communication system. Control colorful LED strips directly from your web browser with mouse interaction.

## What This Example Does

This example creates an interactive color picker that controls a NeoPixel LED strip in real-time:
- **Interactive color field** - Move your mouse around to pick colors from the rainbow gradient
- **LED strip responds instantly** - NeoPixels change color to match your mouse position
- **Rainbow effect** - Hover over the center circle to create an animated rainbow pattern
- **Real-time feedback** - Visual circle on screen changes color to match the LED strip

## Hardware Requirements

- **Arduino UNO R4 WiFi** OR **ESP32 development board**
- **WiFi network** (Arduino and computer must be on the same network)
- **NeoPixel LED strip** (WS2812B or compatible, 8 LEDs recommended)
- **Power considerations:**
  - For 8 LEDs: Arduino 5V pin can usually provide enough power
  - For longer strips: External 5V power supply recommended
- **Breadboard and jumper wires**

### NeoPixel Wiring

#### Arduino UNO R4 WiFi
- **NeoPixel VCC** → **5V** (Arduino)
- **NeoPixel GND** → **GND** (Arduino)  
- **NeoPixel Data** → **Pin 5** (configurable in code)

#### ESP32
- **NeoPixel VCC** → **5V** (or external 5V supply)
- **NeoPixel GND** → **GND** (Arduino + external supply if used)
- **NeoPixel Data** → **Pin 5** (configurable in code)

### NeoPixel Types Supported
- **WS2812B** (most common)
- **WS2811**
- **SK6812** (RGBW)
- Other Adafruit NeoPixel compatible strips

## Software Requirements

- **Arduino IDE** (for uploading firmware)
- **Web browser** (Chrome, Firefox, Safari, etc.)
- **Text editor** (for updating the IP address)

### Arduino Libraries Required
- **WebSocketsServer** (by Markus Sattler)
- **ArduinoJson** (by Benoit Blanchon)
- **Adafruit NeoPixel** (by Adafruit)

Install via Arduino IDE: Tools → Manage Libraries

## Quick Start

### 1. Set Up Arduino Hardware

1. **Connect the NeoPixel strip:**
   - Red wire (VCC) → 5V pin
   - Black wire (GND) → GND pin  
   - White/Yellow wire (Data) → Pin 5

2. **For longer strips (>30 LEDs):**
   - Use external 5V power supply
   - Connect all grounds together (Arduino GND, strip GND, supply GND)
   - Data line still connects to Arduino pin

### 2. Set Up Arduino Software

1. Download the Pardalote folder and open `Pardalote.ino` in Arduino IDE
2. Install the required libraries (WebSocketsServer, ArduinoJson, Adafruit_NeoPixel)
3. Update your WiFi credentials in the `secrets.h` tab:
   ```cpp
   #define SECRET_SSID "YourWiFiName" 
   #define SECRET_PASS "YourWiFiPassword"
   ```
4. Upload the sketch to your Arduino
5. Note the IP address from Serial Monitor or LED matrix (UNO R4)

### 3. Set Up Web Interface

1. Open `sketch.js` in a text editor
2. Update this line with your Arduino's IP address:
   ```javascript
   let ArduinoIP = '192.168.1.134';
   ```
3. **Optional:** Adjust strip configuration if needed:
   ```javascript
   arduino.neoStrip1.init(5, 8);  // Pin 5, 8 LEDs
   ```
4. Open `index.html` in your web browser

### 4. Test It

- **Move mouse around** - LED strip should change colors to match the gradient
- **Hover over center circle** - LED strip should display rainbow pattern
- **Watch the circle** - It shows the current color being sent to the LEDs

## How It Works

The example demonstrates advanced NeoPixel control with optimized performance:

```javascript
// Connect to Arduino and attach NeoPixel strip
arduino = new Arduino();
arduino.connect(ArduinoIP);
arduino.attach('neoStrip1', new NeoPixel(arduino));

// Initialize strip: pin 5, 8 pixels
arduino.neoStrip1.init(5, 8);

// Set brightness (0-255)
arduino.neoStrip1.setBrightness(50);

// Set all pixels to same color
let color = arduino.neoStrip1.Color(255, 0, 0); // Red
arduino.neoStrip1.fill(color);

// Set individual pixels
arduino.neoStrip1.setPixelColor(0, 255, 0, 0); // First pixel red
arduino.neoStrip1.setPixelColor(1, 0, 255, 0); // Second pixel green

// Always call show() to update the physical LEDs
arduino.neoStrip1.show();
```

## Code Explanation

### sketch.js Features
- **HSB Color Mode**: Uses Hue-Saturation-Brightness for creating smooth color gradients
- **get() Function**: Samples pixel colors from the canvas at mouse position
- **Color Mapping**: Converts p5.js colors to NeoPixel-compatible RGB values
- **Optimized Updates**: Only sends changes when needed to reduce network traffic
- **Rainbow Animation**: Demonstrates per-pixel color control

### Interactive Elements
- **Color Field**: 600x600 canvas with HSB color gradient
- **Mouse Tracking**: Real-time color sampling based on cursor position
- **Center Circle**: Triggers special rainbow effect when hovered
- **Visual Feedback**: Circle color matches current LED strip color

## Advanced Features

### Multiple Strips
```javascript
// Attach multiple NeoPixel strips
arduino.attach('strip1', new NeoPixel(arduino));
arduino.attach('strip2', new NeoPixel(arduino));

// Configure each independently  
arduino.strip1.init(5, 8);   // Pin 5, 8 LEDs
arduino.strip2.init(6, 16);  // Pin 6, 16 LEDs

// Control separately
arduino.strip1.fill(arduino.strip1.Color(255, 0, 0)); // Red
arduino.strip2.fill(arduino.strip2.Color(0, 0, 255)); // Blue
```

### RGBW Support (SK6812)
```javascript
// Initialize RGBW strip
arduino.neoStrip1.init(5, 8, NEO_RGBW + NEO_KHZ800);

// Set RGBW color (Red, Green, Blue, White)
arduino.neoStrip1.setPixelColor(0, 255, 0, 0, 100); // Red + White
```

### Custom Animations
```javascript
function pulseEffect(strip, numPixels) {
    let brightness = (sin(millis() * 0.01) + 1) * 127;
    strip.setBrightness(brightness);
    strip.show();
}
```

## Troubleshooting

**"LEDs don't light up"**
- Check power connections (VCC to 5V, GND to GND)
- Verify data pin connection (default: pin 5)
- Try lower brightness: `arduino.neoStrip1.setBrightness(10)`
- Check strip type in init: `arduino.neoStrip1.init(5, 8, NEO_GRB)`

**"Wrong colors displayed"**
- Try different strip types: `NEO_RGB`, `NEO_GRB`, `NEO_BRG`
- Common fix: `arduino.neoStrip1.init(5, 8, NEO_GRB + NEO_KHZ800)`

**"LEDs flicker or behave erratically"**
- Power issue - use external 5V supply for strips >30 LEDs
- Add 470Ω resistor between Arduino pin and NeoPixel data line
- Keep data wires short (under 6 inches if possible)

**"Colors don't match mouse position"**
- Check browser console for connection errors
- Verify IP address matches Arduino's IP
- Make sure `arduino.neoStrip1.show()` is called after color changes

**"Arduino won't connect to WiFi"**
- Double-check WiFi credentials in `secrets.h`
- Try 2.4GHz network (avoid 5GHz-only networks)
- Check Serial Monitor for connection status

**"Performance is slow/laggy"**
- There is a known bug with WebSockets on the Arduino UNO R4 which may impact performance
- Reduce update frequency by increasing threshold values
- Use `arduino.neoStrip1.setThreshold(10)` to reduce message frequency
- Consider fewer LEDs for faster updates

## Understanding the Code

This example demonstrates several advanced concepts:

1. **Color Space Conversion**: Converting HSB → RGB → NeoPixel format
2. **Event-driven Animation**: Mouse movement triggers immediate LED updates  
3. **Optimized Communication**: Batched updates and change detection
4. **Canvas Interaction**: Using p5.js get() to sample colors from graphics
5. **Multiple Animation States**: Different behaviors based on mouse position

## Next Steps

Once this example works, you can:

1. **Add more interactive elements** - Buttons, sliders, keyboard controls
2. **Try different patterns** - Breathing, chase, sparkle effects
3. **Multiple strips** - Control ceiling, floor, and accent lighting separately  
4. **Sensor integration** - Change colors based on temperature, sound, etc.
5. **Save/load presets** - Store favorite color combinations
6. **Web interface enhancements** - Add color picker, preset buttons, effect controls

## Configuration Options

### Strip Configuration
```javascript
// Different strip sizes and pins
arduino.neoStrip1.init(5, 8);    // 8 LEDs on pin 5
arduino.neoStrip1.init(6, 30);   // 30 LEDs on pin 6  
arduino.neoStrip1.init(7, 60);   // 60 LEDs on pin 7

// Different strip types
arduino.neoStrip1.init(5, 8, NEO_GRB + NEO_KHZ800);  // Most common
arduino.neoStrip1.init(5, 8, NEO_RGB + NEO_KHZ800);  // RGB order
arduino.neoStrip1.init(5, 8, NEO_RGBW + NEO_KHZ800); // RGBW strips
```

### Performance Tuning
```javascript
// Reduce update frequency for better performance
arduino.neoStrip1.setThreshold(15);  // Only send if color changes by 15+ units

// Adjust brightness for power savings
arduino.neoStrip1.setBrightness(50); // 0-255 range
```

## File Structure
```
examples/neopixel-control/
├── index.html          # Web interface with p5.js
├── sketch.js           # NeoPixel control code (edit IP here!)
├── style.css           # Basic styling  
├── pardalote.js        # Core communication
├── neoPixel.js         # NeoPixel extension
└── README.md           # This file
```

## Learn More

This example uses the Pardalote system's NeoPixel extension. See the main project README for:
- Complete API documentation
- Multiple device support examples
- Advanced animation techniques
- Troubleshooting guide

## Hardware Notes

### Power Requirements
- **1-8 LEDs**: Arduino 5V pin usually sufficient
- **9-30 LEDs**: External 5V/2A power supply recommended
- **30+ LEDs**: External 5V/4A+ power supply required
- Always connect all grounds together

### Data Signal Quality
- Keep data wires short (under 6 inches ideal)
- Add 470Ω resistor between Arduino pin and strip data line for longer runs
- Use twisted pair or shielded cable for runs over 3 feet