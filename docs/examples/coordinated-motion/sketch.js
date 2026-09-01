// ==============================================================
// Coordinated motion — two motors in unison (a Pardalote tool)
// Works out of the box: connection, motor types and pins are set on
// the page (and remembered by this browser) — no code editing needed.
// Two motors sweep in unison using a Pardalote group. Each motor's type
// (PWM servo / serial bus servo / stepper) is chosen independently from the
// popup under its dial — so the group can be heterogeneous, and every member
// still arrives together on each leg of the sweep.
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Autofill-warning hygiene --------------------------------------------
// p5's createInput()/createSelect() make form fields with no name/id, which the
// browser flags as an autofill risk. Give every such field a harmless unique
// name, now and as new ones appear (covers connect.js's fields too).
(function nameFormFields() {
    let n = 0;
    const fix = (el) => {
        if (!el || el.nodeType !== 1 || el.name || el.id) return;
        const t = el.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') el.name = 'pf-' + (++n);
    };
    const sweep = () => document.querySelectorAll('input, select, textarea').forEach(fix);
    sweep();
    requestAnimationFrame(sweep);
    new MutationObserver((muts) => {
        for (const m of muts) m.addedNodes.forEach((node) => {
            fix(node);
            if (node.querySelectorAll) node.querySelectorAll('input, select, textarea').forEach(fix);
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
})();

// Per-type config. low/high are the sweep endpoints in each motor's own units;
// fullRange + span drive the dial (servo = 180° gauge, bus/stepper = 360° dial).
const TYPES = {
    servo:    { label: 'Servo (PWM)',      low: 15,  high: 165,  fullRange: 180,  span: 180, pinLabels: ['pin'] },
    busservo: { label: 'Bus Servo (ST)',   low: 200, high: 3900, fullRange: 4096, span: 360, pinLabels: ['ID'] },
    // Steppers sweep exactly one rotation: high/fullRange are overridden at
    // runtime by the per-motor steps/rev field (see dialCfg + sweepLoop).
    stepper:  { label: 'Stepper (driver)', low: 0,   high: 3200, fullRange: 3200, span: 360, pinLabels: ['STEP', 'DIR'] },
    // 4-wire = 4 coil pins (28BYJ-48 via ULN2003 etc.)
    stepper4: { label: 'Stepper (4-wire)', low: 0,   high: 2048, fullRange: 2048, span: 360, pinLabels: ['IN1', 'IN2', 'IN3', 'IN4'] },
};
const CTOR = { servo: Servo, busservo: BusServo, stepper: Stepper, stepper4: Stepper };

// --- Saved settings (browser localStorage) -----------------------------
// The connection (IP / transport) is remembered separately by connect.js;
// this store holds the motor types + pins chosen on the page.
const STORE = 'pardalote-coordinated-motion';
const DEFAULTS = {
    typeA: 'servo', typeB: 'stepper',      // a mixed pair, to show both dial styles
    pins: {                                 // per type, per motor — edited on the page
        servo:    { a: [5],    b: [6]    },
        busservo: { a: [1],    b: [2]    },
        stepper:  { a: [2, 3], b: [8, 9] },
        stepper4: { a: [8, 9, 10, 11], b: [4, 5, 6, 7] },
    },
    rev: {                                  // steps/rev — shown for stepper types;
        stepper:  { a: 3200, b: 3200 },     // sets the dial scale (one turn) and
        stepper4: { a: 2048, b: 2048 },     // the motor's stepsPerRev record
    },
};
const saved = (() => {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { ...DEFAULTS, ...s,
             pins: { ...DEFAULTS.pins, ...(s.pins || {}) },
             rev:  { ...DEFAULTS.rev,  ...(s.rev  || {}) } };
})();
function persist() { localStorage.setItem(STORE, JSON.stringify(saved)); }

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B';

const W = 680, H = 400, cxA = 180, cxB = 500, cy = 175;

let arduino, group, motorA, motorB;
let typeA = saved.typeA, typeB = saved.typeB;
let lastTypeA = null, lastTypeB = null;   // track which class each motor slot holds

let selectA, selectB, pinsA = [], pinsB = [], revA = null, revB = null, cellA, cellB;
let toggleButton, durSlider, durValEl, statusEl;
let running = false, ready = false;
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
    statusEl = select('#status');

    // One Arduino for the life of the page. The connection is owned by
    // connect.js; the motors below are rebuilt in place when their type changes.
    arduino = new Arduino();
    motorA = new (CTOR[typeA])(); arduino.add('a', motorA); lastTypeA = typeA;
    motorB = new (CTOR[typeB])(); arduino.add('b', motorB); lastTypeB = typeB;
    group  = arduino.group('pair', { a: motorA, b: motorB });

    setupConnection(arduino, { store: 'pardalote-coordinated-motion-conn' });   // Board controls + connection
    // Registered AFTER connect.js so our richer status line wins on 'ready'.
    arduino.on('ready', onReady);
    arduino.on('disconnect', () => { ready = false; });

    // Sweep controls (appended just under the connection row)
    let r = createDiv().class('row').parent(main);
    createSpan('Sweep').class('lbl').parent(r);
    toggleButton = createButton('Pause').parent(r);
    toggleButton.style('min-width', '96px');   // fits "Resume" — stops the row reflowing
    toggleButton.mousePressed(toggleRun);
    createSpan('Duration').parent(r);
    durSlider = createSlider(400, 3000, 1500, 100).parent(r);
    durValEl = createSpan('1500 ms').parent(r);
    durSlider.input(() => durValEl.html(durSlider.value() + ' ms'));

    createCanvas(W, H).parent(main);
    textFont('Poppins');

    // --- motor cells (type popup + pin fields), one under each dial ---
    const selrow = createDiv().id('motorSelects').parent(main);
    [selectA, cellA] = makeMotorCell(selrow, cxA, typeA);
    [selectB, cellB] = makeMotorCell(selrow, cxB, typeB);
    refreshPins();

    // Start the display sweep — it previews with or without a connection.
    dispA = fromA = toA = TYPES[typeA].low;
    dispB = fromB = toB = TYPES[typeB].low;
    legStart = millis();
    running = true;
    sweepLoop(loopToken);
}

function makeMotorCell(parent, cx, type) {
    const cell = createDiv().class('mcell').parent(parent).style('left', cx + 'px');
    const sel = createSelect().parent(cell);
    for (const key in TYPES) sel.option(TYPES[key].label, key);
    sel.selected(type);
    sel.changed(rebuildGroup);
    createDiv().class('pins').parent(cell);
    return [sel, cell];
}

// Populate the pin fields under each dial for the currently selected types.
function refreshPins() {
    [pinsA, revA] = fillPinCell(cellA, selectA.value(), 'a');
    [pinsB, revB] = fillPinCell(cellB, selectB.value(), 'b');
}
function fillPinCell(cell, type, motor) {
    const box = cell.elt.querySelector('.pins');
    box.innerHTML = '';
    const inputs = [];
    const labels = TYPES[type].pinLabels;
    labels.forEach((lbl, i) => {
        // four pin fields (4-wire) sit on two fixed lines: IN1 IN2 / IN3 IN4
        if (labels.length === 4 && i === 2) {
            const brk = document.createElement('span');
            brk.className = 'brk';
            box.appendChild(brk);
        }
        const span = document.createElement('span');
        span.textContent = lbl;
        box.appendChild(span);
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.value = saved.pins[type][motor][i];
        inp.addEventListener('change', rebuildGroup);
        box.appendChild(inp);
        inputs.push(inp);
    });
    // profile line, under the pins — steppers only: steps per rotation
    let revInp = null;
    if (isStepper(type)) {
        const brk = document.createElement('span');
        brk.className = 'brk';
        box.appendChild(brk);
        const span = document.createElement('span');
        span.textContent = 'steps/rev';
        box.appendChild(span);
        revInp = document.createElement('input');
        revInp.type = 'number';
        revInp.style.width = '72px';         // 4+ digit values, untruncated
        revInp.value = saved.rev[type][motor];
        revInp.addEventListener('change', rebuildGroup);
        box.appendChild(revInp);
    }
    return [inputs, revInp];
}

function isStepper(type) { return type === 'stepper' || type === 'stepper4'; }

// Snapshot the on-page pin/profile edits into `saved` for the types shown.
function snapshotPins() {
    saved.pins[typeA].a = pinsA.map(i => int(i.value));
    saved.pins[typeB].b = pinsB.map(i => int(i.value));
    if (revA) saved.rev[typeA].a = int(revA.value);
    if (revB) saved.rev[typeB].b = int(revB.value);
}

// -------------------------------------------------------------------
// Rebuild the group from the selected motor types + pins, on the SAME
// Arduino (connect.js owns the connection). A new motor instance is made
// only when its type actually changes; a pin edit just re-attaches.
// -------------------------------------------------------------------
function rebuildGroup() {
    snapshotPins();
    typeA = selectA.value();
    typeB = selectB.value();
    refreshPins();
    saved.typeA = typeA; saved.typeB = typeB;
    persist();

    if (typeA !== lastTypeA) { motorA = new (CTOR[typeA])(); arduino.add('a', motorA); lastTypeA = typeA; }
    if (typeB !== lastTypeB) { motorB = new (CTOR[typeB])(); arduino.add('b', motorB); lastTypeB = typeB; }
    group = arduino.group('pair', { a: motorA, b: motorB });

    dispA = fromA = toA = TYPES[typeA].low;
    dispB = fromB = toB = TYPES[typeB].low;
    legStart = millis();

    if (ready) configureMotors();   // live re-attach on the current connection
    running = true;
    toggleButton.html('Pause');
    sweepLoop(++loopToken);
}

// Attach + profile both motors for the current types/pins, then snap to the
// low pose so writeTimed() measures distance from a known start. Called on
// every (re)connect and whenever the group is rebuilt while connected.
function configureMotors() {
    attachOne(motorA, typeA, saved.pins[typeA].a, isStepper(typeA) ? saved.rev[typeA].a : 0);
    attachOne(motorB, typeB, saved.pins[typeB].b, isStepper(typeB) ? saved.rev[typeB].b : 0);
    group.write({ a: TYPES[typeA].low, b: TYPES[typeB].low });
}

function onReady() {
    ready = true;
    configureMotors();
    setStatus(`sweeping — A: ${TYPES[typeA].label}, B: ${TYPES[typeB].label}`);
}

function attachOne(motor, type, pins, rev) {
    if (type === 'servo') {
        motor.attach(...pins);
    } else if (type === 'busservo') {
        motor.attach(pins[0], 'ST');
        motor.read(80);
    } else if (type === 'stepper') {
        motor.attach(...pins);
        motor.setMaxSpeed(3000);
        motor.setAcceleration(2000);
        motor.setStepsPerRev(rev);
        motor.setPosition(0);
        motor.read(80);
    } else if (type === 'stepper4') {
        motor.attach4wire(...pins);
        motor.setMaxSpeed(600);              // 4-wire motors top out low
        motor.setAcceleration(800);
        motor.setStepsPerRev(rev);
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
        // steppers sweep exactly one rotation: 0 → steps/rev
        const highA = isStepper(typeA) ? saved.rev[typeA].a : cA.high;
        const highB = isStepper(typeB) ? saved.rev[typeB].b : cB.high;
        const targetA = goHigh ? highA : cA.low;
        const targetB = goHigh ? highB : cB.low;
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
    if (statusEl) statusEl.html('status: ' + s);
}

// -------------------------------------------------------------------
// Visualisation — a dial per motor. Servo = 180° gauge, bus/stepper = 360°.
// House palette: ink text, hairline ring, teal needle.
// -------------------------------------------------------------------
function draw() {
    background(255);

    const t = legDur > 0 ? constrain((millis() - legStart) / legDur, 0, 1) : 1;
    const e = easeInOut(t);
    dispA = lerp(fromA, toA, e);
    dispB = lerp(fromB, toB, e);

    drawDial(cxA, cy, 'Motor A', motorA, dialCfg(typeA, 'a'), dispA);
    drawDial(cxB, cy, 'Motor B', motorB, dialCfg(typeB, 'b'), dispB);
}

// For steppers the dial scale is the steps/rev field (one turn of the ring);
// other types use their fixed fullRange.
function dialCfg(type, motor) {
    const c = TYPES[type];
    return isStepper(type) ? { ...c, fullRange: saved.rev[type][motor] } : c;
}

function drawDial(cx, cy, label, motor, cfg, val) {
    const R = 95, D = 220;
    // 360° dials wrap (multiple turns read true); 180° gauges clamp
    const frac = cfg.span === 180 ? constrain(val / cfg.fullRange, 0, 1)
                                  : val / cfg.fullRange;

    push();
    translate(cx, cy);

    // gauge: 180° top arc for servos, full ring for 360° motors
    noFill();
    stroke(HAIR);
    strokeWeight(2);
    let a;
    if (cfg.span === 180) {
        arc(0, 0, D, D, PI, TWO_PI);          // top semicircle
        a = map(frac, 0, 1, PI, TWO_PI);      // 0 → left, ½ → up, 1 → right
    } else {
        circle(0, 0, D);                      // full circle
        a = -HALF_PI + frac * TWO_PI;         // 0 → up, then clockwise
    }

    stroke(TEAL);
    strokeWeight(5);
    line(0, 0, cos(a) * R, sin(a) * R);

    fill(INK); noStroke();
    circle(0, 0, 12);

    textAlign(CENTER);
    fill(INK); textSize(15);
    text(label, 0, D / 2 + 30);
    fill(GREY); textSize(12);
    text(`${cfg.label} · ${cfg.span}°`, 0, D / 2 + 50);
    text(`commanded ${Math.round(val)}`, 0, D / 2 + 68);
    text(`feedback ${Math.round((motor && motor.memberValue) || 0)}`, 0, D / 2 + 86);
    textAlign(LEFT);
    pop();
}
