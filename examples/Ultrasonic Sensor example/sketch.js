// ==============================================================
// Ultrasonic Sensor Control from P5js
// Basic example showing how to use P5js to read ultrasonic sensors with JS2Arduino - arduinoComs.js
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.0.0.43';

let arduino;
let distance = 0;
let maxDistance = 200; // Maximum distance to display (cm)

function setup() {
    createCanvas(600, 600);
    colorMode(HSB);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // attach ultrasonic sensor to the Arduino
    arduino.add('ultrasonicSensor', new Ultrasonic(arduino));

    // Attach sensor: trig pin 7, echo pin 8
    arduino.ultrasonicSensor.attach(7, 8);

    // Set timeout to 30ms for longer distances, default is 20ms
    arduino.ultrasonicSensor.setTimeout(40);

    console.log("Ultrasonic sensor demo started!");
    console.log("Move an object in front of the sensor to see the visualization change");
}

function draw() {
    background(0, 0, 30);

    // Read distance from ultrasonic sensor in cm
    distance = arduino.ultrasonicSensor.read();

    distance = constrain(distance, 0, maxDistance);

    // Draw distance visualization
    drawDistanceBar();
    drawUI();
}

function drawDistanceBar() {
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
    fill(0, 0, 255, 150);
    textAlign(RIGHT);
    textSize(10);
    for (let i = 0; i <= maxDistance; i += 50) {
        let y = map(i, 0, maxDistance, barY + barHeight, barY);
        line(barX + barWidth, y, barX + barWidth + 5, y);
        text(i, barX + barWidth + 20, y + 3);
    }
}

function drawUI() {
    // Title and instructions
    fill(0, 0, 255);
    textAlign(LEFT);
    textSize(24);
    text("Ultrasonic Sensor Demo", 20, 50);

    // Connection status
    let status = arduino.getStatus();
    fill(status.connected ? color(120, 255, 255) : color(0, 255, 255));
    textSize(16);
    text("Arduino: " + (status.connected ? "Connected" : "Disconnected"), 20, 80);

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