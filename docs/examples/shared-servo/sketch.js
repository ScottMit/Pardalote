// ==============================================================
// Shared Servo — p5.js + Pardalote
// The Arduino sketch created this servo — the browser gets it automatically as
// arduino.pan. No arduino.add(), no attach(), and no pin to set here (the
// sketch owns the wiring).
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

const W = 600, H = 340;

let arduino, haveServo = false;

function setup() {
    createCanvas(W, H);
    textFont('Poppins');
    createDiv('The sketch nods the servo every 4 s. Press the mouse to take over; '
        + 'release to hand it back. The servo pin is set in the Arduino sketch.').class('hint').parent(select('main'));

    arduino = new Arduino();
    setupConnection(arduino, { store: 'pardalote-shared-servo' });

    // The Arduino sketch calls PardaloteServo.attach("pan", 9), so arduino.pan
    // simply exists by the time 'ready' fires — nothing to configure here.
    arduino.on('ready', () => {
        haveServo = !!arduino.pan;
        if (!haveServo) console.warn('The sketch did not create a "pan" servo');
    });
    arduino.on('disconnect', () => { haveServo = false; });
}

function draw() {
    background(255);

    if (!haveServo) {
        fill('#6d6a5f'); noStroke(); textSize(14); textAlign(CENTER);
        text(arduino.connected ? 'Waiting for the board’s servo…' : 'Connect to begin', width / 2, 160);
        textAlign(LEFT);
        return;
    }

    // Take over while the mouse is pressed — a plain Servo write, the same call
    // you'd make on a browser-created servo.
    if (mouseIsPressed && mouseY >= 0 && mouseY <= height && mouseX >= 0 && mouseX <= width) {
        arduino.pan.write(map(constrain(mouseX, 0, width), 0, width, 0, 180));
    }

    // arduino.pan.angle tracks BOTH sides' writes: browser writes set it, and
    // sketch writes are auto-echoed into it.
    drawServo(arduino.pan.angle);
}

function drawServo(angle) {
    // house palette: hairline track, teal arm, ink hub
    push();
    translate(width / 2, 230);
    stroke('#d9d2c2'); strokeWeight(2); noFill();
    arc(0, 0, 220, 220, PI, TWO_PI);
    stroke('#3FA9A0'); strokeWeight(5);
    const a = radians(180 - angle);
    line(0, 0, 110 * cos(a), -110 * sin(a));
    fill('#2B2420'); noStroke(); circle(0, 0, 12);
    textAlign(CENTER); textSize(18);
    text(`${round(angle)}°`, 0, 44);
    textAlign(LEFT);
    pop();
}
