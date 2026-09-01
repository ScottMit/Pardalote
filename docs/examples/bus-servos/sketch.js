// ==============================================================
// Bus servos — pose and read back (a Pardalote tool)
// Works out of the box: connection and servo IDs are set on the page
// (and remembered by this browser) — no code editing needed.
// Two Feetech ST-series bus servos on one UART: drag to command position,
// read live position/load/temperature back, and free a joint to hand-pose it.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Tool settings (browser localStorage) ------------------------------
// The connection (IP / transport) is remembered separately by connect.js;
// this store holds the bus-specific settings — servo IDs and UART pins.
const STORE = 'pardalote-bus-servos-cfg';
const DEFAULTS = {
    ids: [1, 2],       // bus IDs for the two joints (ST series)
    rx: 18, tx: 19,    // ESP32 bus-UART pins (ignored on UNO R4 = D0/D1)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ids = idIns.map(i => int(i.value()));
    // Don't overwrite the saved pins while locked (UNO R4 shows a fixed 1/2).
    // rxIn/txIn are plain DOM inputs (on the connection row), so .value not .value().
    if (!rxTxLocked) { saved.rx = int(rxIn.value); saved.tx = int(txIn.value); }
    localStorage.setItem(STORE, JSON.stringify(saved));
}

// Bus pins from the fields (an invalid/blank field → -1 = board default).
function busPins() {
    const rx = parseInt(rxIn.value, 10), tx = parseInt(txIn.value, 10);
    return { rxPin: Number.isFinite(rx) ? rx : -1, txPin: Number.isFinite(tx) ? tx : -1 };
}

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B',
      RED = '#D22B2B';   // firmware-limit marks (a true red, distinct from amber/orange)

const RING_R = 90;       // dial ring radius (matches the 180px circle)

// Two joints on the bus — the display positions match mouseDragged().
const JOINTS = [
    { name: 'servoA', label: 'servo A', cx: 180, cy: 155 },
    { name: 'servoB', label: 'servo B', cx: 420, cy: 155 },
];

const W = 600, H = 340;

let arduino, ready = false;
let statusEl;
let idIns = [], torqueBtns = [], rxIn, txIn;
let rxTxLocked = false;   // true while the pins are R4-fixed (1/2)

function setup() {
    const main = select('main');
    statusEl = select('#status');

    arduino = new Arduino();
    JOINTS.forEach(j => arduino.add(j.name, new BusServo()));
    const conn = setupConnection(arduino, { store: 'pardalote-bus-servos' });   // Board controls + connection
    addBusFields(conn.row);   // bus UART RX/TX live on the connection row
    arduino.on('ready', onReady);
    arduino.on('disconnect', () => { ready = false; refreshTorqueBtns(); });

    // Servos — the two joint bus IDs. Editing an ID re-points that joint in
    // place (no WiFi reconnect); the bus RX/TX pins sit on the connection row above.
    let r = row(main, 'Servos');
    JOINTS.forEach((j, i) => {
        createSpan(`${j.label} ID`).parent(r);
        idIns[i] = createInput(String(saved.ids[i]), 'number').parent(r);
        idIns[i].style('width', '56px');
        // Re-bind this joint to the new bus id IN PLACE — no WiFi reconnect.
        idIns[i].changed(() => { persist(); if (ready) reattach(i); });
    });

    // Free — free a joint to pose it by hand, re-hold to keep the pose.
    // Button goes green when the joint is free (torque off); text never changes.
    r = row(main, 'Free');
    JOINTS.forEach((j, i) => {
        torqueBtns[i] = createButton(j.label).parent(r).addClass('free-btn')
            .mousePressed(() => toggleTorque(i));
    });

    // --- the display ---
    createCanvas(W, H);
    textFont('Poppins');
    createDiv('Click or drag a dial to command position — amber needle = target, teal = live '
        + 'position, red ticks = the servo’s firmware limits. Free a servo (its green button) to '
        + 'pose it by hand; while free the dial is feedback-only (no target, clicks do nothing).')
        .class('hint').parent(main);

    // Presence: seeded by the attach ping, then kept live from read feedback,
    // so a servo that appears (e.g. driver board powered up after the browser)
    // or disappears mid-session announces itself — in the status and on the
    // dial — instead of changing silently.
    JOINTS.forEach(j => arduino[j.name].onPresence(({ servoId, present }) => {
        setStatus(present ? `${j.label} (id ${servoId}) found`
                          : `${j.label} (id ${servoId}) not found — check wiring / ID / baud`);
    }));
}

// Append the bus UART RX/TX fields to the shared connection row (built by
// connect.js). Editing a field re-opens the bus and re-attaches, live — no
// WiFi reconnect. rxIn/txIn are plain DOM inputs.
function addBusFields(row) {
    const mk = (tag, text) => { const el = document.createElement(tag); if (text != null) el.textContent = text; return el; };
    const busLbl = mk('span', 'bus'); busLbl.style.marginLeft = '8px'; busLbl.style.fontWeight = '700';
    rxIn = mk('input'); rxIn.type = 'number'; rxIn.value = String(saved.rx); rxIn.style.width = '62px';
    txIn = mk('input'); txIn.type = 'number'; txIn.value = String(saved.tx); txIn.style.width = '62px';
    row.append(busLbl, mk('span', 'RX'), rxIn, mk('span', 'TX'), txIn);
    const applyPins = () => { persist(); if (ready) applyBusPins(); };
    rxIn.addEventListener('change', applyPins);
    txIn.addEventListener('change', applyPins);
}

// A UNO R4's bus is fixed to Serial1 (D0/D1): show 1/2 and lock the fields.
function applyR4Pins() {
    const isR4 = String(arduino.board || '').includes('UNO R4');
    rxTxLocked = isR4;
    if (isR4) { rxIn.value = '1'; txIn.value = '2'; }
    else      { rxIn.value = String(saved.rx); txIn.value = String(saved.tx); }
    lockField(rxIn, isR4); lockField(txIn, isR4);
}
function lockField(inp, lock) {
    inp.disabled = lock;
    inp.style.color = lock ? '#a49f92' : '';
    inp.style.background = lock ? '#efece4' : '';
    inp.style.cursor = lock ? 'not-allowed' : '';
}

function onReady() {
    applyR4Pins();   // lock pins for a UNO R4 before reading them
    // Set the bus UART pins BEFORE attaching. Global (one call sets the whole
    // bus); ignored on the UNO R4 (fixed Serial1 = D0/D1), used on ESP32.
    arduino.servoA.configureBus(busPins());
    JOINTS.forEach((j, i) => bindJoint(i));
    ready = true;
    setStatus(`ready — IDs ${saved.ids.join(', ')}`);
    refreshTorqueBtns();
}

// RX/TX field changed while connected: re-open the bus on the new pins, then
// re-attach every joint so they re-ping over it. No WiFi reconnect.
function applyBusPins() {
    arduino.servoA.configureBus(busPins());
    JOINTS.forEach((j, i) => reattach(i));
}

// Bind one joint to its configured bus id: attach, start free, poll feedback.
// Start FREE — the servo shouldn't seek anything; it sits limp until activated.
// (No soft limits either: we want to reach the servo's OWN firmware limits —
// they arrive at attach as s.firmwareLimits and show as red marks.)
function bindJoint(i) {
    const s = arduino[JOINTS[i].name];
    s.attach(saved.ids[i], 'ST');
    s.disableTorque();             // also clears s.hasTarget — nothing to seek
    s.read(120);                   // poll live feedback
}

// Re-point one joint to a new bus id WITHOUT a WiFi reconnect: release the old
// servo, then bind the new one (attach re-reads the new servo's firmware limits).
function reattach(i) {
    arduino[JOINTS[i].name].detach();   // release the previous bus id
    bindJoint(i);
    setStatus(`ready — IDs ${saved.ids.join(', ')}`);
    refreshTorqueBtns();
}

function toggleTorque(i) {
    if (!ready) return;
    const s = arduino[JOINTS[i].name];
    if (s.torqueOn) s.disableTorque();   // limp — the library forgets the target
    else            s.enableTorque();    // re-hold at current position (no target until commanded)
    refreshTorqueBtns();
}

// The button reflects STATE by colour (clicking toggles it): green when the
// servo is free (torque off, limp, hand-posable), plain when it's active
// (powered/holding). The text stays the joint's name in every state.
function refreshTorqueBtns() {
    JOINTS.forEach((j, i) => {
        const s = arduino[j.name];
        if (ready && !s.torqueOn) torqueBtns[i].addClass('freed');
        else                      torqueBtns[i].removeClass('freed');
    });
}

function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }

function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}

// -------------------------------------------------------------------
// Display — one dial per joint. Drag to command position.
// House palette: hairline ring (orange when the joint is free), TEAL needle
// = current (live feedback), AMBER needle = target (where you're commanding).
// RED ticks = the servo's own firmware angle limits (s.firmwareLimits).
// Drag past a red mark and you'll see amber (target) cross it while teal
// (current) stalls at the limit — that's the wall we're probing.
// -------------------------------------------------------------------
function draw() {
    background(255);
    // dials are always drawn — greyed out until the board connects
    JOINTS.forEach(j => drawJoint(arduino[j.name], j));
}

// Screen angle for a servo position (counts), matching mouseDragged()'s map.
function posAngle(s, pos) { return map(pos, 0, s.resolution, -PI, PI) - HALF_PI; }

function drawJoint(s, j) {
    const { label, cx, cy } = j;
    const showTarget = ready && s.torqueOn && s.hasTarget;
    push();
    translate(cx, cy);

    // ring encodes state (matches the torque button): RED = powered/active,
    // INK (black) = free/limp, hairline = offline.
    noFill();
    stroke(ready ? (s.torqueOn ? RED : INK) : HAIR);
    strokeWeight(2);
    circle(0, 0, RING_R * 2);

    // firmware-limit marks — red ticks JUST OUTSIDE the ring (so they stay
    // visible whatever colour the ring is), only when the servo reported real,
    // enabled limits (min==max==0 means "off", so no marks).
    const fw = s.firmwareLimits;
    if (ready && fw && fw.enabled) {
        stroke(RED);
        strokeWeight(3);
        [fw.min, fw.max].forEach(p => {
            const a = posAngle(s, p);
            line(cos(a) * (RING_R + 1), sin(a) * (RING_R + 1),
                 cos(a) * (RING_R + 13), sin(a) * (RING_R + 13));
        });
    }

    // target needle (amber) — where you're commanding. Only when the joint is
    // active AND has a live commanded target: freeing forgets it, so it never
    // reappears on re-hold until you command a new position.
    if (showTarget) {
        const at = posAngle(s, s.target);
        stroke(AMBER); strokeWeight(3);
        line(0, 0, cos(at) * 84, sin(at) * 84);
    }

    // current needle (teal) — live servo feedback, the arm "left behind"
    const cur = ready ? s.position : s.resolution / 2;
    const ac = posAngle(s, cur);
    stroke(ready ? TEAL : HAIR); strokeWeight(5);
    line(0, 0, cos(ac) * 76, sin(ac) * 76);

    fill(ready ? INK : GREY); noStroke();
    circle(0, 0, 10);

    textAlign(CENTER);
    fill(INK); textSize(14);
    text(label + (ready && !s.torqueOn ? '  (free)' : ''), 0, 118);
    textSize(12);
    if (ready && s.present === false) {
        fill(RED);
        text('not found', 0, 138);
        text('check wiring / ID / baud', 0, 156);
    } else if (ready) {
        fill(GREY);
        const info = !s.torqueOn ? 'feedback only'
                   : showTarget  ? 'target ' + s.target
                   : 'holding';
        text(`pos ${s.position}   ${info}`, 0, 138);
        text(`load ${s.load}   ${s.voltage.toFixed(1)}V   ${s.temperature}°C`, 0, 156);
        fill(fw ? (fw.enabled ? RED : GREY) : GREY);
        text(fw ? (fw.enabled ? `fw limits ${fw.min}–${fw.max}` : 'fw limits: off')
                : 'fw limits: —', 0, 174);
    } else {
        fill(GREY);
        text('pos —   target —', 0, 138);
        text('waiting for connection', 0, 156);
    }
    textAlign(LEFT);
    pop();
}

// Command a joint's target from the mouse — a click anywhere on its dial, or a
// drag. Only when the joint is under active control (torque on): in free mode
// the dial is feedback-only, so clicks/drags do NOTHING and the servo stays
// limp for hand-posing (we never send a write, so it can't re-engage torque).
function commandFromMouse() {
    if (!ready) return;
    JOINTS.forEach(j => {
        const s = arduino[j.name];
        if (!s.torqueOn) return;                          // free — control inactive
        if (dist(mouseX, mouseY, j.cx, j.cy) < RING_R + 5) {
            const a = atan2(mouseY - j.cy, mouseX - j.cx) + HALF_PI;
            // p5's map() extrapolates (no clamp): atan2()+HALF_PI runs to 3π/2,
            // so the lower-left arc overshoots past `resolution` (up to ~1.25×,
            // e.g. 5120 on ST) — which the servo then wraps mod-4096 and swings
            // the wrong way. Wrap the counts into [0, resolution) so one full
            // turn maps exactly once. (Inverse of posAngle(); seam at 6 o'clock.)
            let counts = map(a, -PI, PI, 0, s.resolution);
            counts = ((Math.round(counts) % s.resolution) + s.resolution) % s.resolution;
            s.write(counts, { speed: 3000 });            // write() sets s.hasTarget
        }
    });
}

function mousePressed() { commandFromMouse(); }
function mouseDragged() { commandFromMouse(); }
