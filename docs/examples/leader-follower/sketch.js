// ==============================================================
// Leader–Follower — teleoperate one bus-servo arm from another
// Two WiFi boards, one per arm (LeRobot SO-100/SO-101 style): each arm has
// six Feetech ST servos, IDs 1–6, on its own serial-bus controller. Move the
// LEADER by hand (torque off); the relay streams its joint positions to the
// FOLLOWER (torque on), so the follower mirrors it.
//
// Both boards run the SAME bus-servo firmware (bus-servos.ino / any sketch
// with #include <PardaloteBusServo.h>). This is a browser-only example — two
// Arduino() connections, one per board. Each board's on-page controls (WiFi /
// USB, remembered IP, Connect) come from the shared connect.js; the sketch adds
// each board's bus RX/TX fields to its connection row and owns the status line.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
// The connection (IP / transport) is remembered by connect.js, one store per
// board; this store holds the bus pins + the per-joint flip / on-off state.
const STORE = 'pardalote-leader-follower';
const DEFAULTS = {
    leaderRx: 18, leaderTx: 19, followerRx: 18, followerTx: 19,   // bus-UART pins per board
    flip: [false, false, false, false, false, false],   // per-joint mirror (install property)
    enabled: [true, true, true, true, true, true],      // per-pair on/off (excluded from the system when off)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    // Don't overwrite the saved pins while a field is locked (UNO R4 shows a
    // fixed 1/2) — keep the user's editable (ESP) value for when they return.
    if (!locked.leader)   { saved.leaderRx   = int(leaderRxIn.value);   saved.leaderTx   = int(leaderTxIn.value); }
    if (!locked.follower) { saved.followerRx = int(followerRxIn.value); saved.followerTx = int(followerTxIn.value); }
    saved.flip = flip.slice();
    saved.enabled = enabled.slice();
    localStorage.setItem(STORE, JSON.stringify(saved));
}

// Bus pins from one board's fields (invalid/blank → -1 = board default).
function busPins(key) {
    const c = boardCtx(key);
    const rx = parseInt(c.rx.value, 10), tx = parseInt(c.tx.value, 10);
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
// per-column on/off checkboxes and flip buttons live in the gap between the two dials
const CHK_Y = 168, FLIP_Y = 192, CHK_R = 7, BTN_W = 58, BTN_H = 18;

let leader, follower, followerGroup;
let leaderReady = false, followerReady = false;
let leaderUsbBusy = false, followerUsbBusy = false;   // board on WiFi, silent USB reconnect refused
let relayActive = false, relayTimer = null, lastRelayed = {};

// Per-joint mapping: sync captures both arms' current positions as matched
// origins; flip mirrors the direction. followerTarget = followerOrigin +
// (flip ? -1 : +1) * (leaderPos - leaderOrigin). Un-synced origin = SERVO_CENTER.
let leaderOrigin = new Array(N).fill(SERVO_CENTER);
let followerOrigin = new Array(N).fill(SERVO_CENTER);
let synced = new Array(N).fill(false);   // sync toggle state (highlighted when on)
let flip = (Array.isArray(saved.flip) && saved.flip.length === N) ? saved.flip.slice()
                                                                  : new Array(N).fill(false);
// Per-pair on/off — an off joint is excluded from the whole system: skipped by
// the relay and sync, and its follower servo is freed (never energised).
let enabled = (Array.isArray(saved.enabled) && saved.enabled.length === N) ? saved.enabled.slice()
                                                                          : new Array(N).fill(true);

// Follower soft-limit capture — the "set limits" button cycles three phases:
//   0 'set limits'  → 1 'recording — move follower'  → 2 'limits active'  → 0 …
// Entering phase 1 frees the follower and captures each joint's hand-moved
// range (seeded from the existing limits, so a second pass UPDATES rather than
// resets); phase 2 applies min/max. "clear limits" removes them entirely.
const PHASE_LABELS = ['set limits', 'recording — move follower', 'limits active'];
let limitPhase = 0;
let minRec = new Array(N).fill(Infinity), maxRec = new Array(N).fill(-Infinity);

let statusEl, relayBtn, syncBtn, limitsBtn, freeBtn, freeBtnActive = false;
let leaderRxIn, leaderTxIn, followerRxIn, followerTxIn;   // bus RX/TX fields (added to each connection row)
const locked = { leader: false, follower: false };   // true while a board's pins are R4-fixed

// Per-board context — maps a key ('leader'/'follower') to its Arduino, servo
// prefix, bus fields, and the (primitive) ready global.
function boardCtx(key) {
    if (key === 'leader') return {
        ard: leader, prefix: 'L', rx: leaderRxIn, tx: leaderTxIn, name: 'Leader',
        savedRx: 'leaderRx', savedTx: 'leaderTx',
        get ready() { return leaderReady; }, set ready(v) { leaderReady = v; },
    };
    return {
        ard: follower, prefix: 'F', rx: followerRxIn, tx: followerTxIn, name: 'Follower',
        savedRx: 'followerRx', savedTx: 'followerTx',
        get ready() { return followerReady; }, set ready(v) { followerReady = v; },
    };
}

function setup() {
    const main = select('main');

    // Heading + status live in index.html (#top); the sketch drives the one
    // combined status line for both boards.
    statusEl = select('#status');

    // --- two boards, six bus servos each ---
    leader = new Arduino();
    follower = new Arduino();
    IDS.forEach((_, k) => {
        leader.add('L' + (k + 1), new BusServo());
        follower.add('F' + (k + 1), new BusServo());
    });

    // One connection row per board from the shared connect.js (WiFi/USB, IP,
    // Connect/Disconnect). manageStatus:false — this sketch owns #status, since
    // one line reports both boards. We append each board's bus RX/TX to its row.
    const lc = setupConnection(leader,   { store: 'pardalote-leader-follower-leader-conn',   label: 'Leader',   manageStatus: false });
    const fc = setupConnection(follower, { store: 'pardalote-leader-follower-follower-conn', label: 'Follower', manageStatus: false });
    addBusFields(lc.row, 'leader');
    addBusFields(fc.row, 'follower');

    leader.on('ready', onLeaderReady);
    leader.on('disconnect', () => { leaderReady = false; if (relayActive) stopRelay();
        if (leaderUsbBusy) { leaderUsbBusy = false; updateStatus('leader is on WiFi — press Connect to switch it to USB'); }
        else updateStatus(); });
    // 'usbBusy': a silent USB reconnect reached a board that's on WiFi — it won't
    // switch without a picker gesture. The 'disconnect' that follows shows the prompt.
    leader.on('usbBusy', () => { leaderUsbBusy = true; });

    follower.on('ready', onFollowerReady);
    follower.on('disconnect', () => { followerReady = false; if (relayActive) stopRelay();
        if (followerUsbBusy) { followerUsbBusy = false; updateStatus('follower is on WiFi — press Connect to switch it to USB'); }
        else updateStatus(); });
    follower.on('usbBusy', () => { followerUsbBusy = true; });

    // Relay — start/stop streaming, sync all joints, set/clear follower soft
    // limits, free follower
    let r = row(main, 'Relay');
    relayBtn = createButton('start relay').parent(r).mousePressed(toggleRelay);
    syncBtn = createButton('sync all').parent(r).mousePressed(syncAll);
    limitsBtn = createButton('set limits').parent(r).mousePressed(toggleLimits);
    createButton('clear limits').parent(r).mousePressed(clearLimits);
    freeBtn = createButton('free follower').parent(r).mousePressed(toggleFreeFollower);

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');
    createDiv('Move the LEADER arm by hand — it’s free. Press <b>start relay</b> and the '
        + 'FOLLOWER mirrors it live (amber = commanded, teal = actual). Line the arms up joint '
        + 'for joint and press <b>sync all</b> to match their origins (cancels install offset); '
        + 'per-joint <b>flip</b> mirrors direction. The <b>on/off</b> checkbox above each column '
        + 'excludes that joint pair from the system (its follower goes limp). <b>Set limits</b> '
        + 'cycles set → recording → active: it frees the follower to capture each joint’s range '
        + '(press again to lock the soft limits — orange marks — or to extend them later); '
        + '<b>clear limits</b> removes them. <b>Free / hold follower</b> toggles its torque. '
        + 'Red ring = servo not answering.')
        .class('hint').parent(main);

    // Follower group — writes all six joints in ONE Feetech SyncWrite packet
    // (one WebSocket message) so they move together each relay tick.
    const members = {};
    IDS.forEach((_, k) => members[k + 1] = follower['F' + (k + 1)]);
    followerGroup = follower.group('arm', members);

    updateStatus('enter both boards and press Connect');
}

// Append one board's bus RX/TX pin fields to its connection row (built by
// connect.js). Locked to 1/2 when a UNO R4 connects (see applyR4Pins).
function addBusFields(row, key) {
    const mk = (tag, text) => { const el = document.createElement(tag); if (text != null) el.textContent = text; return el; };
    const busLbl = mk('span', 'bus'); busLbl.style.marginLeft = '8px'; busLbl.style.fontWeight = '700';
    const rx = mk('input'); rx.type = 'number'; rx.value = String(saved[key + 'Rx']); rx.style.width = '62px';
    const tx = mk('input'); tx.type = 'number'; tx.value = String(saved[key + 'Tx']); tx.style.width = '62px';
    row.append(busLbl, mk('span', 'RX'), rx, mk('span', 'TX'), tx);

    const onPins = () => { persist(); if (boardCtx(key).ready) { if (relayActive) stopRelay(); bindArm(key); } };
    rx.addEventListener('change', onPins);
    tx.addEventListener('change', onPins);

    if (key === 'leader') { leaderRxIn = rx; leaderTxIn = tx; }
    else                  { followerRxIn = rx; followerTxIn = tx; }
}

// On connect the board reports its type: a UNO R4's bus is fixed to Serial1
// (D0/D1), so show 1/2 and lock the fields; ESP32 keeps them editable.
function applyR4Pins(key) {
    const c = boardCtx(key);
    const isR4 = String(c.ard.board || '').includes('UNO R4');
    locked[key] = isR4;
    if (isR4) { c.rx.value = '1'; c.tx.value = '2'; }
    else      { c.rx.value = String(saved[c.savedRx]); c.tx.value = String(saved[c.savedTx]); }
    lockField(c.rx, isR4); lockField(c.tx, isR4);
}
function lockField(inp, lock) {
    inp.disabled = lock;
    inp.style.color = lock ? '#a49f92' : '';
    inp.style.background = lock ? '#efece4' : '';
    inp.style.cursor = lock ? 'not-allowed' : '';
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
    refreshSyncBtn();
    // A fresh follower forgets any recorded soft-limit range.
    if (key === 'follower') { limitPhase = 0; for (let j = 0; j < N; j++) { minRec[j] = Infinity; maxRec[j] = -Infinity; } refreshLimitsBtn(); }
}
// On 'ready' the board type is known: lock the pin fields for a UNO R4, then bind.
function onLeaderReady()   { applyR4Pins('leader');   bindArm('leader');   leaderReady = true;   updateStatus(); }
function onFollowerReady() { applyR4Pins('follower'); bindArm('follower'); followerReady = true; updateStatus(); }

// -------------------------------------------------------------------
// Relay — stream leader joint positions to the follower
// -------------------------------------------------------------------
function toggleRelay() { relayActive ? stopRelay() : startRelay(); }

function startRelay() {
    if (!leaderReady || !followerReady) { updateStatus('connect BOTH boards first'); return; }
    if (limitPhase === 1) { updateStatus('finish "set limits" first'); return; }
    // Energise the follower so it holds and tracks; leader stays free. Skip
    // joints switched off — they stay excluded (limp).
    IDS.forEach((_, k) => { if (enabled[k]) follower['F' + (k + 1)].enableTorque(); });
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
        if (!enabled[k]) return;   // pair switched off — excluded from the relay
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
// Sync (one button: match every joint's origin) and per-joint flip
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
// Sync all: one button for every joint. If any joint is synced, clear them all
// back to the SERVO_CENTER default (direct mapping); otherwise capture a matched
// origin for every switched-on joint. Off joints are skipped (excluded).
function syncAll() {
    if (!leaderReady || !followerReady) { updateStatus('connect BOTH boards first'); return; }
    if (synced.some(v => v)) {
        for (let j = 0; j < N; j++) { synced[j] = false; leaderOrigin[j] = SERVO_CENTER; followerOrigin[j] = SERVO_CENTER; lastRelayed[j + 1] = undefined; }
        updateStatus('sync cleared — direct mapping');
    } else {
        let n = 0;
        for (let j = 0; j < N; j++) { if (enabled[j] && captureOrigin(j)) { synced[j] = true; n++; } }
        updateStatus(n ? `synced ${n} joint${n === 1 ? '' : 's'} — origins matched` : 'no joints could sync — check the servos are answering');
    }
    refreshSyncBtn();
}
// Green while any joint is synced; the label flips to "clear sync" so one press
// undoes it.
function refreshSyncBtn() {
    if (!syncBtn) return;
    const on = synced.some(v => v);
    syncBtn.html(on ? 'clear sync' : 'sync all');
    syncBtn.removeClass('active');
    if (on) syncBtn.addClass('active');
}
// Flip toggle: mirror around the current origin (SERVO_CENTER when un-synced).
function flipJoint(j) { flip[j] = !flip[j]; lastRelayed[j + 1] = undefined; persist(); }

// Per-pair on/off checkbox: excludes a joint pair from the whole system. Off frees
// the follower servo and drops the joint's sync; on re-energises it if relaying.
function toggleEnabled(j) {
    enabled[j] = !enabled[j];
    lastRelayed[j + 1] = undefined;
    if (!enabled[j]) {
        synced[j] = false; leaderOrigin[j] = SERVO_CENTER; followerOrigin[j] = SERVO_CENTER;
        if (followerReady && follower['F' + (j + 1)]) follower['F' + (j + 1)].disableTorque();
        refreshSyncBtn();
    } else if (relayActive && followerReady) {
        follower['F' + (j + 1)].enableTorque();   // back in the system — hold and track
    }
    persist();
}

// Free-follower toggle: free the follower (limp, hand-poseable) or hold it.
function toggleFreeFollower() {
    if (!followerReady) { updateStatus('connect the follower first'); return; }
    const held = follower['F1'].torqueOn;
    if (held) { if (relayActive) stopRelay(); IDS.forEach((_, k) => follower['F' + (k + 1)].disableTorque()); updateStatus('follower freed — move it by hand'); }
    else      { IDS.forEach((_, k) => { if (enabled[k]) follower['F' + (k + 1)].enableTorque(); }); updateStatus('follower holding'); }
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
            if (enabled[k] && isFinite(minRec[k]) && isFinite(maxRec[k]) && maxRec[k] > minRec[k]) {
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
            if (!enabled[k]) continue;   // off pair — don't record a range for it
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

    // gutter labels for the two per-column control rows
    fill(GREY); noStroke(); textAlign(LEFT, CENTER); textSize(11);
    text('on/off', 8, CHK_Y);
    text('flip', 8, FLIP_Y);

    // per-column: on/off checkbox, relay-flow chevron (when streaming), flip toggle
    for (let j = 0; j < N; j++) {
        drawCheck(j);
        if (relayActive && enabled[j]) {
            const x = colX(j + 1), cy = LEADER_CY + DIAL_R + 8;
            noStroke(); fill(RED); triangle(x - 5, cy - 5, x + 5, cy - 5, x, cy + 2);
        }
        drawBtn(flipRect(j), flip[j] ? 'flip ⇄' : 'flip', flip[j], false);  // toggle (amber when on)
    }
}

// -------------------------------------------------------------------
// Per-column on/off checkbox + flip button (drawn in the gap; clicked via mousePressed)
// -------------------------------------------------------------------
function btnRect(j, cy) { return { x: colX(j + 1) - BTN_W / 2, y: cy - BTN_H / 2, w: BTN_W, h: BTN_H }; }
function flipRect(j) { return btnRect(j, FLIP_Y); }
function checkAt(j) { return { x: colX(j + 1), y: CHK_Y }; }
function inRect(mx, my, r) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }
function inCheck(mx, my, j) { const c = checkAt(j); return abs(mx - c.x) <= CHK_R + 3 && abs(my - c.y) <= CHK_R + 3; }

// On/off checkbox: teal box with a white tick when the pair is on, empty when excluded.
function drawCheck(j) {
    const c = checkAt(j), s = CHK_R * 2;
    push();
    stroke(enabled[j] ? TEAL : GREY); strokeWeight(1.5);
    fill(enabled[j] ? TEAL : 255);
    rect(c.x - CHK_R, c.y - CHK_R, s, s, 2);
    if (enabled[j]) {   // white tick
        stroke('#fff'); strokeWeight(1.5); noFill();
        line(c.x - 3.5, c.y + 0.5, c.x - 1, c.y + 3.5);
        line(c.x - 1, c.y + 3.5, c.x + 4, c.y - 3.5);
    }
    pop();
}

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
        if (inCheck(mouseX, mouseY, j)) { toggleEnabled(j); return; }
        if (inRect(mouseX, mouseY, flipRect(j))) { flipJoint(j); return; }
    }
}

function drawDial(s, cx, cy, isFollower, j) {
    const ready   = isFollower ? followerReady : leaderReady;
    const missing = ready && s.present === false;
    push();
    translate(cx, cy);

    // Excluded pair — draw a faint, empty dial so it reads as "out of the system".
    if (!enabled[j]) {
        noFill(); stroke(HAIR); strokeWeight(1.5);
        circle(0, 0, DIAL_R * 2);
        fill(HAIR); noStroke(); circle(0, 0, 6);
        pop();
        return;
    }

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
