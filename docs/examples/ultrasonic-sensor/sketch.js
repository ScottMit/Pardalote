// ==============================================================
// Ultrasonic sensor — p5.js + Pardalote
// Read an HC-SR04 distance sensor and visualise it: the bar fills (and shifts
// teal → orange) as an object gets closer.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

// Your HC-SR04's trigger and echo pins.
const TRIG = 12;
const ECHO = 14;

const W = 600, H = 500;
const maxDistance = 200;   // max distance to display (cm)

// House palette
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', ORANGE = '#D3542B';

let arduino;

function setup() {
    createCanvas(W, H);
    textFont('Poppins');

    arduino = new Arduino();
    arduino.add('ultrasonicSensor', new Ultrasonic());
    setupConnection(arduino, { store: 'pardalote-ultrasonic' });   // Provides the Pardalote example Web UI for connecting
    // arduino.connect(ArduinoIP);   // Skip the Web UI and connect directly over WiFi
    // arduino.connectSerial();      // or over USB.

    // Attach the sensor once the board is ready. Device state resets on every
    // (re)connect, so 'ready' is the place to (re)configure it.
    arduino.on('ready', () => {
        arduino.ultrasonicSensor.attach(TRIG, ECHO);   // trig pin, echo pin
        arduino.ultrasonicSensor.setTimeout(40);        // ~600 cm ceiling
        arduino.ultrasonicSensor.read(200, CM);         // poll ms, unit CM or INCH
    });
}

function draw() {
    background(255);
    const cm = arduino.connected ? arduino.ultrasonicSensor.read() : 0;
    const distance = constrain(cm, 0, maxDistance);
    drawDistanceBar(distance);
    drawUI(distance);
}

function drawDistanceBar(distance) {
    const barWidth = 60, barHeight = height - 100, barX = 400, barY = 50;

    // Bar track
    noFill();
    stroke(INK); strokeWeight(1.5);
    rect(barX, barY, barWidth, barHeight);

    // Distance indicator — teal far away, orange up close
    if (distance > 0 && distance <= maxDistance) {
        const barFill = map(distance, 0, maxDistance, barHeight, 0);
        const c = lerpColor(color(ORANGE), color(TEAL), distance / maxDistance);
        noStroke(); fill(c);
        rect(barX, barY + barFill, barWidth, barHeight - barFill);
    }

    // Scale markers
    stroke(HAIR); fill(GREY);
    textAlign(RIGHT); textSize(10);
    for (let i = 0; i <= maxDistance; i += 50) {
        const y = map(i, 0, maxDistance, barY + barHeight, barY);
        line(barX + barWidth, y, barX + barWidth + 5, y);
        noStroke();
        text(i, barX + barWidth + 28, y + 3);
        stroke(HAIR);
    }
}

function drawUI(distance) {
    noStroke();
    textAlign(LEFT);
    if (arduino.connected) {
        fill(TEAL); textSize(14);
        text('connected', 20, 50);
        if (distance > 0) {
            fill(INK); textSize(28);
            text(distance.toFixed(1) + ' cm', 20, 96);
        } else {
            fill(GREY); textSize(14);
            text('No object detected or out of range', 20, 90);
        }
    } else {
        fill(ORANGE); textSize(14);
        text('waiting for connection…', 20, 50);
    }
}
