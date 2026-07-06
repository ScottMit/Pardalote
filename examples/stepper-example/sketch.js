// ==============================================================
// Stepper Control Example
// Shows position moves, continuous rotation, live position readout,
// and the 'done' completion event with Pardalote.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.186';   // Change this to your Arduino's IP

// STEP/DIR driver pins (TMC2208/2209, A4988, EasyDriver).
let STEP_PIN = 2;
let DIR_PIN  = 3;
let EN_PIN   = 4;               // optional; set to -1 if unused

let arduino;
let ready = false;
let status = 'connecting…';

function setup() {
    createCanvas(600, 400);

    arduino = new Arduino();
    arduino.add('x', new Stepper());
    arduino.connect(ArduinoIP);

    // Do all hardware setup inside 'ready' — this also re-runs after a
    // reconnect if the Arduino reset, so the stepper is always configured.
    arduino.on('ready', () => {
        arduino.x.attach(STEP_PIN, DIR_PIN, EN_PIN);
        arduino.x.setMaxSpeed(1200);        // steps/sec
        arduino.x.setAcceleration(600);     // steps/sec^2
        arduino.x.setStepsPerRev(200 * 16); // 1.8° motor at 16 microsteps
        arduino.x.setLimits(-6400, 6400);   // safety: ±2 revolutions
        arduino.x.setPosition(0);           // call this position "home"

        arduino.x.read(100);                // poll live position every 100 ms
        ready = true;
        status = 'ready';
    });

    arduino.on('disconnect', () => { ready = false; status = 'reconnecting…'; });

    arduino.x.on('done', ({ position }) => console.log('arrived at', position));
}

function draw() {
    background(30);

    fill(255);
    textSize(16);
    text('Stepper Control Example', 20, 30);
    text(`status: ${status}`, 20, 55);

    textSize(14);
    text("[←] / [→]  jog 1/4 turn      [Space]  stop", 20, 90);
    text("[R]  spin continuously        [H]  return home (0)", 20, 112);

    if (ready) drawDial();
}

function drawDial() {
    const stepsPerRev = arduino.x.stepsPerRev;
    const angle = (arduino.x.position / stepsPerRev) * TWO_PI;

    push();
    translate(width / 2, 2 * height / 3);

    noFill();
    stroke(90);
    strokeWeight(2);
    circle(0, 0, 200);

    stroke(120, 200, 255);
    strokeWeight(5);
    line(0, 0, cos(angle - HALF_PI) * 95, sin(angle - HALF_PI) * 95);

    fill(255);
    noStroke();
    circle(0, 0, 10);

    textAlign(CENTER);
    textSize(14);
    text(`position: ${arduino.x.position} steps`, 0, 135);
    text(`${(arduino.x.position / stepsPerRev).toFixed(2)} rev` +
         (arduino.x.isRunning ? '   (moving)' : ''), 0, 155);
    pop();
}

function keyPressed() {
    if (!ready) return;

    if (keyCode === LEFT_ARROW)  arduino.x.move(-arduino.x.stepsPerRev / 4);
    if (keyCode === RIGHT_ARROW) arduino.x.move( arduino.x.stepsPerRev / 4);

    if (key === ' ')             arduino.x.stop();
    if (key === 'r' || key === 'R') arduino.x.runSpeed(600);   // continuous
    if (key === 'h' || key === 'H') arduino.x.moveTo(0);       // home
}
