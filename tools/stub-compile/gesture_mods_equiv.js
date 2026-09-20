// JS side of the gesture-mods parity check (see gesture_mods_equiv.cpp).
// Dumps the REAL applyGestureModsLane() from the built bundle for the same cases,
// in the same "name|count|curve,dur,value|…" format, so run.sh can diff them.
//   node gesture_mods_equiv.js <path/to/lib/pardalote.js>
const fs = require('fs');
const bundlePath = process.argv[2];
const src = fs.readFileSync(bundlePath, 'utf8');
const { applyGestureModsLane } = new Function('global', 'document',
    src + '\nreturn { applyGestureModsLane };')(global, undefined);

const C = { linear: 0, easeIn: 1, easeOut: 2, easeInOut: 3, back: 4 };
const cid = (c) => (typeof c === 'number' ? c : (C[c] ?? 0));

// Relative "nod" (by) and its absolute (to) twin — mirror the C++ cases.
const nod = [
    { by:  190, dur: 260, curve: 'easeInOut' }, { by: -190, dur: 260, curve: 'easeInOut' },
    { by:  130, dur: 260, curve: 'easeInOut' }, { by: -130, dur: 260, curve: 'back' },
];
const nodAbs = [
    { to: 1858, dur: 260, curve: 'easeInOut' }, { to: 2048, dur: 260, curve: 'easeInOut' },
    { to: 1918, dur: 260, curve: 'easeInOut' }, { to: 2048, dur: 260, curve: 'back' },
];
const val = (s) => (s.by !== undefined ? s.by : (s.value !== undefined ? s.value : s.to));

function run(name, segs, mods) {
    const out = applyGestureModsLane(segs, { scale: mods[0], speed: mods[1], crop: [mods[2], mods[3]] }, () => {});
    let line = `${name}|${out.length}`;
    for (const s of out) line += `|${cid(s.curve)},${Math.max(1, Math.round(s.dur))},${val(s)}`;
    console.log(line);
}

run('identity',  nod,    [1.0, 1.0, 0.0, 1.0]);
run('scale.5',   nod,    [0.5, 1.0, 0.0, 1.0]);
run('speed2',    nod,    [1.0, 2.0, 0.0, 1.0]);
run('speed.5',   nod,    [1.0, 0.5, 0.0, 1.0]);
run('crop.2-.8', nod,    [1.0, 1.0, 0.2, 0.8]);
run('combo',     nod,    [0.7, 1.5, 0.1, 0.9]);
run('abs-combo', nodAbs, [0.5, 2.0, 0.25, 0.75]);
