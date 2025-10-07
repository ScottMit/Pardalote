// ==============================================================
// P5js to Arduino Control
// Basic example showing how to use P5js with JS2Arduino - arduinoComs.js
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.0.0.43';

let arduino;
let circleX, circleY;
let dx, dy;

// pin globals
const LED = 13;
const POTPIN = A0; // Change this to match the pin you are using

function setup() {
    createCanvas(600, 600);

    // setup random variables
    circleX = random(100, 500);
    circleY = random(100, 500);
    dx = random(-5, 5);
    dy = random(-5, 5);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // configure pins for RGB LED
    arduino.pinMode(LED, OUTPUT);
    arduino.pinMode(POTPIN, ANALOG_INPUT, 100); // this is optional, the communication will work without it.
}

function draw() {
    background(50);

    // get reading from the Arduino
    let dial = arduino.analogRead(POTPIN);
    let circleRadius = map(dial, 0, 4095, 2, 100); // for UNO the range is 0-1023

    // Check if mouse is inside the circle
    let d = dist(mouseX, mouseY, circleX, circleY);

    if (d < circleRadius) {
        // Mouse is inside the circle
        fill(0, 250, 0); // Change color to green
        // turn on LED on
        arduino.digitalWrite(LED, HIGH);
    } else {
        // Mouse is outside the circle
        fill(250, 250, 250); // Change color to white
        // turn on LED off
        arduino.digitalWrite(LED, LOW);
    }

    // draw circle on canvas
    noStroke();
    circle(circleX, circleY, circleRadius*2);

    // move circle
    circleX += dx;
    circleY += dy;

    // bounce circle of edge of canvas
    if (circleX > width - circleRadius) {
        circleX = width - circleRadius;
        dx *= -1;
    } else if (circleX < circleRadius) {
        circleX = circleRadius;
        dx *= -1;
    }
    if (circleY > height - circleRadius) {
        circleY = height - circleRadius;
        dy *= -1;
    } else if (circleY < circleRadius) {
        circleY = circleRadius;
        dy *= -1;
    }
}