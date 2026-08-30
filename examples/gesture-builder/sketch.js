// ==============================================================
// Gesture Builder — author expressive bus-servo motion on a timeline
// A browser-only Pardalote tool. Connect ONE bus-servo Arduino (same firmware
// and wiring as the bus-servos example), lay out a multi-row timeline — one row
// per servo, each with its own bus ID — then play the whole thing with
// arduino.gesture({…}) so every servo runs its authored SEGMENT SCHEDULE on-board,
// phase-locked and arriving together (one batched multi-channel frame).
//
// UI: plain DOM + SVG (no p5). The timeline is an <svg> — each keyframe is
// a <circle>, each segment a <path> — inside a natively-scrollable pane, with a
// fixed gutter column of row labels and editable ID fields beside it.
//
//   • + / − buttons in each row's gutter → add a row below / delete the row
//   • double-click a lane to ADD a keyframe; drag a keyframe to set its
//     angle (up/down) and time (left/right)
//   • right-click a segment → set its shape (easing curve)
//   • right-click a keyframe → delete, or "manual set" (free the servo, hand-move
//     the motor, and the keyframe follows to the same angle; click to commit)
//   • drag the last keyframe off the right edge to EXTEND the timeline (it scrolls)
//   • play → each row is one gesture lane, all in one arduino.gesture({…})
//
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

const SVGNS = 'http://www.w3.org/2000/svg';

// --- Output types + value model + timeline geometry --------------------
const MAXV = 4095;                          // ST-series encoder counts (0…4095) — bus-servo default max
const MAX_POINTS = 10, MAX_ROWS = 8, TMAX = 60000;
const CURVES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back'];
const RULER_H = 26, ROW_H = 132, ROW_GAP = 12, VP = 9, PT_R = 6, RIGHT_PAD = 10;
const DEFAULT_TOTAL = 5000;                 // default visible span, ms
const PXMS = 0.15;                          // px per ms — FIXED (5 s ≈ 750 px = the view width)

// Each row is one OUTPUT. This table drives everything type-specific: the actuator
// class, the value unit + default range, the connection fields shown in the gutter,
// how to attach/hold/free/read/write it, and whether hand-posing (needs live feedback)
// is available. Values in each row's `points` are in that output's native unit.
const OUTPUT_TYPES = {
    busservo: {
        label: 'Bus servo', cls: 'BusServo', unit: 'counts', defMax: 4095,
        fields: [{ key: 'id', label: 'ID', def: 1, min: 1, max: 253, w: 43 }],
        make:   () => new BusServo(),
        attach: (s, rw) => s.attach(rw.id, 'ST'),
        canFree: () => true, hasFeedback: true, freeOnConnect: true,
        free:  (s) => s.disableTorque(),
        hold:  (s) => s.enableTorque(),
        cur:   (s) => s.position,
        write: (s, v) => s.write(v),
    },
    servo: {
        label: 'PWM servo', cls: 'Servo', unit: '°', defMax: 180,
        fields: [{ key: 'pin', label: 'Pin', def: 9, min: 0, max: 99, w: 43 }],
        make:   () => new Servo(),
        attach: (s, rw) => s.attach(rw.pin),
        canFree: () => false, hasFeedback: false, freeOnConnect: false,
        cur:   (s) => s.angle,
        write: (s, v) => s.write(v),
    },
    stepper: {
        label: 'Stepper', cls: 'Stepper', unit: 'steps', defMax: 2000,
        fields: [{ key: 'step', label: 'STEP', def: 2, min: 0, max: 99, w: 34 },
                 { key: 'dir',  label: 'DIR',  def: 3, min: 0, max: 99, w: 34 },
                 { key: 'en',   label: 'EN',   def: -1, min: -1, max: 99, w: 34 }],
        make:   () => new Stepper(),
        attach: (s, rw) => s.attach(rw.step, rw.dir, rw.en),
        canFree: (rw) => rw.en !== -1, hasFeedback: false, freeOnConnect: false,
        free:  (s) => s.disable(),
        hold:  (s) => s.enable(),
        cur:   (s) => s.position,
        write: (s, v) => s.moveTo(v),
    },
};
const TYPE = (rw) => OUTPUT_TYPES[rw.type] || OUTPUT_TYPES.busservo;

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-gesture-builder';
const DEFAULTS = {
    ip: '192.168.x.x', transport: 'wifi', rx: 18, tx: 19,
    total: DEFAULT_TOTAL, playFrom: 0,
    rows: [
        { id: 1, points: [ { t: 0, v: 2048, curve: 'easeInOut' }, { t: 2200, v: 3300, curve: 'easeOut' }, { t: 4600, v: 900, curve: 'linear' } ] },
        { id: 2, points: [ { t: 0, v: 2048, curve: 'easeOut' }, { t: 1500, v: 1200, curve: 'easeIn' }, { t: 3400, v: 3000, curve: 'easeInOut' }, { t: 4600, v: 2048, curve: 'linear' } ] },
    ],
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

// The easing shapes — same math as the library's curveShape() / defs.h, so the
// on-screen preview matches what the board plays. `t` in [0,1]; `back` overshoots.
function curveShape(curve, t) {
    switch (curve) {
        case 'easeIn':    return t * t;
        case 'easeOut':   return t * (2 - t);
        case 'easeInOut': return t * t * (3 - 2 * t);
        case 'back': { const k = t - 1; return 1 + 2.70158 * k * k * k + 1.70158 * k * k; }
        default:          return t;   // linear
    }
}

// --- Model state -------------------------------------------------------
let rows = normaliseRows(saved.rows);
let TOTAL = DEFAULT_TOTAL;                   // grows to fit content (recomputeTotal)
let selPoint = null;   // { row, i }
let selSeg = null;     // { row, i }
let dragPt = null;     // { row, i } while dragging a point
let manualPt = null;   // { row, i } while hand-setting a point from the live servo
let limitPose = null;  // { row, min, max } while capturing soft limits from hand movement
let lastPointer = null;
let playing = false, paused = false, playStart = 0, playDur = 0, playBase = 0;
let playedServos = [], gestureSeen = false;   // v1.1 gesture-active tracking (isGesturing)
let playFrom = clamp(Math.round(+saved.playFrom || 0), 0, TMAX);   // start marker: where play begins from stop (ms)
let headTime = playFrom;   // live playhead time (animates while playing, scrubbable while paused)

let arduino, ready = false, manualDisconnect = false, usbBusy = false, rxTxLocked = false;

// --- DOM refs ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const ipEl = $('ip'), transportEl = $('transport'), connectEl = $('connect'), disconnectEl = $('disconnect');
const rxEl = $('rx'), txEl = $('tx');
const gutter = $('gutter'), lanesScroll = $('lanesScroll'), svg = $('lanes'), menuEl = $('ctxmenu');
const codeText = $('codeText'), copyCode = $('copyCode'), outputDialogEl = $('outputDialog');
const inoText = $('inoText'), copyIno = $('copyIno');
const mainEl = document.querySelector('main');
let rulerG, playhead, playheadHandle;
let gutterCells = [];   // per row: { deg, marker, inp }
let laneGroups = [];    // per row: { rect, guide, segsG, ptsG }

// --- helpers -----------------------------------------------------------
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const int = (v) => parseInt(v, 10);
// function declarations (hoisted) — normaliseRows() runs at init, before consts below.
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampInt(v, lo, hi) { const n = Math.round(+v); return Number.isFinite(n) ? clamp(n, lo, hi) : lo; }
const div = (cls) => { const d = document.createElement('div'); if (cls) d.className = cls; return d; };
const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const servoName = (i) => 'seq' + i;

// geometry
const rowTop = (r) => RULER_H + r * (ROW_H + ROW_GAP);
const laneTop = (r) => rowTop(r) + VP;                        // value MAXV
const laneBot = (r) => rowTop(r) + ROW_H + ROW_GAP - VP;      // value 0 — spans the full slot (VP margin top & bottom)
const timeToX = (t) => t * PXMS;
const xToTime = (x) => x / PXMS;
// The value axis spans the row's soft-limit range [min, max]: top = max, bottom = min.
const valToY = (r, v) => { const mn = rows[r].min, mx = rows[r].max; return map(clamp(v, mn, mx), mn, mx, laneBot(r), laneTop(r)); };
const yToVal = (r, y) => { const mn = rows[r].min, mx = rows[r].max; return clamp(map(y, laneBot(r), laneTop(r), mn, mx), mn, mx); };
const svgH = () => RULER_H + rows.length * (ROW_H + ROW_GAP);

// Drag ceiling: bus servos/PWM have a real physical max; steppers are open-ended
// (default max is just a starting point — drag past it).
const hardMax = (rw) => rw.type === 'stepper' ? 1000000 : TYPE(rw).defMax;
function defaultRow() {
    return { type: 'busservo', id: 1, pin: 9, step: 2, dir: 3, en: -1, name: '', on: true, min: 0, max: 4095,
             points: [ { t: 0, v: 2048, curve: 'linear' }, { t: DEFAULT_TOTAL, v: 2048, curve: 'linear' } ] };
}
function normaliseRows(list) {
    const arr = (Array.isArray(list) ? list : []).slice(0, MAX_ROWS).map(r => {
        const type = OUTPUT_TYPES[r.type] ? r.type : 'busservo';
        const t = OUTPUT_TYPES[type], hMax = (type === 'stepper') ? 1000000 : t.defMax;
        const lo = clampInt(r.min == null ? 0 : r.min, 0, hMax);
        const hi = clampInt(r.max == null ? t.defMax : r.max, 0, hMax);
        let min = Math.min(lo, hi), max = Math.max(lo, hi);
        if (max - min < 1) { min = 0; max = t.defMax; }   // never let the axis collapse
        return {
            type,
            id:   clampInt(r.id   == null ? 1  : r.id,   1, 253),
            pin:  clampInt(r.pin  == null ? 9  : r.pin,  0, 99),
            step: clampInt(r.step == null ? 2  : r.step, 0, 99),
            dir:  clampInt(r.dir  == null ? 3  : r.dir,  0, 99),
            en:   clampInt(r.en   == null ? -1 : r.en,  -1, 99),
            name: typeof r.name === 'string' ? r.name.slice(0, 40) : '',   // '' = use the "Output N" default
            on: r.on !== false,   // included in playback (default on)
            min, max,
            points: (Array.isArray(r.points) ? r.points : []).slice(0, MAX_POINTS)
                .map(p => ({ t: clamp(Math.round(+p.t || 0), 0, TMAX), v: clamp(Math.round(+p.v || 0), min, max), curve: CURVES.includes(p.curve) ? p.curve : 'linear' }))
                .sort((a, b) => a.t - b.t),
        };
    });
    return arr.length ? arr : [defaultRow()];
}
function persist() {
    saved.ip = ipEl.value.trim();
    saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
    if (!rxTxLocked) { saved.rx = int(rxEl.value); saved.tx = int(txEl.value); }
    saved.total = TOTAL; saved.playFrom = playFrom;
    saved.rows = rows.map(r => ({ type: r.type, id: r.id, pin: r.pin, step: r.step, dir: r.dir, en: r.en, name: r.name || '', on: r.on !== false, min: r.min, max: r.max, points: r.points.map(p => ({ t: p.t, v: p.v, curve: p.curve })) }));
    localStorage.setItem(STORE, JSON.stringify(saved));
    updateCode();
}

// ---------------------------------------------------------------
// Export the built gesture as runnable Pardalote code
// ---------------------------------------------------------------
// A safe, unique JS identifier from a row's name (fallback: servo<ID>).
function jsIdent(name, fallback, used) {
    let s = (name || '').trim().replace(/[^A-Za-z0-9]+/g, ' ').trim();
    let id = fallback;
    if (s) {
        const w = s.split(/\s+/);
        id = w[0].toLowerCase() + w.slice(1).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('');
        if (!/^[A-Za-z_]/.test(id)) id = 'servo' + id;
    }
    let out = id, n = 2;
    while (used.has(out)) out = id + (n++);
    used.add(out);
    return out;
}
function generateCode() {
    const active = rows.map((rw, r) => ({ rw, r })).filter(({ rw }) => rw.on !== false && rw.points.length);
    if (!active.length) return '// Add keyframes to a row, then the gesture appears here as Pardalote code.';
    const used = new Set();
    // handle follows the label: unnamed → output<N>, named "Left arm" → leftArm (the bus ID lives in attach())
    active.forEach(a => { a.id = jsIdent(rowName(a.rw, a.r), 'output' + (a.r + 1), used); });
    const attachStr = (id, rw) => rw.type === 'servo'   ? `${id}.attach(${rw.pin})`
                                : rw.type === 'stepper' ? `${id}.attach(${rw.step}, ${rw.dir}, ${rw.en})`
                                :                         `${id}.attach(${rw.id}, 'ST')`;
    const descStr = (rw) => rw.type === 'servo'   ? `pin ${rw.pin}`
                          : rw.type === 'stepper' ? `STEP ${rw.step}/DIR ${rw.dir}/EN ${rw.en}`
                          :                         `ID ${rw.id}`;
    const L = [];
    L.push('// Pardalote gesture — built with Gesture Builder');
    L.push('// Outputs: ' + active.map(a => `${a.id} = ${descStr(a.rw)}`).join(', '));
    L.push('const arduino = new Arduino();');
    active.forEach(a => L.push(`arduino.add('${a.id}', new ${TYPE(a.rw).cls}());`));
    L.push(`const { ${active.map(a => a.id).join(', ')} } = arduino;`);
    L.push('');
    // The movement lives in its own function so you can call it from your own trigger.
    L.push('// Call this to play the gesture — from a sensor, a button, an LLM, any command.');
    L.push('function playGesture() {');
    const segLines = (rw, indent) => buildSegments(rw, 0).map(s => `${indent}{ to: ${s.to}, dur: ${s.dur}, curve: '${s.curve}' },`);
    if (active.length === 1) {
        // one channel → the actuator's own gesture(), no group needed
        L.push(`  ${active[0].id}.gesture([`);
        segLines(active[0].rw, '    ').forEach(l => L.push(l));
        L.push('  ], { absolute: true });');
    } else {
        // many channels → one batched multi-channel gesture (start & arrive together)
        L.push('  arduino.gesture({');
        active.forEach((a, i) => {
            L.push(`    ${a.id}: [`);
            segLines(a.rw, '      ').forEach(l => L.push(l));
            L.push(`    ]${i < active.length - 1 ? ',' : ''}`);
        });
        L.push('  }, { absolute: true });');
    }
    L.push('}');
    L.push('');
    L.push("arduino.on('ready', () => {");
    active.forEach(a => {
        let line = `  ${attachStr(a.id, a.rw)};`;
        if (a.rw.min > 0 || a.rw.max < TYPE(a.rw).defMax) line += ` ${a.id}.setLimits(${a.rw.min}, ${a.rw.max});`;
        L.push(line);
    });
    L.push('  playGesture();   // ← runs once on connect as a demo; move this to your own trigger');
    L.push('});');
    L.push('');
    L.push("arduino.connect('192.168.x.x');   // your board's IP — or arduino.connectSerial(PROMPT) for USB");
    return L.join('\n');
}

// ---------------------------------------------------------------
// Export the same gesture as a board-side Arduino sketch (C++)
// ---------------------------------------------------------------
const CURVE_CPP = { linear: 'CURVE_LINEAR', easeIn: 'CURVE_EASE_IN', easeOut: 'CURVE_EASE_OUT', easeInOut: 'CURVE_EASE_IN_OUT', back: 'CURVE_BACK' };
const CPP = {
    busservo: { include: 'PardaloteBusServo.h', obj: 'PardaloteBusServo', device: 'DEVICE_BUSSERVO' },
    servo:    { include: 'PardaloteServo.h',    obj: 'PardaloteServo',    device: 'DEVICE_SERVO' },
    stepper:  { include: 'PardaloteStepper.h',  obj: 'PardaloteStepper',  device: 'DEVICE_STEPPER' },
};
const cppAttachArgs = (id, rw) => rw.type === 'servo'   ? `"${id}", ${rw.pin}`
                                : rw.type === 'stepper' ? `"${id}", ${rw.step}, ${rw.dir}, ${rw.en}`
                                :                         `"${id}", ${rw.id}`;
function generateArduinoCode() {
    const active = rows.map((rw, r) => ({ rw, r })).filter(({ rw }) => rw.on !== false && rw.points.length);
    if (!active.length) return '// Add keyframes to a row, then the Arduino sketch appears here.';
    const used = new Set();
    active.forEach(a => { a.id = jsIdent(rowName(a.rw, a.r), 'output' + (a.r + 1), used); });
    const descStr = (rw) => rw.type === 'servo' ? `pin ${rw.pin}` : rw.type === 'stepper' ? `STEP ${rw.step}/DIR ${rw.dir}/EN ${rw.en}` : `ID ${rw.id}`;
    const L = [];
    L.push('// Pardalote gesture — built with Gesture Builder (board-side Arduino sketch)');
    L.push('// Outputs: ' + active.map(a => `${a.id} = ${descStr(a.rw)}`).join(', '));
    L.push('#include <Pardalote.h>');
    [...new Set(active.map(a => CPP[a.rw.type].include))].forEach(inc => L.push(`#include <${inc}>`));
    L.push('');
    L.push(`int ${active.map(a => a.id).join(', ')};   // logical ids from attach()`);
    L.push('');
    L.push('// The authored gesture — absolute targets. Each segment is { curve, duration-ms, value }.');
    L.push('// static const arrays live in flash (32-bit boards) at no RAM cost.');
    active.forEach(a => {
        L.push(`static const PardaloteSeg ${a.id}Segs[] = {`);
        buildSegments(a.rw, 0).forEach(s => L.push(`  { ${CURVE_CPP[s.curve]}, ${s.dur}, ${s.to} },`));
        L.push('};');
    });
    L.push('');
    L.push('// Call this to play the gesture — from a button, a sensor, any input.');
    L.push('void playGesture() {');
    if (active.length === 1) {
        const a = active[0];
        L.push(`  ${CPP[a.rw.type].obj}.gesture(${a.id}, ${a.id}Segs, ${buildSegments(a.rw, 0).length});`);
    } else {
        L.push('  Pardalote.gesture()');
        active.forEach(a => L.push(`    .add(${CPP[a.rw.type].device}, ${a.id}, ${a.id}Segs, ${buildSegments(a.rw, 0).length})`));
        L.push('    .play();');
    }
    L.push('}');
    L.push('');
    L.push('void setup() {');
    L.push('  Pardalote.begin();');
    active.forEach(a => L.push(`  ${a.id} = ${CPP[a.rw.type].obj}.attach(${cppAttachArgs(a.id, a.rw)});`));
    L.push('  playGesture();   // ← runs once at startup as a demo; move this to your own trigger');
    L.push('}');
    L.push('');
    L.push('void loop() {');
    L.push('  Pardalote.run();');
    L.push('}');
    return L.join('\n');
}
// Minimal JS syntax highlighter — wraps tokens in Pygments-style spans so the
// exported code reads like the docs reference pages (styled in style.css).
const CODE_KEYWORDS = new Set(['const', 'let', 'var', 'new', 'function', 'return', 'if', 'else',
    'for', 'while', 'do', 'of', 'in', 'typeof', 'instanceof', 'await', 'async', 'class', 'extends',
    'super', 'this', 'import', 'from', 'export', 'true', 'false', 'null', 'undefined', 'void', 'delete',
    // C++ (for the Arduino panel)
    'static', 'int', 'uint8_t', 'uint16_t', 'int32_t', 'bool', 'float', 'char', 'unsigned', 'short', 'long', 'struct', 'enum']);
const codeEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlightCode(code) {
    const OP = '=+-*/%<>!&|?', isId = (c) => /[A-Za-z0-9_$]/.test(c);
    let out = '', i = 0; const n = code.length;
    while (i < n) {
        const c = code[i];
        // C++ preprocessor line — colour the directive + the include path (JS never hits this)
        if (c === '#' && (i === 0 || code[i - 1] === '\n')) {
            let j = i; while (j < n && code[j] !== '\n') j++;
            const m = code.slice(i, j).match(/^(#\s*[a-z]+)(\s*)(<[^>]*>|"[^"]*")?(.*)$/);
            if (m) { out += `<span class="k">${codeEsc(m[1])}</span>${codeEsc(m[2])}`; if (m[3]) out += `<span class="s1">${codeEsc(m[3])}</span>`; out += codeEsc(m[4] || ''); }
            else out += `<span class="k">${codeEsc(code.slice(i, j))}</span>`;
            i = j; continue;
        }
        if (c === '/' && code[i + 1] === '/') { let j = i + 2; while (j < n && code[j] !== '\n') j++; out += `<span class="c1">${codeEsc(code.slice(i, j))}</span>`; i = j; continue; }
        if (c === "'" || c === '"' || c === '`') { const q = c; let j = i + 1; while (j < n && code[j] !== q) { if (code[j] === '\\') j++; j++; } j = Math.min(j + 1, n); out += `<span class="s1">${codeEsc(code.slice(i, j))}</span>`; i = j; continue; }
        if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9.]/.test(code[j])) j++; out += `<span class="mi">${codeEsc(code.slice(i, j))}</span>`; i = j; continue; }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i + 1; while (j < n && isId(code[j])) j++; const w = code.slice(i, j);
            let cls; if (CODE_KEYWORDS.has(w)) cls = 'k';
            else { let k = j; while (k < n && /\s/.test(code[k])) k++; cls = code[k] === '(' ? 'nf' : (w.length > 1 && /^[A-Z0-9_]+$/.test(w) ? 'no' : 'nx'); }
            out += `<span class="${cls}">${codeEsc(w)}</span>`; i = j; continue;
        }
        if ('{}()[],;.:'.includes(c)) { out += `<span class="p">${codeEsc(c)}</span>`; i++; continue; }
        if (OP.includes(c)) { let j = i; while (j < n && OP.includes(code[j])) j++; out += `<span class="o">${codeEsc(code.slice(i, j))}</span>`; i = j; continue; }
        out += codeEsc(c); i++;
    }
    return out;
}
let lastCode = '', lastIno = '';
function updateCode() {
    if (codeText) { lastCode = generateCode(); codeText.innerHTML = highlightCode(lastCode); }
    if (inoText) { lastIno = generateArduinoCode(); inoText.innerHTML = highlightCode(lastIno); }
}
function selectCode(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function recomputeTotal() {
    let mx = 0;
    for (const rw of rows) for (const p of rw.points) if (p.t > mx) mx = p.t;
    TOTAL = Math.min(TMAX, Math.max(DEFAULT_TOTAL, mx));
}
// The x where the content ends = the furthest keyframe (min 5 s). Native
// scroll can't go past this, so you can never scroll right of the last keyframe.
function furthestX() {
    let mx = 0;
    for (const rw of rows) for (const p of rw.points) if (p.t > mx) mx = p.t;
    // End a little PAST the last keyframe so its full circle shows at the edge
    // (it sits right on the content boundary once the timeline is extended).
    // The 5 s floor keeps the default view scrollbar-free.
    return Math.max(DEFAULT_TOTAL * PXMS, Math.min(TMAX, mx) * PXMS + RIGHT_PAD);
}
function busPins() {
    const rx = parseInt(rxEl.value, 10), tx = parseInt(txEl.value, 10);
    return { rxPin: Number.isFinite(rx) ? rx : -1, txPin: Number.isFinite(tx) ? tx : -1 };
}

// -------------------------------------------------------------------
// Build the gutter (row labels + ID fields) and the SVG skeleton
// -------------------------------------------------------------------
// A row's display label: its custom name, or the positional "Row N" default.
// Default label is "Output N" (position-based, type-neutral for future non-servo outputs).
const rowName = (rw, r) => (rw.name && rw.name.length) ? rw.name : 'Output ' + (r + 1);

// Click a row label to rename it: swap the text for an input, commit on Enter/blur,
// cancel on Escape. A blank entry (or the plain "Row N" default) clears the custom
// name, so the label falls back to the positional default and renumbers on its own.
function startRename(r, nameEl) {
    if (nameEl.querySelector('input')) return;   // already editing
    const cur = rows[r].name || '';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'rl-name-edit'; input.maxLength = 40;
    input.value = rowName(rows[r], r);
    nameEl.textContent = ''; nameEl.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const finish = (save) => {
        if (done) return; done = true;
        const v = save ? input.value.trim() : cur;
        rows[r].name = (v === '' || v === 'Output ' + (r + 1)) ? '' : v;
        persist();
        nameEl.textContent = rowName(rows[r], r);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('contextmenu', (e) => e.stopPropagation());
}

function buildGutter() {
    gutter.innerHTML = '';
    const corner = div('corner'); corner.style.height = RULER_H + 'px'; corner.textContent = 'time →';
    gutter.appendChild(corner);
    gutterCells = [];
    rows.forEach((rw, r) => {
        const t = TYPE(rw);
        // cell fills the full row SLOT (ROW_H + ROW_GAP) so the divider sits at the
        // slot bottom and every row — the first included — has its content at the top.
        const cell = div('rowlabel'); cell.style.height = (ROW_H + ROW_GAP) + 'px'; cell.dataset.row = r;
        const name = div('rl-name'); name.textContent = rowName(rw, r); name.title = 'click to rename';
        name.addEventListener('click', () => startRename(r, name));
        // output summary (type + connection) — click opens the settings dialog
        const output = div('rl-output'); output.textContent = outputSummary(rw); output.title = 'output settings — type & pins';
        output.addEventListener('click', (e) => openOutputDialog(r, e));
        const deg = div('rl-deg'); deg.textContent = '—';
        // per-output controls: "on" includes it in playback; "free" releases it (greyed when the type can't be freed)
        const ctrls = div('rl-ctrls');
        const onLbl = document.createElement('label'); onLbl.className = 'rl-on'; onLbl.title = 'include this output when you press play';
        const onChk = document.createElement('input'); onChk.type = 'checkbox'; onChk.checked = rw.on !== false;
        onChk.addEventListener('change', () => setRowOn(r, onChk.checked));
        onLbl.append(onChk, 'on');
        const freeBtn = document.createElement('button'); freeBtn.className = 'rl-free'; freeBtn.textContent = 'free'; freeBtn.title = 'release this output so you can hand-pose it (toggle)';
        freeBtn.onclick = () => freeRow(r);
        ctrls.append(onLbl, freeBtn);
        // soft-limit handles — top/bottom of the value area (positioned in JS so ROW_H changes need no CSS edit)
        const st = div('rl-scale rl-scale-top'); st.textContent = rw.max; st.style.top = VP + 'px'; st.title = 'drag to set the max soft limit · right-click to pose/reset';
        st.addEventListener('pointerdown', (e) => startLimitDrag(e, r, 'max'));
        st.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showMenu(limitMenuItems(r), e.clientX, e.clientY); });
        const sb = div('rl-scale rl-scale-bot'); sb.textContent = rw.min; sb.style.top = (ROW_H + ROW_GAP - VP) + 'px'; sb.title = 'drag to set the min soft limit · right-click to pose/reset';
        sb.addEventListener('pointerdown', (e) => startLimitDrag(e, r, 'min'));
        sb.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showMenu(limitMenuItems(r), e.clientX, e.clientY); });
        const marker = div('rl-marker');
        // + / − controls: + adds a row below this one, − deletes this row
        const btns = div('rl-btns');
        const addBtn = document.createElement('button'); addBtn.className = 'rl-btn'; addBtn.textContent = '+'; addBtn.title = 'add a row below';
        addBtn.onclick = () => addRowAt(r + 1);
        const delBtn = document.createElement('button'); delBtn.className = 'rl-btn'; delBtn.textContent = '−'; delBtn.title = 'delete this row';
        delBtn.onclick = () => deleteRow(r);
        btns.append(addBtn, delBtn);
        if (rw.on === false) cell.classList.add('off');
        cell.append(name, output, deg, ctrls, st, sb, marker, btns);
        cell.addEventListener('contextmenu', (e) => e.preventDefault());   // no browser menu (row controls are the +/− buttons)
        gutter.appendChild(cell);
        gutterCells.push({ deg, marker, cell, scaleTop: st, scaleBot: sb, freeBtn, output });
    });
    updateFreeButtons();
}
function buildLanes() {
    svg.innerHTML = '';
    rulerG = svgEl('g', { class: 'ruler' });
    svg.appendChild(rulerG);
    laneGroups = [];
    rows.forEach((rw, r) => {
        const g = svgEl('g', {});
        // rect fills the whole slot (ROW_H + ROW_GAP) so a highlighted lane reaches the
        // row divider with no unfilled band at the bottom.
        const rect = svgEl('rect', { class: 'lane', x: 0, y: rowTop(r), height: ROW_H + ROW_GAP });
        const guide = svgEl('line', { class: 'guide', x1: 0, y1: (laneTop(r) + laneBot(r)) / 2, y2: (laneTop(r) + laneBot(r)) / 2 });
        const segsG = svgEl('g', {}), ptsG = svgEl('g', {});
        g.append(rect, guide, segsG, ptsG);
        // divider between this row and the next — matches the gutter's row rule and
        // keeps adjacent filled (off/selected) rows visually separated.
        let divider = null;
        if (r < rows.length - 1) {
            const dy = rowTop(r) + ROW_H + ROW_GAP - 0.5;
            divider = svgEl('line', { class: 'lane-div', x1: 0, x2: 0, y1: dy, y2: dy });
            g.append(divider);
        }
        svg.appendChild(g);
        laneGroups.push({ rect, guide, segsG, ptsG, divider });
    });
    // Playhead — always visible: marks where play starts, animates during playback.
    playhead = svgEl('line', { class: 'playhead', y1: RULER_H });
    playheadHandle = svgEl('path', { class: 'playhead-handle', d: `M -6 ${RULER_H - 9} L 6 ${RULER_H - 9} L 0 ${RULER_H} Z` });
    svg.append(playhead, playheadHandle);
    positionPlayhead(headTime);
}
// Move the playhead line + handle to time t (ms).
function positionPlayhead(t) {
    if (!playhead) return;
    const x = timeToX(clamp(t, 0, TMAX));
    playhead.setAttribute('x1', x); playhead.setAttribute('x2', x); playhead.setAttribute('y2', svgH());
    playheadHandle.setAttribute('transform', `translate(${x},0)`);
}
function resizeSvg() {
    // Content ends at the furthest keyframe, but never shrink below the current view
    // (so releasing / scrolling never yanks the position), and never shrink while
    // dragging (grow-only — the timeline doesn't contract under the cursor).
    let w = Math.max(furthestX(), lanesScroll.scrollLeft + lanesScroll.clientWidth);
    if (dragPt) w = Math.max(w, +svg.getAttribute('width') || 0);
    const h = svgH();
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    laneGroups.forEach((lg) => { lg.rect.setAttribute('width', w); lg.guide.setAttribute('x2', w); if (lg.divider) lg.divider.setAttribute('x2', w); });
    buildRuler(w);
    if (!playing) positionPlayhead(headTime);   // keep the resting/paused playhead spanning the new height
}
function buildRuler(w) {
    rulerG.innerHTML = '';
    // transparent grab strip so the whole ruler shows the playhead cursor and is draggable
    rulerG.appendChild(svgEl('rect', { class: 'ruler-hit', x: 0, y: 0, width: w, height: RULER_H }));
    rulerG.appendChild(svgEl('line', { class: 'ruler-base', x1: 0, y1: RULER_H - 1, x2: w, y2: RULER_H - 1 }));
    const step = 1000;   // 1 s ticks (fixed scale)
    for (let t = 0; timeToX(t) <= w + 1 && t <= TMAX; t += step) {
        const x = timeToX(t);
        rulerG.appendChild(svgEl('line', { class: 'tick', x1: x, y1: RULER_H - 5, x2: x, y2: RULER_H - 1 }));
        const first = t === 0;
        const lbl = svgEl('text', { class: 'ticklbl', x: first ? 3 : x, y: RULER_H / 2 - 1 });
        // the 0 label is at the very left edge — left-anchor it so it isn't clipped
        // (inline style beats the stylesheet's text-anchor: middle)
        if (first) lbl.style.textAnchor = 'start';
        lbl.textContent = t >= 1000 ? (t / 1000) + 's' : t + 'ms';
        rulerG.appendChild(lbl);
    }
}
// Rebuild one row's segments + keyframes from state.
function renderRow(r) {
    const lg = laneGroups[r], rw = rows[r];
    lg.rect.setAttribute('class', 'lane' + (selectedRow(r) ? ' sel' : '') + (rw.on === false ? ' off' : ''));
    lg.segsG.innerHTML = ''; lg.ptsG.innerHTML = '';
    for (let i = 0; i < rw.points.length - 1; i++) {
        const p0 = rw.points[i], p1 = rw.points[i + 1], d = segPath(r, p0, p1);
        const sel = isSelSeg(r, i);
        lg.segsG.appendChild(svgEl('path', { class: 'seghit', d, 'data-row': r, 'data-i': i }));
        lg.segsG.appendChild(svgEl('path', { class: 'seg' + (sel ? ' sel' : ''), d, 'data-row': r, 'data-i': i }));
    }
    rw.points.forEach((p, i) => {
        lg.ptsG.appendChild(svgEl('circle', { class: 'pt' + (isPosing(r, i) ? ' posing' : (isSelPt(r, i) ? ' sel' : '')), cx: timeToX(p.t), cy: valToY(r, p.v), r: PT_R, 'data-row': r, 'data-i': i }));
    });
}
function renderAll() { rows.forEach((_, r) => renderRow(r)); }
// Drag a soft-limit label up/down to change its value (the label stays put; only the
// number changes). Up = higher. Hard-capped at [0, MAXV]; a min GAP keeps min < max.
function startLimitDrag(e, r, which) {
    if (e.button !== 0) return;   // left-drag only (right-click opens the pose/reset menu)
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY, startVal = rows[r][which];
    const cpp = TYPE(rows[r]).defMax / (laneBot(r) - laneTop(r));   // native units per pixel (visual scale)
    const GAP = 1, HI = hardMax(rows[r]);
    const labelEl = gutterCells[r][which === 'max' ? 'scaleTop' : 'scaleBot'];
    const move = (ev) => {
        let v = startVal + Math.round((startY - ev.clientY) * cpp);   // drag up → value up
        v = (which === 'max') ? clamp(v, rows[r].min + GAP, HI) : clamp(v, 0, rows[r].max - GAP);
        rows[r][which] = v;
        labelEl.textContent = v;
        renderRow(r);   // rescale the keyframes to the new axis
    };
    const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        rows[r].points.forEach(p => p.v = clamp(p.v, rows[r].min, rows[r].max));   // keep keys in range
        renderRow(r);
        const s = ready && arduino[servoName(r)];
        if (s && s.setLimits) s.setLimits(rows[r].min, rows[r].max);
        persist();
        setStatus(`${rowName(rows[r], r)} limits ${rows[r].min}–${rows[r].max} ${TYPE(rows[r]).unit}`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
}
// Compact gutter summary of a row's output — click it to open the settings dialog.
function outputSummary(rw) {
    const conn = rw.type === 'servo'   ? `pin ${rw.pin}`
               : rw.type === 'stepper' ? `${rw.step}/${rw.dir}/${rw.en}`
               :                         `ID ${rw.id}`;
    return `${TYPE(rw).label} · ${conn}`;
}
function refreshOutputSummary(r) { const c = gutterCells[r]; if (c && c.output) c.output.textContent = outputSummary(rows[r]); }
function setOutputType(r, type) {
    const rw = rows[r];
    if (!OUTPUT_TYPES[type] || rw.type === type) return;
    const oldDefMax = TYPE(rw).defMax, nMax = OUTPUT_TYPES[type].defMax;
    // convert keyframes to the new unit (proportional to each type's default range)
    rw.points.forEach(p => { p.v = clamp(Math.round(p.v / oldDefMax * nMax), 0, nMax); });
    rw.type = type; rw.min = 0; rw.max = nMax; rw.freed = false;
    ensureActuator(r);
    if (ready) { const s = arduino[servoName(r)]; if (s && s.isAttached && s.detach) s.detach(); bindRow(r); }
    rebuildAllDom(); persist();
    if (outputDialogRow === r) renderOutputDialog();   // keep the open dialog in sync
    setStatus(`${rowName(rw, r)} → ${OUTPUT_TYPES[type].label}`);
}

// -------- Floating per-output settings dialog (type + connection pins) --------
// Changes apply live (so you see the type switch on the timeline); OK keeps them,
// Cancel / × / Esc / click-away revert to the snapshot taken when the dialog opened.
let outputDialogRow = null, outputDialogSnapshot = null;
function openOutputDialog(r, ev) {
    outputDialogRow = r;
    outputDialogSnapshot = JSON.parse(JSON.stringify(rows[r]));   // for Cancel
    renderOutputDialog();
    outputDialogEl.hidden = false;
    const w = outputDialogEl.offsetWidth, h = outputDialogEl.offsetHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth || 2000;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1000;
    let x = (ev ? ev.clientX : 140) + 8, y = (ev ? ev.clientY : 90);
    outputDialogEl.style.left = Math.max(8, Math.min(x, vw - w - 8)) + 'px';
    outputDialogEl.style.top  = Math.max(8, Math.min(y, vh - h - 8)) + 'px';
    document.addEventListener('mousedown', onOutputDialogAway, true);
}
function endOutputDialog() {
    outputDialogRow = null; outputDialogSnapshot = null; outputDialogEl.hidden = true;
    document.removeEventListener('mousedown', onOutputDialogAway, true);
}
function confirmOutputDialog() { endOutputDialog(); }   // OK — changes already applied + persisted live
function cancelOutputDialog() {
    const r = outputDialogRow;
    if (r != null && outputDialogSnapshot) {
        rows[r] = outputDialogSnapshot;   // revert type / pins / rescaled keys / limits
        ensureActuator(r);
        if (ready) { const s = arduino[servoName(r)]; if (s && s.isAttached && s.detach) s.detach(); bindRow(r); }
        rebuildAllDom(); persist();
    }
    endOutputDialog();
}
function onOutputDialogAway(e) { if (!outputDialogEl.contains(e.target)) cancelOutputDialog(); }
function startDialogDrag(e) {
    if (e.target.classList.contains('od-close')) return;   // the × isn't a drag handle
    e.preventDefault();
    const rect = outputDialogEl.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const move = (ev) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 2000;
        const vh = window.innerHeight || document.documentElement.clientHeight || 1000;
        outputDialogEl.style.left = Math.max(8, Math.min(ev.clientX - offX, vw - outputDialogEl.offsetWidth  - 8)) + 'px';
        outputDialogEl.style.top  = Math.max(8, Math.min(ev.clientY - offY, vh - outputDialogEl.offsetHeight - 8)) + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
}
function renderOutputDialog() {
    const r = outputDialogRow; if (r == null) return;
    const rw = rows[r], t = TYPE(rw), dlg = outputDialogEl;
    dlg.innerHTML = '';
    const head = div('od-head'); head.append(rowName(rw, r) + ' — settings');
    head.addEventListener('mousedown', startDialogDrag);   // drag the dialog by its header
    const x = document.createElement('button'); x.className = 'od-close'; x.textContent = '×'; x.title = 'cancel'; x.onclick = cancelOutputDialog;
    head.appendChild(x); dlg.appendChild(head);
    // type buttons
    const typeRow = div('od-types');
    Object.keys(OUTPUT_TYPES).forEach(type => {
        const b = document.createElement('button');
        b.className = 'od-type' + (rw.type === type ? ' active' : '');
        b.textContent = OUTPUT_TYPES[type].label;
        b.onclick = () => setOutputType(r, type);   // re-renders the dialog itself
        typeRow.appendChild(b);
    });
    dlg.appendChild(typeRow);
    // connection fields for the current type
    const fieldsRow = div('od-fields');
    t.fields.forEach(f => {
        const fld = div('od-field');
        const lab = document.createElement('label'); lab.textContent = f.label;
        const inp = document.createElement('input'); inp.type = 'number'; inp.value = rw[f.key]; inp.min = f.min; inp.max = f.max;
        inp.onchange = () => { rw[f.key] = clampInt(inp.value, f.min, f.max); inp.value = rw[f.key]; persist(); reattachRow(r); updateFreeButtons(); refreshOutputSummary(r); };
        fld.append(lab, inp); fieldsRow.appendChild(fld);
    });
    dlg.appendChild(fieldsRow);
    const note = div('od-note');
    note.textContent = t.hasFeedback ? 'Reports position — pose & free available.'
                     : rw.type === 'stepper' ? 'No position feedback. Free needs an EN pin (−1 = none).'
                     : 'No position feedback. PWM servos always hold — no free.';
    dlg.appendChild(note);
    // OK / Cancel
    const actions = div('od-actions');
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'od-btn'; cancelBtn.textContent = 'cancel'; cancelBtn.onclick = cancelOutputDialog;
    const okBtn = document.createElement('button'); okBtn.className = 'od-btn od-ok'; okBtn.textContent = 'OK'; okBtn.onclick = confirmOutputDialog;
    actions.append(cancelBtn, okBtn); dlg.appendChild(actions);
}
// Right-click menu on a limit label: pose the range by hand (bus servo only), or reset to the type's default.
const limitMenuItems = (r) => {
    const items = [];
    if (TYPE(rows[r]).hasFeedback) items.push({ label: 'pose limits', action: () => startPoseLimits(r) });
    items.push({ label: 'reset', action: () => resetLimits(r) });
    return items;
};
function setLimitLabels(r) {
    const cell = gutterCells[r];
    if (cell) { cell.scaleTop.textContent = rows[r].max; cell.scaleBot.textContent = rows[r].min; }
}
// Pose limits: free the servo; min/max then follow the range you hand-move it through
// (tick captures the extremes). Click commits, Esc cancels — like "pose servo".
function startPoseLimits(r) {
    if (!TYPE(rows[r]).hasFeedback) { setStatus('pose limits needs a bus servo (live position)'); return; }
    if (!ready) { setStatus('connect the board first'); return; }
    const s = arduino[servoName(r)];
    if (s.present === false) { setStatus(`${rowName(rows[r], r)} not found`); return; }
    const pos = clamp(Math.round(s.position >= 0 ? s.position : MAXV / 2), 0, MAXV);
    limitPose = { row: r, min: pos, max: pos };
    s.disableTorque(); rows[r].freed = true; updateFreeButtons();
    setStatus('pose limits — move the motor through its range, then click to set (Esc cancels)');
}
function commitPoseLimits() {
    if (!limitPose) return;
    const { row: r } = limitPose;
    let mn = limitPose.min, mx = limitPose.max; limitPose = null;
    if (mx - mn < 1) mx = Math.min(MAXV, mn + 1);   // never collapse the axis
    rows[r].min = mn; rows[r].max = mx;
    rows[r].points.forEach(p => p.v = clamp(p.v, mn, mx));
    const s = arduino[servoName(r)];
    if (s) { s.enableTorque(); s.setLimits(mn, mx); }
    rows[r].freed = false; updateFreeButtons();
    setLimitLabels(r); renderRow(r); persist();
    setStatus(`${rowName(rows[r], r)} limits ${mn}–${mx} ${TYPE(rows[r]).unit}`);
}
function cancelPoseLimits() {
    if (!limitPose) return;
    const { row: r } = limitPose; limitPose = null;
    const s = arduino[servoName(r)];
    if (s) s.enableTorque();
    rows[r].freed = false; updateFreeButtons();
    setLimitLabels(r);   // restore the unchanged values
    setStatus(`${rowName(rows[r], r)} pose limits cancelled`);
}
function resetLimits(r) {
    const dMax = TYPE(rows[r]).defMax;
    rows[r].min = 0; rows[r].max = dMax;
    rows[r].points.forEach(p => p.v = clamp(p.v, 0, dMax));
    const s = ready && arduino[servoName(r)];
    if (s && s.clearLimits) s.clearLimits();
    setLimitLabels(r); renderRow(r); persist();
    setStatus(`${rowName(rows[r], r)} limits reset (0–${dMax})`);
}
function segPath(r, p0, p1) {
    const x0 = timeToX(p0.t), x1 = timeToX(p1.t), STEPS = 26;
    let d = '';
    for (let k = 0; k <= STEPS; k++) {
        const u = k / STEPS, vv = lerp(p0.v, p1.v, curveShape(p0.curve, u));
        d += (k ? 'L' : 'M') + lerp(x0, x1, u).toFixed(1) + ' ' + valToY(r, vv).toFixed(1) + ' ';
    }
    return d;
}
// Full structural rebuild (rows added/removed).
function rebuildAllDom() { ensureAllActuators(); buildGutter(); buildLanes(); resizeSvg(); renderAll(); }

// -------------------------------------------------------------------
// Selection + segment shape
// -------------------------------------------------------------------
const isSelPt = (r, i) => selPoint && selPoint.row === r && selPoint.i === i;
const isPosing = (r, i) => manualPt && manualPt.row === r && manualPt.i === i;   // "pose servo" in progress
const isSelSeg = (r, i) => selSeg && selSeg.row === r && selSeg.i === i;
const selectedRow = (r) => (selPoint && selPoint.row === r) || (selSeg && selSeg.row === r);
function selectPoint(r, i) { const old = selPoint, oldSeg = selSeg; selPoint = { row: r, i }; selSeg = null; touchRows(old, oldSeg, r); }
function selectSeg(r, i) { const old = selPoint, oldSeg = selSeg; selSeg = { row: r, i }; selPoint = null; touchRows(old, oldSeg, r); }
function clearSelection() { const old = selPoint, oldSeg = selSeg; selPoint = null; selSeg = null; touchRows(old, oldSeg, -1); }
function touchRows(old, oldSeg, r) {
    const set = new Set();
    if (old) set.add(old.row); if (oldSeg) set.add(oldSeg.row); if (r >= 0) set.add(r);
    set.forEach(rr => { if (rr < rows.length) renderRow(rr); });
}
// Set one segment's easing curve (from the segment's right-click menu).
function setShape(r, i, curve) {
    rows[r].points[i].curve = curve;
    renderRow(r); persist();
    showSegStatus(r, i);
}

// -------------------------------------------------------------------
// Coordinate mapping (client → svg-internal, scroll-aware via rect)
// -------------------------------------------------------------------
function svgXYc(cx, cy) { const r = svg.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; }
function rowAtY(y) { for (let r = 0; r < rows.length; r++) if (y >= rowTop(r) && y <= rowTop(r) + ROW_H) return r; return -1; }

// -------------------------------------------------------------------
// Points — add / delete / drag
// -------------------------------------------------------------------
function addPointAt(cx, cy) {
    const { x, y } = svgXYc(cx, cy);
    const r = rowAtY(y); if (r < 0) return;
    const pts = rows[r].points;
    if (pts.length >= MAX_POINTS) { setStatus(`max ${MAX_POINTS} keys per row`); return; }
    const nt = clamp(Math.round(xToTime(x)), 0, TMAX), nv = clamp(Math.round(yToVal(r, y)), rows[r].min, rows[r].max);
    pts.push({ t: nt, v: nv, curve: 'linear' });
    pts.sort((a, b) => a.t - b.t);
    selPoint = { row: r, i: pts.findIndex(p => p.t === nt && p.v === nv) }; selSeg = null;
    recomputeTotal(); resizeSvg(); renderRow(r); persist(); showPointStatus(r, selPoint.i);
}
function deletePoint(r, i) {
    rows[r].points.splice(i, 1);
    if (selPoint && selPoint.row === r) selPoint = null;
    selSeg = null; recomputeTotal(); resizeSvg(); renderRow(r); persist();
    setStatus('key deleted');
}
function startPointDrag(e, r, i) {
    selectPoint(r, i); dragPt = { row: r, i }; lastPointer = { cx: e.clientX, cy: e.clientY };
    svg.setPointerCapture(e.pointerId);
    showPointStatus(r, i);
}
function applyDragAt(cx, cy) {
    const { x, y } = svgXYc(cx, cy);
    const { row: r, i } = dragPt, pts = rows[r].points;
    const tmin = i > 0 ? pts[i - 1].t + 1 : 0;
    const tmax = i < pts.length - 1 ? pts[i + 1].t - 1 : TMAX;   // last keyframe extends the timeline
    pts[i].t = Math.round(clamp(xToTime(x), tmin, tmax));
    pts[i].v = Math.round(yToVal(r, y));
    resizeSvg(); renderRow(r); showPointStatus(r, i);   // resizeSvg is grow-only while dragging
}
// --- Editable status readout: type values in for precise manual entry ---
// A compact number field in the status line; commit() clamps and returns the
// stored value, which is written back so the field always shows what was saved.
function statusNum(value, commit) {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'status-num'; inp.value = value;
    const done = () => { inp.value = commit(inp.value); };
    inp.addEventListener('change', done);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    return inp;
}
function statusCurve(r, i) {
    const sel = document.createElement('select'); sel.className = 'status-sel';
    CURVES.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === rows[r].points[i].curve) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => setShape(r, i, sel.value));   // renders + persists + re-shows status
    sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    return sel;
}
function statusLine(prefix, parts) {
    statusEl.textContent = ''; statusEl.append('info: ' + prefix);
    parts.forEach(p => statusEl.append(p));
}
function showPointStatus(r, i) {
    const p = rows[r].points[i];
    statusLine(`${rowName(rows[r], r)}, key ${i + 1} : `, [
        statusNum(p.t, (v) => setKeyTime(r, i, v)), ' ms · ',
        statusNum(p.v, (v) => setKeyValue(r, i, v)), ' ' + TYPE(rows[r]).unit,
    ]);
}
// Segment i runs points[i] → points[i+1] and carries points[i]'s easing curve.
function showSegStatus(r, i) {
    const pts = rows[r].points;
    statusLine(`${rowName(rows[r], r)}, segment ${i + 1} : `, [
        statusNum(pts[i + 1].t - pts[i].t, (v) => setSegDur(r, i, v)), ' ms · ',
        statusCurve(r, i),
    ]);
}
// Manual-entry setters — clamp like the drag paths, then re-render/persist.
function setKeyTime(r, i, val) {
    const pts = rows[r].points;
    const tmin = i > 0 ? pts[i - 1].t + 1 : 0;
    const tmax = i < pts.length - 1 ? pts[i + 1].t - 1 : TMAX;
    pts[i].t = clampInt(val, tmin, tmax);
    recomputeTotal(); resizeSvg(); renderRow(r); persist();
    return pts[i].t;
}
function setKeyValue(r, i, val) {
    rows[r].points[i].v = clampInt(val, rows[r].min, rows[r].max);
    renderRow(r); persist();
    return rows[r].points[i].v;
}
function setSegDur(r, i, val) {
    const pts = rows[r].points;
    const maxDur = (i + 2 < pts.length) ? pts[i + 2].t - pts[i].t - 1 : TMAX - pts[i].t;
    const dur = clampInt(val, 1, maxDur);
    pts[i + 1].t = pts[i].t + dur;
    recomputeTotal(); resizeSvg(); renderRow(r); persist();
    return dur;
}

// -------------------------------------------------------------------
// Context menus (generic) — rows, segments, keyframes
// items: [{ label, action, active? }]
// -------------------------------------------------------------------
function showMenu(items, cx, cy) {
    menuEl.innerHTML = '';
    items.forEach(it => {
        const b = document.createElement('button');
        b.textContent = it.label;
        if (it.active) b.classList.add('active');
        b.onclick = () => { hideMenu(); it.action(); };
        menuEl.appendChild(b);
    });
    const mr = mainEl.getBoundingClientRect();
    menuEl.style.left = (cx - mr.left) + 'px';
    menuEl.style.top = (cy - mr.top) + 'px';
    menuEl.hidden = false;
    setTimeout(() => document.addEventListener('mousedown', onDocDownHide), 0);
}
function hideMenu() { menuEl.hidden = true; document.removeEventListener('mousedown', onDocDownHide); }
function onDocDownHide(e) { if (!menuEl.contains(e.target)) hideMenu(); }

const segMenuItems = (r, i) => CURVES.map(c => ({ label: c, active: c === rows[r].points[i].curve, action: () => setShape(r, i, c) }));
const pointMenuItems = (r, i) => {
    const items = [{ label: 'delete', action: () => deletePoint(r, i) }];
    if (TYPE(rows[r]).hasFeedback) items.push({ label: 'pose servo', action: () => manualSet(r, i) });   // bus servo only
    return items;
};

// Manual set — free the row's servo so it can be hand-moved; the keyframe's angle
// tracks the live servo position (see tick) until the next click commits it.
function manualSet(r, i) {
    if (!TYPE(rows[r]).hasFeedback) { setStatus('pose servo needs a bus servo (live position)'); return; }
    if (!ready) { setStatus('connect the board first'); return; }
    const s = arduino[servoName(r)];
    if (s.present === false) { setStatus(`${rowName(rows[r], r)} not found`); return; }
    manualPt = { row: r, i, orig: rows[r].points[i].v };   // remember the value so Esc can restore it
    selectPoint(r, i);
    s.disableTorque(); rows[r].freed = true; updateFreeButtons();   // free it for hand movement
    setStatus('pose servo — move the motor by hand, then click to set the angle (Esc to cancel)');
}
function commitManualSet() {
    if (!manualPt) return;
    const { row: r, i } = manualPt; manualPt = null;
    const s = arduino[servoName(r)];
    if (s) s.enableTorque();   // hold the pose you set
    rows[r].freed = false; updateFreeButtons();
    renderRow(r);   // drop the green "posing" fill back to the normal selected look
    persist();
    setStatus(`${rowName(rows[r], r)} key set to ${rows[r].points[i].v} ${TYPE(rows[r]).unit}`);
}
// Cancel a pose (Esc): restore the keyframe's original value and return the servo to it.
function cancelManualSet() {
    if (!manualPt) return;
    const { row: r, i, orig } = manualPt; manualPt = null;
    rows[r].points[i].v = orig;
    const s = arduino[servoName(r)];
    if (s) s.write(orig);   // re-engage torque and move back to the original angle
    rows[r].freed = false; updateFreeButtons();
    renderRow(r);
    persist();
    setStatus(`${rowName(rows[r], r)} pose cancelled`);
}

// -------------------------------------------------------------------
// Rows (servos) — add / remove
// -------------------------------------------------------------------
function addRowAt(index) {
    if (rows.length >= MAX_ROWS) { setStatus(`max ${MAX_ROWS} rows`); return; }
    index = clamp(index, 0, rows.length);
    const nextId = Math.min(253, Math.max(0, ...rows.map(r => r.id)) + 1);
    const row = defaultRow(); row.id = nextId; rows.splice(index, 0, row);
    afterRowChange();
}
function deleteRow(index) {
    if (rows.length <= 1) { setStatus('need at least one row'); return; }
    rows.splice(index, 1);
    afterRowChange();
}
function afterRowChange() {
    selPoint = null; selSeg = null;
    recomputeTotal(); rebuildAllDom(); rebindAll(); persist();
}
function rebindAll() {
    if (!ready) return;
    rows.forEach((_, r) => { const s = arduino[servoName(r)]; if (s && s.isAttached && s.detach) s.detach(); bindRow(r); });
    updateFreeButtons();
}

// -------------------------------------------------------------------
// SVG interaction (event delegation)
// -------------------------------------------------------------------
// Esc cancels an in-progress pose (click still commits — see the pointerdown handler).
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (manualPt) { e.preventDefault(); cancelManualSet(); }
    else if (limitPose) { e.preventDefault(); cancelPoseLimits(); }
    else if (outputDialogRow != null) { e.preventDefault(); cancelOutputDialog(); }
});
let lastDownT = 0, lastDownXY = null;
svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;   // left button starts drags / selection
    hideMenu();
    if (manualPt) { commitManualSet(); return; }   // a click commits an in-progress manual set
    if (limitPose) { commitPoseLimits(); return; }   // a click commits an in-progress pose-limits
    if (svgXYc(e.clientX, e.clientY).y <= RULER_H) { startPlayheadDrag(e); return; }   // ruler → move the playhead
    // Double-click (detected manually — the DOM re-renders between clicks, so the
    // native dblclick event drops) on a lane adds a keyframe.
    const now = performance.now();
    const isDbl = (now - lastDownT < 350) && lastDownXY && Math.hypot(e.clientX - lastDownXY.x, e.clientY - lastDownXY.y) < 6;
    lastDownT = now; lastDownXY = { x: e.clientX, y: e.clientY };
    const t = e.target;
    if (isDbl && !t.classList.contains('pt')) { lastDownT = 0; addPointAt(e.clientX, e.clientY); return; }
    if (t.classList.contains('pt')) { startPointDrag(e, +t.dataset.row, +t.dataset.i); e.preventDefault(); }
    else if (t.classList.contains('seghit') || t.classList.contains('seg')) { const r = +t.dataset.row, i = +t.dataset.i; selectSeg(r, i); showSegStatus(r, i); }
    else clearSelection();
});
// Drag the playhead along the ruler. Stopped → sets the start marker. Paused →
// scrubs: the playhead moves and the motors follow the sequence to that time.
function startPlayheadDrag(e) {
    if (playing) return;   // pause first to scrub
    const scrubbing = paused;
    const move = (ev) => {
        headTime = clamp(Math.round(xToTime(svgXYc(ev.clientX, ev.clientY).x)), 0, TMAX);
        positionPlayhead(headTime);
        if (scrubbing) scrubMotors(headTime); else playFrom = headTime;
    };
    move(e);   // jump to the click point
    const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (scrubbing) scrubMotors(headTime, true);   // ensure the final position is sent
        persist();
        setStatus(scrubbing ? `scrub ${Math.round(headTime)} ms` : `play starts at ${playFrom} ms`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
}
svg.addEventListener('pointermove', (e) => {
    if (!dragPt) return;
    lastPointer = { cx: e.clientX, cy: e.clientY };
    applyDragAt(e.clientX, e.clientY);
});
svg.addEventListener('pointerup', (e) => {
    if (!dragPt) return;
    dragPt = null; lastPointer = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    recomputeTotal(); resizeSvg(); persist();
});
svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const t = e.target;
    if (t.classList.contains('pt')) {
        const r = +t.dataset.row, i = +t.dataset.i;
        selectPoint(r, i); showMenu(pointMenuItems(r, i), e.clientX, e.clientY);
    } else if (t.classList.contains('seghit') || t.classList.contains('seg')) {
        const r = +t.dataset.row, i = +t.dataset.i;
        selectSeg(r, i); showSegStatus(r, i); showMenu(segMenuItems(r, i), e.clientX, e.clientY);
    }
    // empty lane → no menu (double-click adds a keyframe)
});
// Scroll can't go right of the furthest keyframe; scrolling left shrinks the SVG
// back toward it (so any spare width left over from an extend-then-retract clears).
lanesScroll.addEventListener('scroll', () => {
    if (dragPt) return;   // don't fight an active drag/extend
    const maxRight = Math.max(0, furthestX() - lanesScroll.clientWidth);
    if (lanesScroll.scrollLeft > maxRight) { lanesScroll.scrollLeft = maxRight; return; }
    resizeSvg();
});
// The lanes pane fills the window; re-fit the SVG when the window resizes.
window.addEventListener('resize', () => resizeSvg());

// -------------------------------------------------------------------
// Playback — build each row's segments, send as one arduino.gesture({…})
// -------------------------------------------------------------------
// Start (or resume) playback from `fromTime` — sends each row as a gesture().
function startPlayback(fromTime) {
    if (!ready) { setStatus('connect the board first'); return; }
    const lanes = {};   // keyed by the registered actuator name (servoName(r))
    let maxDur = 0, active = 0;
    rows.forEach((rw, r) => {
        if (!rw.points.length || rw.on === false) return;   // skip empty and switched-off rows
        const segs = buildSegments(rw, fromTime);
        if (!segs) return;                    // no keyframes at/after the playhead
        const s = arduino[servoName(r)];
        if (TYPE(rw).hold) TYPE(rw).hold(s); rw.freed = false;   // playing holds the output
        lanes[servoName(r)] = segs;
        maxDur = Math.max(maxDur, segs.reduce((a, b) => a + b.dur, 0));
        active++;
    });
    if (!active) { setStatus(fromTime > 0 ? 'no keys at/after the playhead' : 'add some keys first'); return; }
    updateFreeButtons();
    scrubGroup = null;   // leaving pause — drop the held scrub group
    arduino.gesture(lanes, { absolute: true });   // one batched frame, channels start & arrive together
    playedServos = Object.keys(lanes).map(k => arduino[k]); gestureSeen = false;   // watch the board's isGesturing
    playing = true; paused = false; playBase = fromTime; playStart = performance.now(); playDur = Math.max(1, maxDur);
    updateTransport();
    setStatus(`playing ${active} servo${active === 1 ? '' : 's'} · ${playDur} ms`);
}
// ▶ play — from the start marker, or resume from a paused (scrubbed) position.
function play() { if (playing) return; startPlayback(paused ? headTime : playFrom); }
// ❙❙ pause — freeze the playhead (halt the on-board gesture, hold), enabling scrub.
function pause() {
    if (playing) {
        playing = false; paused = true;
        headTime = clamp(playBase + (performance.now() - playStart), 0, TMAX);
        if (ready) rows.forEach((_, r) => holdHere(r));   // stop where it is
        buildScrubGroup();   // hold one group for the scrub session
        positionPlayhead(headTime); updateTransport();
        setStatus(`paused at ${Math.round(headTime)} ms — scrub the playhead`);
    } else if (paused) {
        play();   // pause again while paused → resume
    }
}
// Build a row's segment schedule starting at time T (the playhead): lead-in from the
// servo's live position to the first keyframe at/after T, then the remaining segments.
function buildSegments(rw, T = 0) {
    const pts = [...rw.points].sort((a, b) => a.t - b.t).filter(p => p.t >= T);
    if (!pts.length) return null;
    const segs = [{ to: pts[0].v, dur: Math.max(1, Math.round(pts[0].t - T)), curve: 'linear' }];
    for (let i = 1; i < pts.length; i++)
        segs.push({ to: pts[i].v, dur: Math.max(1, Math.round(pts[i].t - pts[i - 1].t)), curve: pts[i - 1].curve });
    return segs.slice(0, 12);   // board cap (MAX_BUS_SERVO_SEGMENTS)
}
function stop() {
    playing = false; paused = false; scrubGroup = null;
    if (ready) rows.forEach((rw, r) => { holdHere(r); rw.freed = false; });   // hold where they are
    updateFreeButtons();
    headTime = playFrom; positionPlayhead(headTime);   // snap back to the start marker
    updateTransport();
    setStatus('stopped');
}
// |◀◀ start / end ▶▶| — jump the playhead. Stopped → moves the start marker; paused → scrubs.
function movePlayheadTo(t) {
    if (playing) return;   // pause first
    headTime = clamp(Math.round(t), 0, TMAX); positionPlayhead(headTime);
    if (paused) scrubMotors(headTime, true); else playFrom = headTime;
    persist();
    setStatus(paused ? `scrub ${headTime} ms` : `play starts at ${headTime} ms`);
}
function goToStart() { movePlayheadTo(0); }
function goToEnd() { let mx = 0; rows.forEach(rw => rw.points.forEach(p => { if (p.t > mx) mx = p.t; })); movePlayheadTo(mx); }
// Highlight the pause button while paused; keep the ribbon reflecting state.
function updateTransport() {
    const pb = document.getElementById('pause');
    if (pb) pb.classList.toggle('active', paused);
}
// Interpolated servo value along the authored curve at time t (for scrubbing).
function valueAtTime(rw, t) {
    const pts = [...rw.points].sort((a, b) => a.t - b.t);
    if (!pts.length) return null;
    if (t <= pts[0].t) return clamp(Math.round(pts[0].v), rw.min, rw.max);
    if (t >= pts[pts.length - 1].t) return clamp(Math.round(pts[pts.length - 1].v), rw.min, rw.max);
    for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i].t) {
            const p0 = pts[i - 1], p1 = pts[i], u = (t - p0.t) / (p1.t - p0.t);
            return clamp(Math.round(lerp(p0.v, p1.v, curveShape(p0.curve, u))), rw.min, rw.max);
        }
    }
    return clamp(Math.round(pts[pts.length - 1].v), rw.min, rw.max);
}
// Scrubbing writes the SAME set of servos repeatedly, so we hold ONE group for the
// whole pause session (built on pause, reused per pointermove, dropped on resume/stop)
// — not a fresh group per frame.
let scrubGroup = null, lastScrubSend = 0;
function buildScrubGroup() {
    scrubGroup = null;
    if (!ready) return;
    const members = {};
    rows.forEach((rw, r) => {
        if (rw.on === false || !rw.points.length) return;
        const s = arduino[servoName(r)];
        if (s.present === false) return;
        members[servoName(r)] = s;
    });
    if (Object.keys(members).length) scrubGroup = arduino.group('seqScrub', members);
}
// Drive every member of the held scrub group to its position at time t (one batched write).
function scrubMotors(t, force) {
    if (!ready || !scrubGroup) return;
    const now = performance.now();
    if (!force && now - lastScrubSend < 40) return;   // throttle ~25/s
    lastScrubSend = now;
    const values = {};
    rows.forEach((rw, r) => {
        const key = servoName(r);
        if (!(key in scrubGroup.members)) return;   // only the group's members
        const v = valueAtTime(rw, t);
        if (v != null) values[key] = v;
    });
    if (Object.keys(values).length) scrubGroup.write(values);
}
// "free" buttons are toggles — green when the servo is freed (torque off / hand-poseable).
// `rw.freed` is live hardware state (not persisted); bindRow() frees on connect.
const canFree = (r) => TYPE(rows[r]).canFree(rows[r]);   // PWM: never; stepper: only with an EN pin
function setFreed(r, freed) {
    const rw = rows[r], t = TYPE(rw), s = arduino[servoName(r)];
    if (!canFree(r)) { rw.freed = false; return; }
    rw.freed = freed;
    if (freed) t.free(s); else t.hold(s);
}
function updateFreeButtons() {
    document.querySelectorAll('.rowlabel').forEach(cell => {
        const r = +cell.dataset.row, rw = rows[r]; if (!rw) return;
        const btn = cell.querySelector('.rl-free'); if (!btn) return;
        const can = canFree(r);
        btn.disabled = !can;
        btn.classList.toggle('disabled', !can);
        btn.classList.toggle('freed', can && rw.freed === true);
    });
    const fa = document.getElementById('freeAll');
    const freeable = rows.filter((_, r) => canFree(r));
    if (fa) fa.classList.toggle('freed', freeable.length > 0 && freeable.every(rw => rw.freed === true));
}
// Toggle ALL freeable outputs between freed and holding.
function freeAll() {
    if (!ready) { setStatus('connect the board first'); return; }
    const idx = rows.map((_, r) => r).filter(canFree);
    if (!idx.length) { setStatus('no freeable outputs (PWM servos hold; steppers need an EN pin)'); return; }
    const freeThem = idx.some(r => rows[r].freed !== true);
    if (freeThem) { playing = false; paused = false; scrubGroup = null; updateTransport(); }
    idx.forEach(r => setFreed(r, freeThem));
    updateFreeButtons();
    setStatus(freeThem ? 'outputs freed — hand-pose them' : 'outputs holding');
}
// Toggle one output between freed and holding.
function freeRow(r) {
    if (!canFree(r)) return;   // button is greyed for these types
    if (!ready) { setStatus('connect the board first'); return; }
    const s = arduino[servoName(r)];
    if (s.present === false) { setStatus(`${rowName(rows[r], r)} not found`); return; }
    const freed = rows[r].freed !== true;
    setFreed(r, freed);
    updateFreeButtons();
    setStatus(`${rowName(rows[r], r)} ${freed ? 'freed — hand-pose it' : 'holding'}`);
}
// Toggle a row in/out of playback (the gutter "on" checkbox).
function setRowOn(r, on) {
    rows[r].on = on;
    document.querySelector(`.rowlabel[data-row="${r}"]`)?.classList.toggle('off', !on);
    renderRow(r);   // reflect the dimmed lane
    persist();
    setStatus(`${rowName(rows[r], r)} ${on ? 'on' : 'off'}`);
}

// -------------------------------------------------------------------
// Connection standard (see PROJECT-STATUS; duplicated per example)
// -------------------------------------------------------------------
function applyTransport() { const usb = transportEl.value === 'USB'; ipEl.style.display = usb ? 'none' : ''; }
function setConnected(on) {
    connectEl.textContent = on ? 'Connected' : 'Connect';
    connectEl.classList.toggle('connected', on);
    connectEl.classList.toggle('primary', !on);
    if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
}
function switchTransport() {
    manualDisconnect = true; ready = false;
    arduino.disconnect(); setConnected(false);
    persist(); applyTransport();
    setStatus('channel switched — press Connect');
}
async function doConnect() {
    persist(); manualDisconnect = false; ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipEl.value.trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip); setStatus('connecting…');
}
function doDisconnect() {
    manualDisconnect = true; ready = false;
    disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
    connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
function applyR4Pins() {
    const isR4 = String(arduino.board || '').includes('UNO R4');
    rxTxLocked = isR4;
    if (isR4) { rxEl.value = '1'; txEl.value = '2'; } else { rxEl.value = saved.rx; txEl.value = saved.tx; }
    lockField(rxEl, isR4); lockField(txEl, isR4);
}
function lockField(el, lock) {
    el.disabled = lock;
    el.style.color = lock ? '#a49f92' : '';
    el.style.background = lock ? '#efece4' : '';
    el.style.cursor = lock ? 'not-allowed' : '';
}
function onReady() {
    setConnected(true); applyR4Pins();
    const busRow = rows.findIndex(rw => rw.type === 'busservo');   // bus RX/TX config is bus-wide
    if (busRow >= 0) arduino[servoName(busRow)].configureBus(busPins());
    rows.forEach((_, r) => bindRow(r));
    ready = true; updateFreeButtons();
    setStatus(`ready — ${rows.length} output${rows.length === 1 ? '' : 's'}`);
}
// Make sure arduino[servoName(r)] is an instance of this row's output type (create/replace if not).
function ensureActuator(r) {
    if (!arduino) return null;
    const name = servoName(r), t = TYPE(rows[r]);
    if (!arduino[name] || arduino[name].constructor.name !== t.cls) arduino.add(name, t.make());
    return arduino[name];
}
function ensureAllActuators() { rows.forEach((_, r) => ensureActuator(r)); }
// Command an output to hold at its current value (type-aware; used by pause/stop).
function holdHere(r) { const t = TYPE(rows[r]), s = arduino[servoName(r)]; if (s) t.write(s, t.cur(s)); }
function bindRow(r) {
    const rw = rows[r], t = TYPE(rw), s = ensureActuator(r);
    t.attach(s, rw);
    if (t.freeOnConnect && t.free) { t.free(s); rw.freed = true; }   // bus servo: free on connect for hand-posing
    else { if (t.hold) t.hold(s); rw.freed = false; }                // stepper: enable/hold · PWM: nothing
    if (rw.min > 0 || rw.max < t.defMax) s.setLimits(rw.min, rw.max);
    if (t.hasFeedback) s.read(150);                                  // only bus servos report position
}
function reattachRow(r) { if (!ready) return; const s = arduino[servoName(r)]; if (s && s.detach) s.detach(); ensureActuator(r); bindRow(r); }

// -------------------------------------------------------------------
// Live update loop — degrees / markers / playhead / edge auto-scroll
// -------------------------------------------------------------------
function tick() {
    rows.forEach((rw, r) => {
        const cell = gutterCells[r]; if (!cell) return;
        const s = arduino && arduino[servoName(r)];
        const v = (ready && s) ? Number(TYPE(rw).cur(s)) : NaN;   // native value: counts / degrees / steps
        if (ready && s && s.present !== false && Number.isFinite(v)) {
            cell.deg.textContent = Math.round(v); cell.deg.className = 'rl-deg live';
            cell.marker.style.display = 'block';
            cell.marker.style.top = (valToY(r, v) - rowTop(r)) + 'px';
        } else if (ready && s && s.present === false) {
            cell.deg.textContent = 'not found'; cell.deg.className = 'rl-deg missing'; cell.marker.style.display = 'none';
        } else { cell.deg.textContent = '—'; cell.deg.className = 'rl-deg'; cell.marker.style.display = 'none'; }
    });
    // manual set: the keyframe's angle follows the hand-moved servo
    if (manualPt) {
        const s = arduino[servoName(manualPt.row)];
        if (s && s.present !== false && s.position >= 0) {
            rows[manualPt.row].points[manualPt.i].v = clamp(Math.round(s.position), rows[manualPt.row].min, rows[manualPt.row].max);
            renderRow(manualPt.row);
        }
    }
    // pose limits: capture the range swept by the hand-moved servo (labels only, live)
    if (limitPose) {
        const s = arduino[servoName(limitPose.row)];
        if (s && s.present !== false && s.position >= 0) {
            const p = Math.round(s.position);
            if (p < limitPose.min) limitPose.min = p;
            if (p > limitPose.max) limitPose.max = p;
            const cell = gutterCells[limitPose.row];
            if (cell) { cell.scaleTop.textContent = limitPose.max; cell.scaleBot.textContent = limitPose.min; }
        }
    }
    if (playing) {
        const e = performance.now() - playStart;
        headTime = clamp(playBase + Math.min(e, playDur), 0, TMAX);   // cap the animation at the authored end
        positionPlayhead(headTime);
        followPlayhead(timeToX(headTime));
        // Finish on the board's real gesture state (protocol v1.1): done when the servos
        // actually stop gesturing — this waits out a lagging servo and stops cleanly if the
        // gesture was superseded. Falls back to the authored-duration timer for older firmware
        // that never reports isGesturing.
        const anyGesturing = playedServos.some(s => s && s.isGesturing);
        if (anyGesturing) gestureSeen = true;
        const boardEnded = gestureSeen && !anyGesturing;
        if (boardEnded || (e >= playDur && !anyGesturing)) {
            playing = false; setStatus('done'); headTime = playFrom; positionPlayhead(headTime); updateTransport();
        }
    }
    edgeScrollDuringDrag();
    requestAnimationFrame(tick);
}
function followPlayhead(x) {
    const vw = lanesScroll.clientWidth;
    if (x > lanesScroll.scrollLeft + vw - 40) lanesScroll.scrollLeft = x - (vw - 40);
    else if (x < lanesScroll.scrollLeft) lanesScroll.scrollLeft = x;
}
function edgeScrollDuringDrag() {
    if (!dragPt || !lastPointer) return;
    const sr = lanesScroll.getBoundingClientRect();
    // Buffer zone: the whole visible pane is dead — auto-scroll only engages once
    // the cursor is dragged PAST an edge, and its speed ramps up with how far past
    // (so it eases in and back out rather than snapping the moment you near the edge).
    const RAMP = 70, MAX = 18;
    let dv = 0;
    if (lastPointer.cx > sr.right)     dv =  MAX * Math.min(1, (lastPointer.cx - sr.right) / RAMP);
    else if (lastPointer.cx < sr.left) dv = -MAX * Math.min(1, (sr.left - lastPointer.cx) / RAMP);
    if (!dv) return;
    lanesScroll.scrollLeft = Math.max(0, lanesScroll.scrollLeft + dv);   // browser caps to content
    applyDragAt(lastPointer.cx, lastPointer.cy);
}

function setStatus(s) { statusEl.textContent = 'info: ' + s; }

// -------------------------------------------------------------------
// Wire up controls + boot
// -------------------------------------------------------------------
ipEl.value = saved.ip;
transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
rxEl.value = saved.rx; txEl.value = saved.tx;
transportEl.onchange = switchTransport;
connectEl.onclick = doConnect;
disconnectEl.onclick = doDisconnect;
const applyPins = () => { persist(); if (ready) { const b = rows.findIndex(rw => rw.type === 'busservo'); if (b >= 0) arduino[servoName(b)].configureBus(busPins()); rows.forEach((_, i) => reattachRow(i)); } };
rxEl.onchange = applyPins; txEl.onchange = applyPins;
applyTransport();

$('toStart').onclick = goToStart;
$('play').onclick = play;
$('pause').onclick = pause;
$('stop').onclick = stop;
$('toEnd').onclick = goToEnd;
$('freeAll').onclick = freeAll;
function wireCopy(btn, getText, el) {
    btn.onclick = () => {
        const done = (ok) => { btn.textContent = ok ? 'copied' : 'select + ⌘C'; setTimeout(() => { btn.textContent = 'copy'; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(getText()).then(() => done(true), () => { selectCode(el); done(false); });
        else { selectCode(el); done(false); }
    };
}
wireCopy(copyCode, () => lastCode, codeText);
wireCopy(copyIno, () => lastIno, inoText);

arduino = new Arduino();
ensureAllActuators();   // one actuator per row, of that row's output type
arduino.on('ready', onReady);
arduino.on('disconnect', () => {
    ready = false; setConnected(false);
    rows.forEach(rw => rw.freed = false); updateFreeButtons();   // torque state is lost on disconnect
    if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
    else if (!manualDisconnect) setStatus('reconnecting…');
});
arduino.on('usbBusy', () => { usbBusy = true; });

recomputeTotal();
rebuildAllDom();
updateCode();
requestAnimationFrame(tick);

if (localStorage.getItem(STORE)) doConnect();
else setStatus("enter your board's IP and press Connect");
