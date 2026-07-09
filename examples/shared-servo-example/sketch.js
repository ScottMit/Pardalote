// ==============================================================
// Shared Servo Example
// The Arduino sketch created this servo — the browser gets it
// automatically as arduino.pan. No arduino.add(), no attach().
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.128';   // Change this to your Arduino's IP

let arduino;
let haveServo = false;

function setup() {
    createCanvas(600, 400);

    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // No arduino.add() here — the sketch calls
    // PardaloteServo.attach("pan", 9), so arduino.pan simply exists
    // by the time 'ready' fires.
    arduino.on('ready', () => {
        haveServo = !!arduino.pan;
        if (!haveServo) console.warn('The sketch did not create a "pan" servo');
    });

    // Optional: fires the moment the board announces a sketch-created
    // object (before 'ready').
    arduino.on('share', ({ name }) => console.log(`Board created arduino.${name}`));
}

function draw() {
    background(50);

    fill(255);
    textSize(16);
    text('Shared Servo — created by the Arduino sketch', 20, 30);
    text('The sketch nods the servo every 4 s.', 20, 60);
    text('Press the mouse to take over; release to hand it back.', 20, 90);

    if (!haveServo) {
        text('Waiting for the board…', 20, 140);
        return;
    }

    // Take over while the mouse is pressed — a plain Servo write, the
    // same call you'd make on a browser-created servo.
    if (mouseIsPressed) {
        arduino.pan.write(map(constrain(mouseX, 0, width), 0, width, 0, 180));
    }

    // arduino.pan.angle tracks BOTH sides' writes: browser writes set it,
    // and sketch writes are auto-echoed into it.
    drawServo(arduino.pan.angle);
}

function drawServo(angle) {
    push();
    translate(width / 2, 280);
    stroke(120); strokeWeight(4); noFill();
    arc(0, 0, 220, 220, PI, TWO_PI);
    stroke(255, 180, 0); strokeWeight(6);
    const a = radians(180 - angle);
    line(0, 0, 110 * cos(a), -110 * sin(a));
    noStroke(); fill(255);
    textAlign(CENTER);
    text(`${round(angle)}°`, 0, 40);
    textAlign(LEFT);
    pop();
}
