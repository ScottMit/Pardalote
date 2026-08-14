// ==============================================================
// Potentiometer — p5.js + Pardalote
// Basic example: read an analog input and draw with it.
// Turn the knob and the circle grows and shrinks in real time.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '172.20.10.4';   // Change this to your Arduino's IP

let arduino;

// Arduino pins - Change this to match the pin you are using.
const POTPIN = 14;   // UNO IO 14 / ESP32 IO 36

function setup() {
    createCanvas(600, 600);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // configure the Arduino pin and set the read interval (ms)
    arduino.pinMode(POTPIN, ANALOG_INPUT_MODE, 50);
}

function draw() {
    background(255);

    // get reading from the Arduino
    let dial = arduino.analogRead(POTPIN);
    let circleRadius = map(dial, 0, arduino.analogMax, 10, 300);
    // for UNO the ADC range is 0-1023
    // for ESP32 the ADC range is 0-4095

    // draw circle — teal when connected, orange when not
    noStroke();
    if (arduino.connected) fill('#3FA9A0');
    else fill('#D3542B');
    circle(width / 2, height / 2, circleRadius * 2);
}
