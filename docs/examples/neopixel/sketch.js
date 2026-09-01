// ==============================================================
// NeoPixel — p5.js + Pardalote
// Mix a colour with the mouse and the LED strip follows it live: across the
// canvas = hue, up and down = brightness.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

// Your NeoPixel strip's data pin and length.
//   ESP32: 27 is a safe default.
const PIN   = 27;
const COUNT = 8;

const W = 600, H = 400;

let arduino;

function setup() {
    createCanvas(W, H);
    drawColourField();

    arduino = new Arduino();
    arduino.add('strip', new NeoPixel());
    setupConnection(arduino, { store: 'pardalote-neopixel' });   // Provides the Pardalote example Web UI for connecting
    // arduino.connect(ArduinoIP);   // Skip the Web UI and connect directly over WiFi
    // arduino.connectSerial();      // or over USB.

    // Set up the strip once the board is ready. Device state resets on every
    // (re)connect, so 'ready' is the place to (re)initialise it.
    arduino.on('ready', () => {
        arduino.strip.init(PIN, COUNT);   // data pin, number of pixels
        arduino.strip.setBrightness(50);
        arduino.strip.clear();
        arduino.strip.show();
    });
}

// The hue (x) × brightness (y) field — drawn once; draw() only overlays a swatch.
function drawColourField() {
    colorMode(HSB);
    noStroke();
    for (let i = 0; i < width; i++) {
        const newH = map(i, 0, width, 0, 360);
        for (let j = 0; j < height; j++) {
            const newB = map(j, 0, height, 110, 0);
            fill(newH, 255, newB);
            rect(i, j, 1, 1);
        }
    }
    colorMode(RGB);
}

function draw() {
    const circleRadius = 50;
    let neoColor;
    // pick the NeoPixel colour from the mouse location
    if (dist(mouseX, mouseY, width / 2, height / 2) < circleRadius) {
        neoColor = arduino.strip.Color(255, 255, 255);   // white in the centre
        fill(255);
    } else {
        const pixelColor = get(mouseX, mouseY);
        fill(pixelColor);
        neoColor = arduino.strip.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
    }

    // push the colour to the whole strip (show() is rate-limited by the library)
    if (arduino.connected) {
        arduino.strip.fill(neoColor, 0, COUNT);
        arduino.strip.show();
    }

    // preview the colour on a central circle
    noStroke();
    circle(width / 2, height / 2, circleRadius * 2);
}
