// ==============================================================
// Shared Servo Example
// The Arduino sketch created this servo — the browser gets it
// automatically as arduino.pan. No arduino.add(), no attach().
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '192.168.x.x';   // Change this to your Arduino's IP

let arduino;
let haveServo = false;

function setup() {
    createCanvas(600, 340);
    textFont('Poppins');
    createDiv('The sketch nods the servo every 4 s. Press the mouse to take over; '
        + 'release to hand it back.').class('hint').parent(select('main'));

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
    background(255);

    if (!haveServo) {
        fill('#6d6a5f'); noStroke(); textSize(14); textAlign(CENTER);
        text('Waiting for the board…', width / 2, 160);
        textAlign(LEFT);
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
