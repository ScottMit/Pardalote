// ==============================================================
// Stepper speed test — how fast can Pardalote step this motor?
// A bench tool (not an example). Three tests, run one at a time:
//   1. Constant — runSpeed() at each speed, real rate from position reads.
//   2. Ramp     — moveTo() legs vs the ideal accelerate–cruise–decelerate time.
//   3. Gesture  — a one-segment linear gesture: on time? arrived?
//   4. Soak     — 1–3 on repeat (plus an impossible gesture and a sweeping
//                 servo) for N minutes; tallies problems and reconnects.
// Pair it with stepper-speed-test.ino, which prints board-side timings.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let arduino, stepper = null, busy = false, abort = false;
let last = null;                 // latest position report { pos, t }
const lines = [];                // results as plain text, for "copy"
let soak = null;                 // soak tally while test 4 runs (only problems are listed)

arduino = new Arduino();
setupConnection(arduino, { store: 'pardalote-stepper-speed-test-conn' });
arduino.on('ready', attach);
arduino.on('disconnect', () => { abort = true; if (soak) soak.reconnects++; });

// --- Stepper ------------------------------------------------------------
function attach() {
    if (!arduino.x) {
        arduino.add('x', new Stepper());
        arduino.x.on('change', ({ position }) => { last = { pos: position, t: performance.now() }; });
    }
    stepper = arduino.x;
    stepper.attach(num('stepPin'), num('dirPin'), num('enPin'));
    if (num('enPin') !== -1) stepper.enable();
    stepper.read(50, 0);                                  // position reports for test 1
    setStatus(`stepper attached (STEP ${num('stepPin')}, DIR ${num('dirPin')}, EN ${num('enPin')})`);
}
$('attach').onclick = () => { if (arduino.connected) attach(); else setStatus('connect first'); };

// Wait for the stepper's next 'done' (or give up after `ms`).
function nextDone(ms) {
    return new Promise(resolve => {
        const t = setTimeout(() => { stepper.off('done', h); resolve(null); }, ms);
        const h = (e) => { clearTimeout(t); stepper.off('done', h); resolve(e); };
        stepper.on('done', h);
    });
}

// Ideal time (ms) for a move of d steps at max speed v, acceleration a.
function rampTimeMs(d, v, a) {
    const accelDecelDist = v * v / a;                     // distance to reach v and stop again
    return 1000 * (d >= accelDecelDist ? d / v + v / a : 2 * Math.sqrt(d / a));
}

// --- Results --------------------------------------------------------------
function addRow(test, asked, expected, measured, achieved, result, good) {
    if (soak) {                                           // soak: tally everything, list only problems
        soak.checks++;
        if (good) return;
        soak.problems++;
        test = `[cycle ${soak.cycle}, ${clock()}] ${test}`;
    }
    const tr = document.createElement('tr');
    const cells = [test, asked, expected, measured, achieved, result];
    cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 0 || i === 5) td.className = 'l';
        if (i === 5) td.classList.add(good ? 'ok' : 'slow');
        tr.appendChild(td);
    });
    $('results').querySelector('tbody').appendChild(tr);
    lines.push(cells.join('\t'));
}
const fmt = (n) => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString();

function setStatus(s) { $('info').textContent = s; }   // connect.js owns the header #status
const clock = () => { const s = Math.floor((performance.now() - soak.t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Run one test at a time; `stop` aborts between steps and halts the motor.
async function runTest(name, fn) {
    if (busy) return;
    if (!stepper || !arduino.connected) { setStatus('connect and attach first'); return; }
    busy = true; abort = false;
    setStatus(`running ${name}…`);
    try { const msg = await fn(); setStatus(msg || (abort ? `${name} stopped` : `${name} done`)); }
    catch (e) { setStatus(`${name} failed: ${e.message}`); }
    busy = false;
}

// --- 1. Constant speed ------------------------------------------------------
async function constantTest() {
    const speeds = $('speeds').value.split(',').map(Number).filter(v => v > 0);
    const hold = Math.max(500, num('hold'));
    stepper.setAcceleration(Math.max(num('rAcc'), 1000));   // stop() decelerates at this
    let dir = 1;
    for (const v of speeds) {
        if (abort) break;
        stepper.setMaxSpeed(v);                             // runSpeed() is capped at maxSpeed (default 1,000)
        stepper.runSpeed(v * dir);
        await sleep(400);                                   // let reports settle (no ramp in this mode)
        const a = last;
        await sleep(hold);
        const b = last;
        stepper.stop();
        await nextDone(5000);
        if (!a || !b || b.t <= a.t) { addRow('constant', fmt(v), '—', '—', '—', 'no position reports', false); continue; }
        const rate = Math.abs(b.pos - a.pos) / ((b.t - a.t) / 1000);
        const good = rate >= 0.95 * v;
        addRow('constant', fmt(v), '—', fmt(b.t - a.t), fmt(rate), good ? 'ok' : `${Math.round(100 * rate / v)}% of asked`, good);
        dir = -dir;                                         // alternate so it stays near where it started
    }
}

// --- 2. Ramp moves ----------------------------------------------------------
async function rampTest() {
    const d = num('rDist'), v = num('rMax'), a = num('rAcc'), legs = num('rLegs');
    stepper.setMaxSpeed(v);
    stepper.setAcceleration(a);
    stepper.setPosition(0);
    const expected = rampTimeMs(d, v, a);
    const peak = Math.min(v, Math.sqrt(a * d));             // top speed this profile reaches
    for (let i = 1; i <= legs && !abort; i++) {
        const t0 = performance.now();
        stepper.moveTo(i % 2 ? d : 0);
        // Generous timeout: a slow board (~1,000 steps/s) should read as "slow", not "timed out".
        const ok = await stepper.whenDone({ timeout: Math.max(expected * 4, d / 200 * 1000) + 5000 });
        const t = performance.now() - t0;
        const good = ok && t <= expected * 1.1 + 150;      // 150 ms allowance for network latency
        addRow(`ramp leg ${i}`, `${fmt(d)} @ ${fmt(v)}/${fmt(a)} (peak ${fmt(peak)})`, fmt(expected), fmt(t),
               fmt(d / (t / 1000)) + ' avg', !ok ? 'timed out' : good ? 'ok' : `${(t / expected).toFixed(2)}× expected`, good);
    }
}

// --- 3. Gesture -------------------------------------------------------------
async function gestureTest() {
    const d = num('gDist'), dur = num('gDur'), legs = num('gLegs');
    stepper.setPosition(0);
    for (let i = 1; i <= legs && !abort; i++) {
        const done = nextDone(dur + 8000);                  // the gesture's own 'done' carries `arrived`
        const t0 = performance.now();
        stepper.gesture([{ to: i % 2 ? d : 0, dur, curve: 'linear' }], { absolute: true });
        const e = await done;
        const t = performance.now() - t0;
        const arrived = !!(e && e.arrived);
        const good = arrived && t <= dur + 250;
        addRow(`gesture leg ${i}`, `${fmt(d)} in ${fmt(dur)} ms (${fmt(d / (dur / 1000))}/s)`, fmt(dur), fmt(t),
               fmt(d / (t / 1000)) + ' avg', !e ? 'no done' : !arrived ? `gave up at ${fmt(e.position)}` : good ? 'ok' : 'late', good);
    }
}

// --- 4. Soak ---------------------------------------------------------------
const IMPOSSIBLE_STEPS = 80000;
async function soakTest() {
    const until = performance.now() + num('soakMin') * 60000;
    const pin = num('servoPin');
    soak = { t0: performance.now(), cycle: 0, checks: 0, problems: 0, reconnects: 0, gaveUp: 0 };
    let servoTimer = null, up = true;
    const startServo = () => {                            // a PWM servo sweeping alongside the stepper
        if (pin < 0 || !arduino.connected) return;
        if (!arduino.sv) arduino.add('sv', new Servo());
        arduino.sv.attach(pin);
    };
    stopSoakServo = () => {                              // the stop button calls this at once
        if (servoTimer) { clearInterval(servoTimer); servoTimer = null; }
        if (arduino.connected && arduino.sv) arduino.sv.stop();
    };
    if (pin >= 0) {
        startServo();
        arduino.on('ready', startServo);
        servoTimer = setInterval(() => { if (arduino.connected && arduino.sv) arduino.sv.writeTimed((up = !up) ? 160 : 20, 1200); }, 1500);
    }
    const tally = () => setStatus(`soak ${clock()} · cycle ${soak.cycle} · ${soak.checks} checks · ` +
        `${soak.problems} problems · ${soak.reconnects} reconnects · impossible gesture gave up ${soak.gaveUp}/${soak.cycle}`);
    try {
        while (!soakStopped && performance.now() < until) {
            if (!arduino.connected || !stepper) {             // ride out a disconnect
                setStatus(`soak ${clock()} · waiting to reconnect…`);
                await sleep(1000);
                continue;
            }
            abort = false;
            soak.cycle++; tally();
            for (const fn of [constantTest, rampTest, gestureTest]) {
                if (abort || performance.now() >= until) break;
                await fn(); tally();
            }
            // One deliberately impossible gesture: it SHOULD give up and hold. It must
            // need more than 100 ms + the 2 s landing grace even at full speed
            // (~20,000 steps/s here), so 80,000 steps (≥ 3 s), not gDist.
            if (!abort && arduino.connected) {
                const e = nextDone(12000);
                stepper.gesture([{ to: stepper.position + IMPOSSIBLE_STEPS, dur: 100, curve: 'linear' }], { absolute: true });
                const r = await e;
                if (r && r.arrived === false) soak.gaveUp++;
                else addRow('impossible gesture', `${fmt(IMPOSSIBLE_STEPS)} in 100 ms`, '—', '—', '—', r ? 'arrived?!' : 'no done', false);
                stepper.moveTo(0); await stepper.whenDone({ timeout: 20000 });
                tally();
            }
            if (soakStopped) break;
        }
    } finally {
        stopSoakServo(); stopSoakServo = null;
        arduino.off('ready', startServo);
        const summary = `soak finished ${clock()} · ${soak.cycle} cycles · ${soak.checks} checks · ${soak.problems} problems · ` +
            `${soak.reconnects} reconnects · impossible gesture gave up ${soak.gaveUp}/${soak.cycle}`;
        lines.push(summary);
        soak = null;
        setStatus(summary);
        return summary;   // runTest shows it as the final status
    }
}
let soakStopped = false;
let stopSoakServo = null;   // set while a soak's servo sweeps

$('runConst').onclick = () => runTest('constant speed', constantTest);
$('runRamp').onclick  = () => runTest('ramp moves', rampTest);
$('runGest').onclick  = () => runTest('gesture', gestureTest);
$('runSoak').onclick  = () => { soakStopped = false; runTest('soak', soakTest); };
$('stop').onclick = () => {
    abort = true; soakStopped = true;
    if (stepper && arduino.connected) stepper.hardStop();
    if (stopSoakServo) stopSoakServo();               // the servo stops now too, not when the soak loop unwinds
};
$('clear').onclick = () => { $('results').querySelector('tbody').innerHTML = ''; lines.length = 0; };
$('copy').onclick = () => {
    const text = ['test\tasked\texpected ms\tmeasured ms\tachieved steps/s\tresult', ...lines].join('\n');
    navigator.clipboard.writeText(text).then(() => setStatus('results copied'), () => setStatus('copy failed — select the table instead'));
};
