// ==============================================================
// Ultrasonic sensor — p5.js + Pardalote
// Basic example: read an HC-SR04 distance sensor and visualise it.
// The bar fills (and shifts teal → orange) as an object gets closer.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '192.168.x.x';   // Change this to your Arduino's IP

let arduino;
let trigPin = 12;
let echoPin = 14;
let maxDistance = 200;   // Maximum distance to display (cm)

// House palette
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', ORANGE = '#D3542B';

function setup() {
    createCanvas(600, 500);
    textFont('Poppins');

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // attach ultrasonic sensor to the Arduino: trig pin, echo pin
    arduino.add('ultrasonicSensor', new Ultrasonic());
    arduino.ultrasonicSensor.attach(trigPin, echoPin);

    // Set timeout to 40ms to allow readings up to ~600cm
    arduino.ultrasonicSensor.setTimeout(40);

    // Configure poll in ms and unit in CM or INCH
    arduino.ultrasonicSensor.read(200, CM);
}

function draw() {
    background(255);

    let cm = arduino.ultrasonicSensor.read();
    let distance = constrain(cm, 0, maxDistance);

    drawDistanceBar(distance);
    drawUI(distance);
}

function drawDistanceBar(distance) {
    // Distance bar on the right side
    let barWidth = 60;
    let barHeight = height - 100;
    let barX = 400;
    let barY = 50;

    // Bar track
    noFill();
    stroke(INK); strokeWeight(1.5);
    rect(barX, barY, barWidth, barHeight);

    // Distance indicator — teal far away, orange up close
    if (distance > 0 && distance <= maxDistance) {
        let barFill = map(distance, 0, maxDistance, barHeight, 0);
        let c = lerpColor(color(ORANGE), color(TEAL), distance / maxDistance);
        noStroke(); fill(c);
        rect(barX, barY + barFill, barWidth, barHeight - barFill);
    }

    // Scale markers
    stroke(HAIR); fill(GREY);
    textAlign(RIGHT); textSize(10);
    for (let i = 0; i <= maxDistance; i += 50) {
        let y = map(i, 0, maxDistance, barY + barHeight, barY);
        line(barX + barWidth, y, barX + barWidth + 5, y);
        noStroke();
        text(i, barX + barWidth + 28, y + 3);
        stroke(HAIR);
    }
}

function drawUI(distance) {
    noStroke();
    textAlign(LEFT);

    // Connection status
    if (arduino.connected){
        fill(TEAL);
        textSize(14);
        text('connected', 20, 50);
        // Distance readout
        if (distance > 0) {
            fill(INK);
            textSize(28);
            text(distance.toFixed(1) + ' cm', 20, 96);
        } else {
            fill(GREY);
            textSize(14);
            text('No object detected or out of range', 20, 90);
        }
   } else {
        fill(ORANGE);
        textSize(14);
        text('waiting for connection…', 20, 50);
   }
}
