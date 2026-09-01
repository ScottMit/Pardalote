// ==============================================================
// Potentiometer — p5.js + Pardalote
// Read an analog input and draw with it: turn the knob and the circle
// grows and shrinks in real time.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson: configure a pin, read it, draw.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

// The pin your potentiometer's wiper is connected to.
//   UNO: 14 (A0)      ESP32: 36
const PIN = 14;

let arduino;

function setup() {
    createCanvas(600, 600);

    arduino = new Arduino();
    setupConnection(arduino, { store: 'pardalote-potentiometer' });   // Provides the Pardalote example Web UI for connecting
    // arduino.connect(ArduinoIP);   // Skip the Web UI and connect directly over WiFi
    // arduino.connectSerial();      // or over USB.

    // Configure the pin once the board is ready. 'ready' fires on every
    // (re)connect, since the board forgets its pins on reset.
    arduino.on('ready', () => arduino.pinMode(PIN, ANALOG_INPUT_MODE, 50));   // read every 50 ms
}

function draw() {
    background(255);

    // Latest reading from the Arduino (0 until connected).
    const dial = arduino.analogRead(PIN);
    const radius = map(dial, 0, arduino.analogMax || 1023, 10, 300);
    // UNO's ADC range is 0–1023; ESP32's is 0–4095. arduino.analogMax tracks the board.

    // Circle — green when connected, red when not.
    noStroke();
    if (arduino.connected) fill(60, 200, 80);
    else fill(200, 50, 60);
    circle(width / 2, height / 2, radius * 2);
}
