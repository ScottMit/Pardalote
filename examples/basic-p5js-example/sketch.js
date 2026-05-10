// ==============================================================
// P5js to Arduino Control
// Basic example showing how to use p5.js with Pardalote
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.45';

let arduino;

// Arduino pins - Change this to match the pin you are using
const POTPIN = 2;

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
    let circleRadius = map(dial, 0, 4095, 2, 100);
    // for UNO the ADC range is 0-1023
    // for ESP32 the ADC range is 0-4095
    // you can also use arduino.analogMax to automatically get the board's ADC range.

    // draw circle — green when connected, red when not
    noStroke();
    if(arduino.connected) fill(60, 200, 80);
    else fill(200, 50, 60);
    circle(width / 2, height / 2, circleRadius * 2);
}
