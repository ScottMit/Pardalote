// ==============================================================
// Leader–Follower — teleoperate one bus-servo arm from another
// Two WiFi boards, one per arm (LeRobot SO-100/SO-101 style): each arm has
// six Feetech ST servos, IDs 1–6, on its own serial-bus controller. Move the
// LEADER by hand (torque off); the relay streams its joint positions to the
// FOLLOWER (torque on), so the follower mirrors it.
//
// Both boards run the SAME bus-servo firmware (bus-servos.ino / any sketch
// with #include <PardaloteBusServo.h>). This is a browser-only example — two
// Arduino() connections, one per board.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-leader-follower';
const DEFAULTS = {
    leaderIp: '192.168.x.x', followerIp: '192.168.x.x',
    leaderTransport: 'wifi', followerTransport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
    leaderRx: 18, leaderTx: 19, followerRx: 18, followerTx: 19,   // bus-UART pins per board
    flip: [false, false, false, false, false, false],   // per-joint mirror (install property)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.leaderIp   = leaderIpIn.value().trim();
    saved.followerIp = followerIpIn.value().trim();
    saved.leaderTransport   = (leaderTransport.value()   === 'USB') ? 'usb' : 'wifi';
    saved.followerTransport = (followerTransport.value() === 'USB') ? 'usb' : 'wifi';
    // Don't overwrite the saved pins while a field is locked (UNO R4 shows a
    // fixed 1/2) — keep the user's editable (ESP) value for when they return.
    if (!locked.leader)   { saved.leaderRx   = int(leaderRxIn.value());   saved.leaderTx   = int(leaderTxIn.value()); }
    if (!locked.follower) { saved.followerRx = int(followerRxIn.value()); saved.followerTx = int(followerTxIn.value()); }
    saved.flip = flip.slice();
    localStorage.setItem(STORE, JSON.stringify(saved));
}

// Bus pins from one board's fields (invalid/blank → -1 = board default).
function busPins(key) {
    const c = boardCtx(key);
    const rx = parseInt(c.rx.value(), 10), tx = parseInt(c.tx.value(), 10);
    return { rxPin: Number.isFinite(rx) ? rx : -1, txPin: Number.isFinite(tx) ? tx : -1 };
}

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B',
      RED = '#D22B2B';

// Six joints per arm, identical IDs on both arms.
const N = 6;
const IDS = [1, 2, 3, 4, 5, 6];

// Relay timing — how fast leader positions stream to the follower. Gentle on
// WiFi: ~20 Hz, and only sent when a joint actually moved (RELAY_THRESH counts).
const READ_MS = 50, RELAY_MS = 50, RELAY_THRESH = 4;

// Servo centre — the default origin, so mirroring (flip) works even before a
// joint is synced. ST-series is 0..4095. (NOT named CENTER — that would shadow
// p5's CENTER text-align constant.)
const SERVO_CENTER = 2048;

// --- Display geometry ---
const W = 760, H = 360, DIAL_R = 40, HEADER_Y = 16,
      LEADER_CY = 92, FOLLOWER_CY = 268, LEFT_PAD = 72, RIGHT_PAD = 20;
const colX = (i) => LEFT_PAD + (i - 0.5) * ((W - LEFT_PAD - RIGHT_PAD) / N);
// per-column sync / flip buttons live in the gap between the two dials
const SYNC_Y = 168, FLIP_Y = 192, BTN_W = 58, BTN_H = 18;

let leader, follower, followerGroup;
let leaderReady = false, followerReady = false;
let leaderManualDisc = false, followerManualDisc = false;
let relayActive = false, relayTimer = null, lastRelayed = {};

// Per-joint mapping: sync captures both arms' current positions as matched
// origins; flip mirrors the direction. followerTarget = followerOrigin +
// (flip ? -1 : +1) * (leaderPos - leaderOrigin). Un-synced origin = SERVO_CENTER.
let leaderOrigin = new Array(N).fill(SERVO_CENTER);
let followerOrigin = new Array(N).fill(SERVO_CENTER);
let synced = new Array(N).fill(false);   // sync toggle state (highlighted when on)
let flip = (Array.isArray(saved.flip) && saved.flip.length === N) ? saved.flip.slice()
                                                                  : new Array(N).fill(false);

// Follower soft-limit capture — the "set limits" button cycles three phases:
//   0 'set limits'  → 1 'recording — move follower'  → 2 'limits active'  → 0 …
// Entering phase 1 frees the follower and captures each joint's hand-moved
// range (seeded from the existing limits, so a second pass UPDATES rather than
// resets); phase 2 applies min/max. "clear limits" removes them entirely.
const PHASE_LABELS = ['set limits', 'recording — move follower', 'limits active'];
let limitPhase = 0;
let minRec = new Array(N).fill(Infinity), maxRec = new Array(N).fill(-Infinity);

let statusEl, relayBtn, limitsBtn, freeBtn, freeBtnActive = false;
let leaderIpIn, leaderTransport, leaderConnectLbl, leaderConnectBtn, leaderDisconnectBtn, leaderRxIn, leaderTxIn;
let followerIpIn, followerTransport, followerConnectLbl, followerConnectBtn, followerDisconnectBtn, followerRxIn, followerTxIn;
const locked = { leader: false, follower: false };   // true while a board's pins are R4-fixed

// Per-board context — maps a key ('leader'/'follower') to its Arduino, servo
// prefix, UI fields, and the (primitive) ready/manualDisc globals.
function boardCtx(key) {
    if (key === 'leader') return {
        ard: leader, prefix: 'L', ip: leaderIpIn, rx: leaderRxIn, tx: leaderTxIn,
        transport: leaderTransport, connectLbl: leaderConnectLbl, connectBtn: leaderConnectBtn, disconnectBtn: leaderDisconnectBtn, name: 'Leader',
        savedRx: 'leaderRx', savedTx: 'leaderTx',
        get ready() { return leaderReady; }, set ready(v) { leaderReady = v; },
        get manualDisc() { return leaderManualDisc; }, set manualDisc(v) { leaderManualDisc = v; },
    };
    return {
        ard: follower, prefix: 'F', ip: followerIpIn, rx: followerRxIn, tx: followerTxIn,
        transport: followerTransport, connectLbl: followerConnectLbl, connectBtn: followerConnectBtn, disconnectBtn: followerDisconnectBtn, name: 'Follower',
        savedRx: 'followerRx', savedTx: 'followerTx',
        get ready() { return followerReady; }, set ready(v) { followerReady = v; },
        get manualDisc() { return followerManualDisc; }, set manualDisc(v) { followerManualDisc = v; },
    };
}

function setup() {
    const main = select('main');

    const top = createDiv().id('top').parent(main);
    createDiv('Leader → Follower').class('heading').parent(top);
    statusEl = createDiv('status: starting…').id('status').parent(top);

    // Each board: WiFi/USB transport, IP (WiFi only), connect/disconnect, and
    // its bus-UART RX/TX pins (locked to 1/2 when a UNO R4 connects).
    makeBoardRow(main, 'leader');
    makeBoardRow(main, 'follower');
    applyTransport('leader');
    applyTransport('follower');

    // Relay — start/stop streaming, set/clear follower soft limits, free follower
    let r = row(main, 'Relay');
    relayBtn = createButton('start relay').parent(r).mousePressed(toggleRelay);
    limitsBtn = createButton('set limits').parent(r).mousePressed(toggleLimits);
    createButton('clear limits').parent(r).mousePressed(clearLimits);
    freeBtn = createButton('free follower').parent(r).mousePressed(toggleFreeFollower);

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');
    createDiv('Move the LEADER arm by hand — it’s free. Press <b>start relay</b> and the '
        + 'FOLLOWER mirrors it live (amber = commanded, teal = actual). Line up a joint on both '
        + 'arms and toggle <b>sync</b> to match their origins (cancels install offset); '
        + '<b>flip</b> mirrors that joint. <b>Set limits</b> cycles set → recording → active: it '
        + 'frees the follower to capture each joint’s range (press again to lock the soft limits '
        + '— orange marks — or to extend them later); <b>clear limits</b> removes them. '
        + '<b>Free / hold follower</b> toggles its torque. Red ring = servo not answering.')
        .class('hint').parent(main);

    // --- two boards, six bus servos each ---
    leader = new Arduino();
    follower = new Arduino();
    IDS.forEach((_, k) => {
        leader.add('L' + (k + 1), new BusServo());
        follower.add('F' + (k + 1), new BusServo());
    });

    leader.on('ready', onLeaderReady);
    leader.on('disconnect', () => { leaderReady = false; onBoardDisconnected('leader'); if (relayActive) stopRelay();
        if (!leaderManualDisc) updateStatus('leader reconnecting…'); else updateStatus(); });

    follower.on('ready', onFollowerReady);
    follower.on('disconnect', () => { followerReady = false; onBoardDisconnected('follower'); if (relayActive) stopRelay();
        if (!followerManualDisc) updateStatus('follower reconnecting…'); else updateStatus(); });

    // Follower group — writes all six joints in ONE Feetech SyncWrite packet
    // (one WebSocket message) so they move together each relay tick.
    const members = {};
    IDS.forEach((_, k) => members[k + 1] = follower['F' + (k + 1)]);
    followerGroup = follower.group('arm', members);

    // Returning visit: reconnect both with the remembered settings.
    if (localStorage.getItem(STORE)) { connectBoard('leader'); connectBoard('follower'); }
    else updateStatus('enter both boards and press Connect');
}

// Build one board's connection row: transport dropdown, IP (WiFi), Connect,
// Disconnect, and RX/TX pin fields. Stashes the controls in the per-board globals.
function makeBoardRow(main, key) {
    const cap = key[0].toUpperCase() + key.slice(1);
    const r = row(main, cap);
    const connectLbl = r.elt.querySelector('.lbl');
    const transport = createSelect().parent(r);
    transport.option('WiFi'); transport.option('USB');
    transport.elt.value = (saved[key + 'Transport'] === 'usb') ? 'USB' : 'WiFi';
    transport.changed(() => switchTransport(key));
    const ip = createInput(saved[key + 'Ip'], 'text').parent(r); ip.style('width', '120px');
    const connectBtn = createButton('Connect').parent(r).mousePressed(() => connectBoard(key)).addClass('primary');
    const disconnectBtn = createButton('Disconnect').parent(r).mousePressed(() => disconnectBoard(key));
    createSpan('bus').parent(r).style('margin-left', '8px').style('font-weight', '700');
    createSpan('RX').parent(r);
    const rx = createInput(String(saved[key + 'Rx']), 'number').parent(r); rx.style('width', '62px');
    createSpan('TX').parent(r);
    const tx = createInput(String(saved[key + 'Tx']), 'number').parent(r); tx.style('width', '62px');
    const onPins = () => { persist(); if (boardCtx(key).ready) { if (relayActive) stopRelay(); bindArm(key); } };
    rx.changed(onPins); tx.changed(onPins);

    if (key === 'leader') { leaderTransport = transport; leaderIpIn = ip; leaderConnectBtn = connectBtn; leaderDisconnectBtn = disconnectBtn; leaderRxIn = rx; leaderTxIn = tx; leaderConnectLbl = connectLbl; }
    else                  { followerTransport = transport; followerIpIn = ip; followerConnectBtn = connectBtn; followerDisconnectBtn = disconnectBtn; followerRxIn = rx; followerTxIn = tx; followerConnectLbl = connectLbl; }
}

// Reflect connection state on a board's Connect button: green "Connected" when
// ready, plain "Connect" otherwise. (WiFi and USB alike.)
function refreshConnectBtn(key) {
    const c = boardCtx(key);
    if (!c.connectBtn) return;
    if (c.ready) { c.connectBtn.html('Connected'); c.connectBtn.removeClass('primary').addClass('connected'); }
    else         { c.connectBtn.html('Connect');   c.connectBtn.removeClass('connected').addClass('primary'); }
}

// Flipping a board's WiFi/USB drops that board's connection — a browser holds
// ONE link per board, so its "Connected" badge can't carry to the new channel.
function switchTransport(key) {
    const c = boardCtx(key);
    if (relayActive) stopRelay();
    c.manualDisc = true; c.ready = false;
    c.ard.disconnect();
    if (c.disconnectBtn) { c.disconnectBtn.html('Disconnect'); c.disconnectBtn.removeAttribute('disabled'); }
    refreshConnectBtn(key);   // → plain 'Connect'
    persist();
    applyTransport(key);
    updateStatus(`${c.name} channel switched — press Connect`);
}

// WiFi shows the IP field; USB hides it (the browser's port picker chooses).
function applyTransport(key) {
    const c = boardCtx(key);
    const usb = (c.transport.value() === 'USB');
    c.ip.style('display', usb ? 'none' : '');
    if (c.connectLbl) c.connectLbl.textContent = usb ? c.name + ' USB' : c.name;
}

// On connect the board reports its type: a UNO R4's bus is fixed to Serial1
// (D0/D1), so show 1/2 and lock the fields; ESP32 keeps them editable.
function applyR4Pins(key) {
    const c = boardCtx(key);
    const isR4 = String(c.ard.board || '').includes('UNO R4');
    locked[key] = isR4;
    if (isR4) { c.rx.value('1'); c.tx.value('2'); }
    else      { c.rx.value(String(saved[c.savedRx])); c.tx.value(String(saved[c.savedTx])); }
    lockField(c.rx, isR4); lockField(c.tx, isR4);
}
function lockField(inp, lock) {
    if (lock) { inp.attribute('disabled', ''); inp.style('color', '#a49f92'); inp.style('background', '#efece4'); inp.style('cursor', 'not-allowed'); }
    else      { inp.removeAttribute('disabled'); inp.style('color', ''); inp.style('background', ''); inp.style('cursor', ''); }
}

// -------------------------------------------------------------------
// Connections (one Arduino per board) — WiFi (IP) or USB (Web Serial)
// -------------------------------------------------------------------
async function connectBoard(key) {
    const c = boardCtx(key);
    persist(); c.manualDisc = false; c.ready = false;
    if (c.transport.value() === 'USB') {
        updateStatus(`connecting ${key} over USB…`);
        await c.ard.connectSerial(PROMPT);   // always show the port picker
        if (!c.ard.socket) updateStatus(`press ${c.name} Connect and choose the USB port`);
        return;                        // attach happens on 'ready'
    }
    const ip = c.ip.value().trim();
    if (!ip || ip.includes('x')) { updateStatus(`enter the ${key} IP`); return; }
    c.ard.connect(ip); updateStatus(`connecting ${key}…`);
}
function disconnectBoard(key) {
    if (relayActive) stopRelay();
    const c = boardCtx(key);
    c.manualDisc = true; c.ready = false;
    // USB port close can take a moment — show progress so the UI isn't "stuck".
    if (c.disconnectBtn) { c.disconnectBtn.html('Disconnecting…'); c.disconnectBtn.attribute('disabled', ''); }
    refreshConnectBtn(key);
    c.ard.disconnect();   // the 'disconnect' event restores the button when done
    setTimeout(() => onBoardDisconnected(key), 3000);   // safety: restore even if no event fires
    updateStatus();
}
// Restore a board's Disconnect button after the 'disconnect' event fires.
function onBoardDisconnected(key) {
    const c = boardCtx(key);
    if (c.disconnectBtn) { c.disconnectBtn.html('Disconnect'); c.disconnectBtn.removeAttribute('disabled'); }
    refreshConnectBtn(key);
}

// -------------------------------------------------------------------
// Per-arm setup on connect
// -------------------------------------------------------------------
// Bind one arm's six servos: set the board's bus pins first (global to that
// board — used on ESP32, ignored on the R4), then attach each, start FREE, and
// poll for live position.
function bindArm(key) {
    const c = boardCtx(key);
    c.ard[c.prefix + 1].configureBus(busPins(key));   // one call sets the whole bus
    IDS.forEach((id, k) => {
        const s = c.ard[c.prefix + (k + 1)];
        s.attach(id, 'ST');
        s.disableTorque();      // both arms start free — safe; nothing moves
        s.read(READ_MS);        // stream positions for the dials / relay
    });
    // A fresh (re)bind invalidates the captured origins — fall back to the
    // SERVO_CENTER default (direct mapping) and drop the sync toggles. (flip is
    // kept — it's an install property.)
    for (let j = 0; j < N; j++) { leaderOrigin[j] = SERVO_CENTER; followerOrigin[j] = SERVO_CENTER; synced[j] = false; }
    // A fresh follower forgets any recorded soft-limit range.
    if (key === 'follower') { limitPhase = 0; for (let j = 0; j < N; j++) { minRec[j] = Infinity; maxRec[j] = -Infinity; } refreshLimitsBtn(); }
}
// On 'ready' the board type is known: lock the pin fields for a UNO R4, then bind.
function onLeaderReady()   { applyR4Pins('leader');   bindArm('leader');   leaderReady = true;   refreshConnectBtn('leader');   updateStatus(); }
function onFollowerReady() { applyR4Pins('follower'); bindArm('follower'); followerReady = true; refreshConnectBtn('follower'); updateStatus(); }

// -------------------------------------------------------------------
// Relay — stream leader joint positions to the follower
// -------------------------------------------------------------------
function toggleRelay() { relayActive ? stopRelay() : startRelay(); }

function startRelay() {
    if (!leaderReady || !followerReady) { updateStatus('connect BOTH boards first'); return; }
    if (limitPhase === 1) { updateStatus('finish "set limits" first'); return; }
    // Energise the follower so it holds and tracks; leader stays free.
    IDS.forEach((_, k) => follower['F' + (k + 1)].enableTorque());
    lastRelayed = {};
    relayActive = true;
    relayTimer = setInterval(relayTick, RELAY_MS);
    refreshRelayBtn(); updateStatus();
}
function stopRelay() {
    relayActive = false;
    if (relayTimer) clearInterval(relayTimer);
    relayTimer = null;
    // Leave the follower holding its last pose (torque stays on) — press
    // "free follower" to release it.
    refreshRelayBtn(); updateStatus();
}

// One tick: map each leader joint's live position through its sync origin and
// flip, then write all follower joints in one coordinated group write. Skip
// joints whose leader servo isn't answering (position -1) so we never command
// garbage; only send when something moved.
//   followerTarget = followerOrigin + (flip ? -1 : +1) * (leaderPos - leaderOrigin)
function relayTick() {
    if (!relayActive || !leaderReady || !followerReady) return;
    const vals = {};
    let moved = false;
    IDS.forEach((_, k) => {
        const lead = leader['L' + (k + 1)];
        if (lead.present === false || lead.position < 0) return;   // no answer — skip this joint
        const F = follower['F' + (k + 1)];
        const delta = lead.position - leaderOrigin[k];
        let target = followerOrigin[k] + (flip[k] ? -delta : delta);
        target = Math.round(constrain(target, 0, (F.resolution || 4096) - 1));
        const key = k + 1;
        vals[key] = target;
        if (Math.abs(target - (lastRelayed[key] ?? -9999)) >= RELAY_THRESH) moved = true;
    });
    if (moved && Object.keys(vals).length) {
        followerGroup.write(vals);
        lastRelayed = { ...vals };
    }
}

// -------------------------------------------------------------------
// Per-joint sync (toggle: matched origin) and flip (toggle: mirror direction)
// -------------------------------------------------------------------
// Capture the current position of both arms for joint j as its origin, so from
// now on movement is relative to this matched pose (cancels install offset).
function captureOrigin(j) {
    if (!leaderReady || !followerReady) return false;
    const L = leader['L' + (j + 1)], F = follower['F' + (j + 1)];
    if (L.present === false || L.position < 0 || F.present === false || F.position < 0) return false;
    leaderOrigin[j]   = L.position;
    followerOrigin[j] = F.position;
    lastRelayed[j + 1] = undefined;   // force the next tick to send
    return true;
}
// Sync toggle: ON captures the matched origin (stays highlighted); OFF clears it
// back to the SERVO_CENTER default (direct mapping).
function syncJoint(j) {
    if (synced[j]) { synced[j] = false; leaderOrigin[j] = SERVO_CENTER; followerOrigin[j] = SERVO_CENTER; lastRelayed[j + 1] = undefined; }
    else if (captureOrigin(j)) { synced[j] = true; }
}
// Flip toggle: mirror around the current origin (SERVO_CENTER when un-synced).
function flipJoint(j) { flip[j] = !flip[j]; lastRelayed[j + 1] = undefined; persist(); }

// Free-follower toggle: free the follower (limp, hand-poseable) or hold it.
function toggleFreeFollower() {
    if (!followerReady) { updateStatus('connect the follower first'); return; }
    const held = follower['F1'].torqueOn;
    if (held) { if (relayActive) stopRelay(); IDS.forEach((_, k) => follower['F' + (k + 1)].disableTorque()); updateStatus('follower freed — move it by hand'); }
    else      { IDS.forEach((_, k) => follower['F' + (k + 1)].enableTorque()); updateStatus('follower holding'); }
}
// The label stays "free follower"; it turns green while that mode is on (the
// follower is loose). Called from draw(); only touches the DOM on a change.
function refreshFreeBtn() {
    if (!freeBtn) return;
    const loose = !!(followerReady && follower['F1'] && !follower['F1'].torqueOn);
    if (loose === freeBtnActive) return;
    freeBtnActive = loose;
    freeBtn.removeClass('connected');
    if (loose) freeBtn.addClass('connected');   // green = follower is free
}

function refreshRelayBtn() {
    relayBtn.html(relayActive ? 'stop relay' : 'start relay');
    relayBtn.removeClass('active-red');
    if (relayActive) relayBtn.addClass('active-red');
}

// -------------------------------------------------------------------
// Follower soft limits — the button cycles set → recording → active → set …
// -------------------------------------------------------------------
function toggleLimits() {
    if (!followerReady) { updateStatus('connect the follower first'); return; }
    limitPhase = (limitPhase + 1) % 3;
    if (limitPhase === 1) {
        // Recording: free the follower and capture. Keep the existing recorded
        // range so a repeat pass EXTENDS it (never resets — "clear limits" does).
        if (relayActive) stopRelay();
        IDS.forEach((_, k) => follower['F' + (k + 1)].disableTorque());
        updateStatus('recording — move each follower joint through its range, then press again');
    } else if (limitPhase === 2) {
        // Enforce the captured range as board-side soft limits.
        let any = false;
        IDS.forEach((_, k) => {
            if (isFinite(minRec[k]) && isFinite(maxRec[k]) && maxRec[k] > minRec[k]) {
                follower['F' + (k + 1)].setLimits(Math.round(minRec[k]), Math.round(maxRec[k]));
                any = true;
            }
        });
        updateStatus(any ? 'soft limits active' : 'no range recorded — press again and move the follower');
    } else {
        // Phase 0: IGNORE the limits — stop enforcing on the board, but remember
        // the range (grey marks) so the next pass can extend it.
        IDS.forEach((_, k) => follower['F' + (k + 1)].clearLimits());
        updateStatus('limits ignored — press "set limits" to record again');
    }
    refreshLimitsBtn();
}

// Clear limits: wipe the board limits and the recorded range. If pressed while
// recording, DON'T exit — start capturing a fresh range.
function clearLimits() {
    for (let j = 0; j < N; j++) { minRec[j] = Infinity; maxRec[j] = -Infinity; }
    IDS.forEach((_, k) => { if (followerReady) follower['F' + (k + 1)].clearLimits(); });
    if (limitPhase !== 1) limitPhase = 0;
    refreshLimitsBtn();
    updateStatus(limitPhase === 1 ? 'limits cleared — keep moving to record a fresh range' : 'soft limits cleared');
}

function refreshLimitsBtn() {
    limitsBtn.html(PHASE_LABELS[limitPhase]);
    limitsBtn.removeClass('active').removeClass('active-warn');
    if (limitPhase === 1)      limitsBtn.addClass('active-warn');   // orange = capturing
    else if (limitPhase === 2) limitsBtn.addClass('active');        // teal = enforced
}

// -------------------------------------------------------------------
// Status
// -------------------------------------------------------------------
function updateStatus(msg) {
    if (msg) { setStatus(msg); return; }
    const L = leaderReady ? 'leader ✓' : 'leader —';
    const F = followerReady ? 'follower ✓' : 'follower —';
    setStatus(`${L}   ${F}${relayActive ? '   ● RELAY ON (leader → follower)' : ''}`);
}
function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }

function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}

// -------------------------------------------------------------------
// Display — six columns (joints), leader row over follower row.
// TEAL needle = live position; AMBER (follower, relay on) = commanded target;
// red ring = servo not answering; a red arrow per joint shows the live relay.
// -------------------------------------------------------------------
function posAngle(s, pos) { return map(pos, 0, s.resolution, -PI, PI) - HALF_PI; }

function draw() {
    background(255);

    // joint-number header
    noStroke(); fill(GREY); textAlign(CENTER, CENTER); textSize(11);
    for (let i = 1; i <= N; i++) text(i, colX(i), HEADER_Y);

    // row labels
    fill(INK); textAlign(LEFT, CENTER); textSize(12);
    text('Leader', 8, LEADER_CY);
    text(relayActive ? 'Follower ●' : 'Follower', 8, FOLLOWER_CY);

    refreshFreeBtn();   // keep the free/hold toggle label in step with torque state

    // while recording, expand each follower joint's min/max from its live position
    if (limitPhase === 1 && followerReady) {
        for (let k = 0; k < N; k++) {
            const F = follower['F' + (k + 1)];
            if (F.present !== false && F.position >= 0) {
                if (F.position < minRec[k]) minRec[k] = F.position;
                if (F.position > maxRec[k]) maxRec[k] = F.position;
            }
        }
    }

    for (let k = 0; k < N; k++) {
        drawDial(leader['L' + (k + 1)],   colX(k + 1), LEADER_CY,   false, k);
        drawDial(follower['F' + (k + 1)], colX(k + 1), FOLLOWER_CY, true, k);
    }

    // per-column: relay-flow chevron (when streaming) + sync / flip toggles
    for (let j = 0; j < N; j++) {
        if (relayActive) {
            const x = colX(j + 1), cy = LEADER_CY + DIAL_R + 8;
            noStroke(); fill(RED); triangle(x - 5, cy - 5, x + 5, cy - 5, x, cy + 2);
        }
        drawBtn(syncRect(j), 'sync', false, synced[j]);                     // toggle (teal when on)
        drawBtn(flipRect(j), flip[j] ? 'flip ⇄' : 'flip', flip[j], false);  // toggle (amber when on)
    }
}

// -------------------------------------------------------------------
// Per-column sync / flip buttons (drawn in the gap; clicked via mousePressed)
// -------------------------------------------------------------------
function btnRect(j, cy) { return { x: colX(j + 1) - BTN_W / 2, y: cy - BTN_H / 2, w: BTN_W, h: BTN_H }; }
function syncRect(j) { return btnRect(j, SYNC_Y); }
function flipRect(j) { return btnRect(j, FLIP_Y); }
function inRect(mx, my, r) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }

function drawBtn(r, label, active, flash) {
    push();
    stroke(INK); strokeWeight(1);
    fill(active ? AMBER : flash ? TEAL : 255);
    rect(r.x, r.y, r.w, r.h, 2);
    noStroke(); fill(active || flash ? '#fff' : INK);
    textAlign(CENTER, CENTER); textSize(10);
    text(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    pop();
}

function mousePressed() {
    for (let j = 0; j < N; j++) {
        if (inRect(mouseX, mouseY, syncRect(j))) { syncJoint(j); return; }
        if (inRect(mouseX, mouseY, flipRect(j))) { flipJoint(j); return; }
    }
}

function drawDial(s, cx, cy, isFollower, j) {
    const ready   = isFollower ? followerReady : leaderReady;
    const missing = ready && s.present === false;
    push();
    translate(cx, cy);

    // ring: red = not answering OR follower under torque (active); ink = live &
    // free; hairline = offline. (The leader is always free → ink when live.)
    noFill();
    let ringCol = HAIR;
    if (missing) ringCol = RED;
    else if (ready) ringCol = (isFollower && s.torqueOn) ? RED : INK;
    stroke(ringCol); strokeWeight(1.5);
    circle(0, 0, DIAL_R * 2);

    // follower soft-limit marks — the recorded range, ORANGE while recording or
    // enforced, GREY when ignored (phase 0).
    if (isFollower && ready && !missing && isFinite(minRec[j]) && isFinite(maxRec[j]) && maxRec[j] > minRec[j]) {
        stroke(limitPhase === 0 ? GREY : ORANGE); strokeWeight(2);
        [minRec[j], maxRec[j]].forEach(p => {
            const a = posAngle(s, p);
            line(cos(a) * (DIAL_R - 2), sin(a) * (DIAL_R - 2),
                 cos(a) * (DIAL_R + 6), sin(a) * (DIAL_R + 6));
        });
    }

    if (ready && !missing) {
        // follower commanded target (amber) while relaying
        if (isFollower && relayActive && s.hasTarget) {
            const at = posAngle(s, s.target);
            stroke(AMBER); strokeWeight(2);
            line(0, 0, cos(at) * (DIAL_R - 4), sin(at) * (DIAL_R - 4));
        }
        // live position (teal)
        const pos = s.position >= 0 ? s.position : s.resolution / 2;
        const a = posAngle(s, pos);
        stroke(TEAL); strokeWeight(3);
        line(0, 0, cos(a) * (DIAL_R - 7), sin(a) * (DIAL_R - 7));
    }

    fill(ready && !missing ? INK : GREY); noStroke();
    circle(0, 0, 6);
    pop();
}
