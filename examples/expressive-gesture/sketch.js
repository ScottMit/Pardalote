// ==============================================================
// Expressive gesture — authored motion on a pan/tilt "head"
//
// A tool for gesture(): each button plays an authored SEGMENT SCHEDULE on two
// PWM servos (pan + tilt), and shows the code that produced it. The head
// preview is driven by the library's own easing math (curveShape), so the
// motion you see matches what the board plays — with or without hardware
// connected. Works out of the box: set the board IP on the page (remembered
// by this browser) — no code editing needed.
//
// Key API on show:
//   • arduino.group('head', { pan, tilt })   — coordinate two servos
//   • head.gesture({ pan:[…], tilt:[…] })     — eased segments, per-lane lanes
//   • whenDone()                              — await the whole gesture
//
// Gestures are RELATIVE (each segment is a `by` delta): the board captures
// each servo's angle as it goes, so nothing needs homing, and uneven lanes
// are padded so both servos arrive together.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell — GPL-3.0
// ==============================================================

// --- The gestures. Data, so the same definition drives the hardware, the
//     on-screen code, and the preview. Each lane is an array of segments;
//     omit a lane a gesture doesn't move. -------------------------------
const GESTURES = {
    'Nod · yes': {
        tilt: [
            { by:  16, dur: 180, curve: 'easeOut'   },
            { by: -16, dur: 300, curve: 'easeInOut' },
            { by:   7, dur: 160, curve: 'easeOut'   },
            { by:  -7, dur: 240, curve: 'easeInOut' },
        ],
    },
    'Shake · no': {
        pan: [
            { by: -20, dur: 160, curve: 'easeOut'   },
            { by:  40, dur: 260, curve: 'easeInOut' },
            { by: -40, dur: 260, curve: 'easeInOut' },
            { by:  20, dur: 200, curve: 'easeInOut' },
        ],
    },
    'Curious': {                       // overlapping lanes → a quizzical head-cock
        pan:  [{ by: 22, dur: 300, curve: 'easeOut'   }],
        tilt: [{ by: -14, dur: 220, curve: 'back'      },   // the cock overshoots
               { by:   4, dur: 300, curve: 'easeInOut' }],
    },
    'Startle': {                       // fast recoil, slow settle
        pan:  [{ by:  -8, dur:  90, curve: 'easeOut'   },
               { by:   8, dur: 520, curve: 'easeInOut' }],
        tilt: [{ by:  18, dur:  90, curve: 'easeOut'   },
               { by: -24, dur: 150, curve: 'easeOut'   },
               { by:   6, dur: 420, curve: 'back'      }],
    },
    'Look away': {                     // ends off-centre (use Center to return)
        pan:  [{ by: 34, dur: 520, curve: 'easeInOut' }],
        tilt: [{ by: -8, dur: 260, curve: 'easeOut'   },
               { by:  8, dur: 500, curve: 'easeInOut' }],
    },
};

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2', PAPER = '#FFFFFF',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B';
const W = 520, H = 300, cx = W / 2, cy = 170;

const STORE = 'pardalote-expressive-gesture';
const DEFAULTS = {
    ip: '192.168.x.x',
    panPin: 9, tiltPin: 10,
    transport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

let arduino, head, ready = false, manualDisconnect = false;
let statusEl, codeEl, logEl, ipIn, panIn, tiltIn,
    transportSelect, connectLbl, connectBtn, disconnectBtn;
let logLines = [];

// Resting pose (servo degrees) the next gesture starts from — mirrors the
// board, which captures the live angle. Gestures move relative to this.
let pose = { pan: 90, tilt: 90 };
// Active preview: per-lane samplers + start time.
let play = null;          // { pan, tilt, total, start } or null
let panDisp = 90, tiltDisp = 90;
let flashUntil = 0;       // brief ring when whenDone() settles

function setup() {
    const main = select('main');

    // Heading + status live in index.html (#top); the sketch just drives status.
    statusEl = select('#status');

    // Board — WiFi (IP) or USB (Web Serial), connect/disconnect
    let r = row(main, 'Board IP');
    connectLbl = r.elt.querySelector('.lbl');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi'); transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipIn = createInput(saved.ip, 'text').parent(r);
    ipIn.style('width', '130px');
    connectBtn = createButton('Connect').parent(r).mousePressed(doConnect);
    connectBtn.addClass('primary');
    disconnectBtn = createButton('Disconnect').parent(r).mousePressed(doDisconnect);
    applyTransport();

    // The gestures — one button each, plus a recentre.
    r = row(main, 'Gestures');
    for (const name of Object.keys(GESTURES))
        createButton(name).parent(r).mousePressed(() => playGesture(name));
    createButton('Center').parent(r).mousePressed(recentre);

    createCanvas(W, H).parent(main);
    textFont('Poppins');

    // The code of the last-played gesture — the point of the example.
    createDiv('The code that produced it').class('lbl').parent(main).style('margin', '2px 0 4px');
    codeEl = createElement('pre', '// pick a gesture above').class('codecard').parent(main);

    // Wiring, under the display (house rule).
    r = row(main, 'Wiring');
    createSpan('pan pin').parent(r);
    panIn = createInput(String(saved.panPin), 'number').parent(r);
    panIn.style('width', '56px').changed(reattach);
    createSpan('tilt pin').parent(r);
    tiltIn = createInput(String(saved.tiltPin), 'number').parent(r);
    tiltIn.style('width', '56px').changed(reattach);

    logEl = createDiv('').id('log').parent(main);

    arduino = new Arduino();
    arduino.add('pan',  new Servo());
    arduino.add('tilt', new Servo());
    arduino.on('ready', () => { setConnected(true); onReady(); });
    arduino.on('disconnect', () => {
        ready = false;
        setConnected(false);
        if (!manualDisconnect) setStatus('reconnecting…');
    });
    arduino.on('warn', ({ message }) => log('⚠ ' + message));

    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect — the preview works either way");
}

function persist() {
    saved.ip = ipIn.value().trim();
    saved.panPin = int(panIn.value());
    saved.tiltPin = int(tiltIn.value());
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}

async function doConnect() {
    persist();
    manualDisconnect = false; ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipIn.value().trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip);        // (re)connect — attach happens on 'ready'
    setStatus('connecting…');
}

function doDisconnect() {
    manualDisconnect = true;
    ready = false;
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();       // the 'disconnect' event restores the button when done
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — the preview still works');
}

// --- Connection standard (see PROJECT-STATUS) ---
// WiFi shows the IP field; USB hides it (the browser's port picker chooses).
function applyTransport() {
    const usb = (transportSelect.value() === 'USB');
    ipIn.style('display', usb ? 'none' : '');
    if (connectLbl) connectLbl.textContent = usb ? 'Board USB' : 'Board IP';
}
// Green "Connected" when live, plain "Connect" otherwise; restore Disconnect.
function setConnected(on) {
    if (connectBtn) {
        connectBtn.html(on ? 'Connected' : 'Connect');
        connectBtn.removeClass(on ? 'primary' : 'connected').addClass(on ? 'connected' : 'primary');
    }
    if (!on && disconnectBtn) { disconnectBtn.html('Disconnect'); disconnectBtn.removeAttribute('disabled'); }
}
// Flipping WiFi/USB drops the current connection — a browser holds ONE link.
function switchTransport() {
    manualDisconnect = true; ready = false;
    arduino.disconnect();
    setConnected(false);
    persist();
    applyTransport();
    setStatus('channel switched — press Connect');
}

function reattach() { persist(); if (arduino.connected) doConnect(); }

// Attach INSIDE 'ready' (extension state resets on every (re)connect), then
// build the group and centre both servos so we start from a known pose.
function onReady() {
    arduino.pan.attach(saved.panPin);
    arduino.tilt.attach(saved.tiltPin);
    head = arduino.group('head', { pan: arduino.pan, tilt: arduino.tilt });
    head.write({ pan: 90, tilt: 90 });
    pose = { pan: 90, tilt: 90 };
    ready = true;
    setStatus(`ready — pan on pin ${saved.panPin}, tilt on pin ${saved.tiltPin}`);
    log('connected — head centred');
}

// -------------------------------------------------------------------
// Play a gesture: show its code, animate the preview, and (if connected)
// send it to the board and await the whole thing with whenDone().
// -------------------------------------------------------------------
async function playGesture(name) {
    const g = GESTURES[name];
    showCode(name, g);
    startPreview(g);
    if (!ready) { log(`preview: ${name} (not connected)`); return; }

    const t0 = millis();
    log(`head.gesture(${name}) …`);
    const ok = await head.gesture(g).whenDone();
    flashUntil = millis() + 700;
    log(`  ↳ whenDone → ${ok ? 'arrived' : 'TIMEOUT'} in ${round(millis() - t0)} ms`);
}

function recentre() {
    play = null;
    pose = { pan: 90, tilt: 90 };
    panDisp = tiltDisp = 90;
    codeEl.html("head.write({ pan: 90, tilt: 90 });   // back to centre");
    if (ready) head.writeTimed({ pan: 90, tilt: 90 }, 400);
    log('center');
}

// -------------------------------------------------------------------
// Preview — replays the same segments locally with the library's own
// curveShape(), so the on-screen head matches the board's motion.
// -------------------------------------------------------------------
function laneSampler(base, segments) {
    let t0 = 0, from = base;
    const segs = (segments || []).map(s => {
        const dur = max(1, s.dur | 0);
        const to = from + (s.by || 0);          // relative (`by`) — the portable frame
        const seg = { t0, dur, from, to, curve: s.curve || 'linear' };
        t0 += dur; from = to;
        return seg;
    });
    return {
        total: t0, end: from,
        at(el) {
            if (!segs.length) return base;
            for (const s of segs)
                if (el < s.t0 + s.dur) {
                    const u = constrain((el - s.t0) / s.dur, 0, 1);
                    return s.from + (s.to - s.from) * curveShape(s.curve, u);
                }
            return from;
        },
    };
}

function startPreview(g) {
    const pan = laneSampler(pose.pan, g.pan);
    const tilt = laneSampler(pose.tilt, g.tilt);
    play = { pan, tilt, total: max(pan.total, tilt.total), start: millis() };
}

// -------------------------------------------------------------------
// Draw — a simple head: pan turns it (and shifts its gaze), tilt nods it.
// -------------------------------------------------------------------
function draw() {
    background(PAPER);

    if (play) {
        const el = millis() - play.start;
        panDisp = play.pan.at(el);
        tiltDisp = play.tilt.at(el);
        if (el >= play.total) {                 // settled — this pose is the next start
            pose = { pan: play.pan.end, tilt: play.tilt.end };
            panDisp = pose.pan; tiltDisp = pose.tilt;
            play = null;
        }
    } else {
        panDisp = pose.pan; tiltDisp = pose.tilt;
    }

    push();
    translate(cx, cy);
    const yaw = radians((panDisp - 90) * 0.85);   // pan → gentle turn
    const nod = (tiltDisp - 90) * 1.05;           // tilt → nod (px)
    const gaze = (panDisp - 90) * 0.28;

    // neck
    stroke(ready ? INK : HAIR); strokeWeight(6); strokeCap(ROUND);
    line(0, 74, 0, 30);

    rotate(yaw);
    translate(0, -nod);
    // head
    strokeWeight(2); stroke(INK); fill(ready ? PAPER : '#faf7f0');
    ellipse(0, 2, 122, 134);
    // eyes (gaze shifts with pan for liveliness)
    noStroke(); fill(play ? TEAL : INK);
    circle(-25 + gaze, -8, 15);
    circle( 25 + gaze, -8, 15);
    // mouth — a small neutral line
    stroke(GREY); strokeWeight(3); noFill();
    line(-12, 30, 12, 30);
    pop();

    // whenDone ring pulse
    if (millis() < flashUntil) {
        const f = (flashUntil - millis()) / 700;
        noFill(); stroke(colorA(TEAL, 255 * f)); strokeWeight(3);
        circle(cx, cy - 4, 150 + 24 * (1 - f));
    }

    // readouts
    noStroke(); textAlign(CENTER);
    fill(INK); textSize(13);
    text(`pan ${nf(panDisp, 0, 0)}°    tilt ${nf(tiltDisp, 0, 0)}°`, cx, H - 40);
    fill(play ? TEAL : GREY); textSize(11);
    text(play ? 'playing on the board' : (ready ? 'ready' : 'preview only — not connected'), cx, H - 22);
}

// -------------------------------------------------------------------
// Show the gesture as real, formatted code — aligned for readability.
// -------------------------------------------------------------------
function showCode(name, g) {
    const lanes = Object.keys(g);                       // 'pan' and/or 'tilt'
    const keyW = Math.max(...lanes.map(k => k.length));
    const lines = [`// ${name}`, 'head.gesture({'];
    lanes.forEach((lane, li) => {
        const segs = g[lane];
        const bw = Math.max(...segs.map(s => String(s.by).length));
        const dw = Math.max(...segs.map(s => String(s.dur).length));
        const rows = segs.map(s =>
            `{ by: ${String(s.by).padStart(bw)}, dur: ${String(s.dur).padStart(dw)}, curve: '${s.curve}' }`);
        const pad = ' '.repeat(keyW - lane.length);
        const indent = ' '.repeat(2 + keyW + 4);        // align continuation rows under the first `{`
        const comma = li < lanes.length - 1 ? ',' : ',';
        lines.push(`  ${lane}:${pad} [` + rows.join(',\n' + indent) + `]${comma}`);
    });
    lines.push('});');
    codeEl.html(lines.join('\n'));
}

// -------------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------------
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
function log(m) {
    logLines.unshift(m);
    logLines = logLines.slice(0, 8);
    if (logEl) logEl.html(logLines.map(l => `<div>${l}</div>`).join(''));
}
function colorA(hex, a) { const c = color(hex); c.setAlpha(a); return c; }
