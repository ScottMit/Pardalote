// ==============================================================
// Ultrasonic Sensor Control from P5js
// Basic example showing how to use p5.js to read ultrasonic sensors with Pardalote
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

const ArduinoIP = '172.20.10.12';
const TRIG_PIN = 12;
const ECHO_PIN = 14;

let arduino;
let maxDistance = 200; // Maximum distance to display (cm)

function setup() {
    createCanvas(600, 600);
    colorMode(HSB);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // attach ultrasonic sensor to the Arduino
    arduino.add('ultrasonicSensor', new Ultrasonic());

    // Attach sensor
    arduino.ultrasonicSensor.attach(TRIG_PIN, ECHO_PIN);

    // Set timeout to 40ms to allow readings up to ~600cm
    arduino.ultrasonicSensor.setTimeout(40);

    // Configure poll in ms and unit in CM or INCH
    arduino.ultrasonicSensor.read(200, CM);

    console.log("Ultrasonic sensor demo started!");
    console.log("Move an object in front of the sensor to see the visualization change");
}

function draw() {
    background(0, 0, 30);

    let cm = arduino.ultrasonicSensor.read();

    let distance = constrain(cm, 0, maxDistance);

    // Draw distance visualization
    drawDistanceBar(distance);
    drawUI(distance);
}

function drawDistanceBar(distance) {
    // Distance bar on the left side
    let barWidth = 60;
    let barHeight = height - 100;
    let barX = 400;
    let barY = 50;

    // Bar background
    fill(0, 0, 0, 100);
    rect(barX, barY, barWidth, barHeight);

    // Distance indicator
    if (distance > 0 && distance <= maxDistance) {
        let barFill = map(distance, 0, maxDistance, barHeight, 0);
        let barHue = map(distance, 0, maxDistance, 0, 120);
        fill(barHue, 255, 255);
        rect(barX, barY + barFill, barWidth, barHeight - barFill);
    }

    // Scale markers
    stroke(0, 0, 255, 150);
    fill(0, 0, 255, 150);
    textAlign(RIGHT);
    textSize(10);
    for (let i = 0; i <= maxDistance; i += 50) {
        let y = map(i, 0, maxDistance, barY + barHeight, barY);
        line(barX + barWidth, y, barX + barWidth + 5, y);
        noStroke();
        text(i, barX + barWidth + 20, y + 3);
        stroke(0, 0, 255, 150);
    }
}

function drawUI(distance) {
    // Title and instructions
    fill(0, 0, 255);
    textAlign(LEFT);
    textSize(24);
    text("Ultrasonic Sensor Demo", 20, 50);

    // Connection status
    fill(arduino.connected ? color(120, 255, 255) : color(0, 255, 255));
    textSize(16);
    text("Arduino: " + (arduino.connected ? "Connected" : "Disconnected"), 20, 80);

    // Sensor info
    if (distance > 0) {
        textAlign(LEFT);
        textSize(16);
        fill(0, 0, 255);
        text("Distance: " + distance.toFixed(1) + " cm", 20, 110);
    } else {
        fill(0, 255, 255);
        textAlign(LEFT);
        textSize(16);
        text("No object detected or out of range", 20, 110);
    }
}