// ==============================================================
// Coordinated Motion Example
// Two motors sweep in unison using a Pardalote group. Each motor's type
// (PWM servo / serial bus servo / stepper) is chosen independently from the
// popup under its dial — so the group can be heterogeneous, and every member
// still arrives together on each leg of the sweep.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.186';   // Change this to your Arduino's IP

// Per-type config. low/high are the sweep endpoints in each motor's own units;
// fullRange + span drive the dial (servo = 180° gauge, bus/stepper = 360° dial).
// pinsA / pinsB are the pins (or bus IDs) for motor A and B — edit to match wiring.
const TYPES = {
    servo:    { label: 'Servo (PWM)',    low: 15,  high: 165,  fullRange: 180,  span: 180, pinsA: [5],    pinsB: [6]    },
    busservo: { label: 'Bus Servo (ST)', low: 200, high: 3900, fullRange: 4096, span: 360, pinsA: [1],    pinsB: [2]    },
    stepper:  { label: 'Stepper',        low: 0,   high: 3200, fullRange: 3200, span: 360, pinsA: [2, 3], pinsB: [8, 9] },
};
const CTOR = { servo: Servo, busservo: BusServo, stepper: Stepper };

const W = 680, H = 400, cxA = 180, cxB = 500, cy = 175;

let arduino, group, motorA, motorB;
let typeA = 'servo', typeB = 'servo';

let selectA, selectB, toggleButton, durSlider, durValEl, statusEl;
let running = false, ready = false;
let status = 'starting…';
let loopToken = 0;
let legDur = 1500;

// Display interpolation (per motor) so the dials animate smoothly, with or
// without hardware. legStart/legDur are shared → the two dials stay in unison.
let dispA = 0, fromA = 0, toA = 0;
let dispB = 0, fromB = 0, toB = 0;
let legStart = 0;

const wait = ms => new Promise(r => setTimeout(r, ms));
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function setup() {
    const main = select('main');

    // --- top: heading, connection status, transport controls ---
    const topBar = createDiv().id('top').parent(main);
    createDiv('Coordinated Motion — two motors in unison').class('heading').parent(topBar);
    statusEl = createDiv('').id('status').parent(topBar);
    const ctrlRow = createDiv().class('row').parent(topBar);
    toggleButton = createButton('Pause').parent(ctrlRow);
    toggleButton.mousePressed(toggleRun);
    createSpan('Duration').parent(ctrlRow);
    durSlider = createSlider(400, 3000, 1500, 100).parent(ctrlRow);
    durValEl = createSpan('1500 ms').parent(ctrlRow);
    durSlider.input(() => durValEl.html(durSlider.value() + ' ms'));

    createCanvas(W, H).parent(main);

    // --- motor-type popups, one under each dial ---
    const selrow = createDiv().id('motorSelects').parent(main);
    selectA = makeMotorSelect(selrow, cxA);
    selectB = makeMotorSelect(selrow, cxB);
    selectB.elt.value = 'stepper';   // default to a mixed pair, to show both dial styles

    buildRig();
}

function makeMotorSelect(parent, cx) {
    const cell = createDiv().class('mcell').parent(parent).style('left', cx + 'px');
    const sel = createSelect().parent(cell);
    for (const key in TYPES) sel.option(TYPES[key].label, key);
    sel.changed(buildRig);
    return sel;
}

// -------------------------------------------------------------------
// Build (or rebuild) the group from the two selected motor types.
// -------------------------------------------------------------------
function buildRig() {
    if (arduino) arduino.disconnect();
    loopToken++;
    typeA = selectA.value();
    typeB = selectB.value();
    ready = false;
    setStatus('connecting…');

    arduino = new Arduino();
    motorA = new (CTOR[typeA])();
    motorB = new (CTOR[typeB])();
    arduino.add('a', motorA);
    arduino.add('b', motorB);
    group = arduino.group('pair', { a: motorA, b: motorB });

    arduino.on('ready', onReady);
    arduino.on('disconnect', () => { ready = false; setStatus('reconnecting…'); });

    dispA = fromA = toA = TYPES[typeA].low;
    dispB = fromB = toB = TYPES[typeB].low;
    legStart = millis();

    running = true;
    toggleButton.html('Pause');
    arduino.connect(ArduinoIP);
    sweepLoop(loopToken);
}

function onReady() {
    attachOne(motorA, typeA, TYPES[typeA].pinsA);
    attachOne(motorB, typeB, TYPES[typeB].pinsB);
    // Snap to the low pose so writeTimed() measures distance from a known start.
    group.write({ a: TYPES[typeA].low, b: TYPES[typeB].low });
    ready = true;
    setStatus(`sweeping — A: ${TYPES[typeA].label}, B: ${TYPES[typeB].label}`);
}

function attachOne(motor, type, pins) {
    if (type === 'servo') {
        motor.attach(...pins);
    } else if (type === 'busservo') {
        motor.attach(pins[0], 'ST');
        motor.read(80);
    } else if (type === 'stepper') {
        motor.attach(...pins);
        motor.setMaxSpeed(3000);
        motor.setAcceleration(2000);
        motor.setPosition(0);
        motor.read(80);
    }
}

// -------------------------------------------------------------------
// The sweep: ping-pong both motors between their low and high poses.
// One group.writeTimed().whenDone() per leg → they arrive together.
// -------------------------------------------------------------------
async function sweepLoop(token) {
    let goHigh = true;
    while (running && token === loopToken) {
        const cA = TYPES[typeA], cB = TYPES[typeB];
        const targetA = goHigh ? cA.high : cA.low;
        const targetB = goHigh ? cB.high : cB.low;
        legDur = durSlider.value();
        startDisplayLeg(targetA, targetB);

        const leg = ready
            ? group.writeTimed({ a: targetA, b: targetB }, legDur).whenDone()
            : wait(legDur);
        await leg;

        goHigh = !goHigh;
    }
}

function startDisplayLeg(targetA, targetB) {
    fromA = dispA; toA = targetA;
    fromB = dispB; toB = targetB;
    legStart = millis();
}

function toggleRun() {
    running = !running;
    toggleButton.html(running ? 'Pause' : 'Resume');
    if (running) sweepLoop(++loopToken);
}

function setStatus(s) {
    status = s;
    if (statusEl) statusEl.html('status: ' + s);
}

// -------------------------------------------------------------------
// Visualisation — a dial per motor. Servo = 180° gauge, bus/stepper = 360°.
// -------------------------------------------------------------------
function draw() {
    background(28);

    const t = legDur > 0 ? constrain((millis() - legStart) / legDur, 0, 1) : 1;
    const e = easeInOut(t);
    dispA = lerp(fromA, toA, e);
    dispB = lerp(fromB, toB, e);

    drawDial(cxA, cy, 'Motor A', motorA, TYPES[typeA], dispA);
    drawDial(cxB, cy, 'Motor B', motorB, TYPES[typeB], dispB);
}

function drawDial(cx, cy, label, motor, cfg, val) {
    const R = 95, D = 220;
    const frac = constrain(val / cfg.fullRange, 0, 1);

    push();
    translate(cx, cy);

    // gauge: 180° top arc for servos, full ring for 360° motors
    noFill();
    stroke(70);
    strokeWeight(2);
    let a;
    if (cfg.span === 180) {
        arc(0, 0, D, D, PI, TWO_PI);          // top semicircle
        a = map(frac, 0, 1, PI, TWO_PI);      // 0 → left, ½ → up, 1 → right
    } else {
        circle(0, 0, D);                      // full circle
        a = -HALF_PI + frac * TWO_PI;         // 0 → up, then clockwise
    }

    stroke(120, 200, 255);
    strokeWeight(6);
    line(0, 0, cos(a) * R, sin(a) * R);

    fill(255); noStroke();
    circle(0, 0, 12);

    textAlign(CENTER);
    fill(255); textSize(15);
    text(label, 0, D / 2 + 30);
    fill(150); textSize(12);
    text(`${cfg.label} · ${cfg.span}°`, 0, D / 2 + 50);
    text(`commanded ${Math.round(val)}`, 0, D / 2 + 68);
    text(`feedback ${Math.round((motor && motor.memberValue) || 0)}`, 0, D / 2 + 86);
    textAlign(LEFT);
    pop();
}
