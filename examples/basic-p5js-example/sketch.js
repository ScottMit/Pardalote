// ==============================================================
// P5js to Arduino Control
// Basic example showing how to use p5.js with Pardalote
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.128';   // Change this to your Arduino's IP

let arduino;

// Arduino pins - Change this to match the pin you are using.
// NOTE (ESP32): analog input must be on an ADC1 pin — ADC2 pins
// (GPIO 0,2,4,12-15,25-27) are disabled while WiFi is on and read 0.
// ADC1 pins: 36(A0), 39(A3), 32(A4), 33(A5), 34(A6), 35(A7).
const POTPIN = 36;   // A0

function setup() {
    createCanvas(600, 600);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // configure the Arduino pin and set the read interval (ms)
    arduino.pinMode(POTPIN, ANALOG_INPUT, 50);
}

function draw() {
    background(50);

    // get reading from the Arduino
    let dial = arduino.analogRead(POTPIN);
    let circleRadius = map(dial, 0, arduino.analogMax, 2, 300);
    // for UNO the ADC range is 0-1023
    // for ESP32 the ADC range is 0-4095
    // you can also use arduino.analogMax to automatically get the board's ADC range.

    // draw circle — green when connected, red when not
    noStroke();
    if(arduino.connected) fill(60, 200, 80);
    else fill(200, 50, 60);
    circle(width / 2, height / 2, circleRadius * 2);
}
