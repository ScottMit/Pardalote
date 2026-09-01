// ============================================================================
// Pardalote example screenshotter — simulated "working" screenshots, no board.
//
// Injects a virtual-board WebSocket into each example page BEFORE its own
// scripts run, so the real pardalote.js completes its true HELLO -> announce
// -> SYNC_COMPLETE handshake and the example renders exactly as it would
// against real hardware. Per-example config then feeds sensor data (analog,
// ultrasonic, IMU, stepper, bus-servo), board-shared devices/pins, and
// key/value messages.
//
// Output goes to a local scratch folder (./out) by DEFAULT — that's for
// eyeballing renders; nothing ships from there. Pass --publish to write the
// real doc screenshots to docs/assets/examples/, or --out <dir> for a custom
// path. Existing images are never overwritten unless --force (they get
// hand-cropped after capture). Run ON REQUEST only — no build step calls this.
//
// Usage (from this folder):
//   npm install                     # once — pulls puppeteer-core (drives your Chrome)
//   node run.js                     # render all → ./out (scratch)
//   node run.js servo-control       # just one → ./out
//   node run.js --publish           # write the missing doc screenshots
//   node run.js --publish --force servo-control   # regenerate one doc screenshot
//   node run.js --out /tmp/shots    # custom output dir
//
// Prereqs: Node 18+, and Google Chrome installed (or set CHROME_PATH).
// Serves the repo over a throwaway localhost HTTP server (file:// won't run
// the sketches). camera-stream / camera-posenet are intentionally not
// simulated — MJPEG-over-HTTP + a real subject can't be faked honestly.
// ============================================================================

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

// repo root = two levels up from tools/screenshot-examples/
const REPO = path.resolve(__dirname, '..', '..');

// --- args -----------------------------------------------------------------
// Where images go:
//   (default)            ./out — a local scratch folder (gitignored). This is
//                        just for eyeballing renders; nothing ships from here.
//   --publish            the real doc screenshots → docs/assets/examples/.
//   --out <dir>          a custom directory.
// --force overwrites existing images (otherwise they're skipped — see below).
// Any other bare args are example slugs to limit the run to.
const rawArgs = process.argv.slice(2);
const FORCE   = rawArgs.includes('--force') || process.env.FORCE === '1';
const PUBLISH = rawArgs.includes('--publish');
const outIdx  = rawArgs.indexOf('--out');
const outArg  = outIdx !== -1 ? rawArgs[outIdx + 1] : null;
const names   = rawArgs.filter((a, i) => !a.startsWith('--') && !(outIdx !== -1 && i === outIdx + 1));

const OUT = PUBLISH ? path.join(REPO, 'docs/assets/examples')
          : outArg  ? path.resolve(outArg)
          :           path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 'full' = whole-page screenshot (default, crop it yourself); 'element' = just
// the configured visual element (canvas / #stage / main).
const SHOT_MODE = process.env.SHOT === 'element' ? 'element' : 'full';

// Chrome binary — override with CHROME_PATH; otherwise try the usual spots.
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

// ---- tiny static file server (repo root) -----------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  '.stl': 'application/octet-stream', '.obj': 'text/plain', '.txt': 'text/plain',
};
function startServer(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const fp = path.normalize(path.join(root, p));
      if (!fp.startsWith(root)) { res.statusCode = 403; return res.end('forbidden'); }
      fs.readFile(fp, (e, data) => {
        if (e) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('content-type', MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream');
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---- the virtual board, injected into the page before any page script ------
function installSim(cfg) {
  window.__PSIM = cfg;
  const B = cfg.board, ADC = cfg.adcBits, MAX = (1 << ADC) - 1;

  function enc(cmd, target, params, floatMask, payload) {
    params = params || []; floatMask = floatMask || 0;
    let pb = null;
    if (payload != null) pb = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const plen = pb ? pb.length : 0;
    const buf = new ArrayBuffer(8 + params.length * 4 + plen);
    const v = new DataView(buf);
    v.setUint8(0, cmd); v.setUint16(1, target, false); v.setUint8(3, params.length);
    v.setUint16(4, floatMask, false); v.setUint16(6, plen, false);
    params.forEach((p, i) => ((floatMask >> i) & 1)
      ? v.setFloat32(8 + i * 4, p, false) : v.setInt32(8 + i * 4, p | 0, false));
    if (pb) new Uint8Array(buf, 8 + params.length * 4).set(pb);
    return buf;
  }
  // CMD_MESSAGE encoder (int/bool/float/text), mirrors encodeMessage().
  function encMsg(key, value, opts) {
    opts = opts || {};
    const MT = { int: 0, bool: 1, float: 2, char: 3, text: 4 };
    let type, param = null, isFloat = false, valBytes = null;
    if (typeof value === 'boolean') { type = MT.bool; param = value ? 1 : 0; }
    else if (typeof value === 'number' && !Number.isInteger(value)) { type = MT.float; param = value; isFloat = true; }
    else if (typeof value === 'number') { type = MT.int; param = value | 0; }
    else { type = MT.text; valBytes = new TextEncoder().encode(String(value)); }
    const flags = (opts.retain ? 1 : 0) | (opts.broadcast ? 2 : 0);
    const target = ((flags & 0xFF) << 8) | (type & 0xFF);
    const keyBytes = new TextEncoder().encode(String(key));
    const kl = keyBytes.length, vlen = valBytes ? valBytes.length : 0;
    const np = param === null ? 0 : 1;
    const buf = new ArrayBuffer(8 + np * 4 + 1 + kl + vlen);
    const v = new DataView(buf);
    v.setUint8(0, 0x0B); v.setUint16(1, target, false); v.setUint8(3, np);
    v.setUint16(4, isFloat ? 1 : 0, false); v.setUint16(6, 1 + kl + vlen, false);
    if (np) { if (isFloat) v.setFloat32(8, param, false); else v.setInt32(8, param, false); }
    const bytes = new Uint8Array(buf), ps = 8 + np * 4;
    bytes[ps] = kl; bytes.set(keyBytes, ps + 1);
    if (vlen) bytes.set(valBytes, ps + 1 + kl);
    return buf;
  }

  class FakeWS {
    constructor(url) {
      this.url = url; this.binaryType = 'arraybuffer'; this.readyState = 0;
      this.onopen = this.onclose = this.onerror = this.onmessage = null;
      this._timers = []; this._started = false;
      (window.__psimSockets = window.__psimSockets || []).push(this);
      setTimeout(() => {
        this.readyState = 1; this.onopen && this.onopen();
        const bs = new TextEncoder().encode(B);
        this.deliver(enc(0x00, 0, [1, 0, ADC, 4242], 0, bs));  // HELLO
        this.preSync();
        setTimeout(() => {
          this.deliver(enc(0x0A, 0, []));                       // SYNC_COMPLETE -> ready
          setTimeout(() => this.startFeeds(), 150);
        }, 30);
      }, 40);
    }
    deliver(ab) { this.readyState === 1 && this.onmessage && this.onmessage({ data: ab }); }
    close() { this.readyState = 3; this._timers.forEach(clearInterval); this.onclose && this.onclose({ code: 1000, reason: '', wasClean: true }); }
    every(ms, fn) { const id = setInterval(fn, ms); this._timers.push(id); return id; }

    preSync() {
      // Board-shared pins announced before SYNC_COMPLETE (share() examples).
      (cfg.sharePins || []).forEach(p => this.deliver(enc(0x02, p.pin, [p.mode, p.interval || 50])));
      // Board-created (shared) hardware objects: SHARE + announce frames.
      (cfg.shares || []).forEach(s => {
        this.deliver(enc(0x56, s.device, [s.id], 0, new TextEncoder().encode(s.name)));
        (s.frames || []).forEach(f => this.deliver(enc(f.cmd, s.device, f.params, f.floatMask || 0)));
      });
    }
    startFeeds() {
      if (this._started) return; this._started = true;
      const t0 = Date.now();
      // one-shot frames delivered just after 'ready' (post-sync broadcasts)
      (cfg.postFrames || []).forEach(f => this.deliver(enc(f.cmd, f.target, f.params, f.floatMask || 0)));
      (cfg.feeds || []).forEach(f => {
        const tick = () => {
          const t = (Date.now() - t0) / 1000;
          const fr = FEEDS[f.kind](t, f, MAX);
          if (fr) this.deliver(enc(fr.cmd, fr.target, fr.params, fr.floatMask || 0));
        };
        tick(); this.every(f.ms || 150, tick);
      });
      if (cfg.messages) this.pumpMessages();
    }
    pumpMessages() {
      const seed = cfg.messages.seed || [];
      seed.forEach(m => this.deliver(encMsg(m.key, m.value, m.opts)));
      let up = cfg.messages.uptime || 0;
      if (cfg.messages.uptime != null)
        this.every(1000, () => { up++; this.deliver(encMsg('uptime', up, { retain: true })); });
    }

    send(ab) {
      let pos = 0; const dv = new DataView(ab);
      while (pos + 8 <= ab.byteLength) {
        const cmd = dv.getUint8(pos), np = dv.getUint8(pos + 3), plen = dv.getUint16(pos + 6, false);
        if (cmd === 0x08) this.deliver(enc(0x09, 0, []));  // PING -> PONG
        pos += 8 + np * 4 + plen;
      }
    }
  }

  // sensor-feed generators, keyed by kind. Device IDs: NEO 200, SERVO 201,
  // ULTRASONIC 202, IMU 203, CAMERA 204, STEPPER 205, BUSSERVO 206, ENCODER 207.
  const FEEDS = {
    analog: (t, f, MAX) => ({ cmd: 0x06, target: f.pin, params: [Math.round((0.5 + 0.4 * Math.sin(t * 0.9 + (f.phase || 0))) * MAX)] }),
    ultrasonic: (t, f) => { const cm = 45 + 35 * Math.sin(t * 0.6); return { cmd: 0x20, target: 202, params: [f.id || 0, Math.round(cm * 10)] }; },
    imu: (t, f) => {
      // gentle wobble around a fixed tilt so the model sits at a lively angle
      const ax = 0.30 + 0.05 * Math.sin(t * 0.7), ay = 0.16 + 0.05 * Math.cos(t * 0.5), az = 0.92;
      const gx = 3 * Math.cos(t * 0.7), gy = -2 * Math.sin(t * 0.5), gz = 0;
      return { cmd: 0x2A, target: 203, params: [f.id || 0, ax, ay, az, gx, gy, gz, 24.6], floatMask: 0x1FE };
    },
    stepper: (t, f) => {
      const pos = Math.round(f.center + f.amp * Math.sin(t * 0.5));
      const dtg = Math.round(f.amp * Math.cos(t * 0.5));
      return { cmd: 0x3E, target: 205, params: [f.id || 0, pos, dtg, Math.round(500 + 300 * Math.cos(t * 0.5)), 1] };
    },
    busRead: (t, f) => {
      const pos = Math.round(f.center + f.amp * Math.sin(t * 0.4 + (f.phase || 0)));
      return { cmd: 0x48, target: 206, params: [f.id, pos, 0, f.load || 110, f.dv || 74, f.temp || 38, 90] };
    },
  };

  window.WebSocket = FakeWS;
}

// ------------------------------ config --------------------------------------
// board string must be a key in BOARD_ALIASES (pardalote-core.js) for aliases
// to resolve; adcBits sets analogMax = 2^bits - 1.
const UNO = { board: 'UNO R4 WiFi', adcBits: 10 };
const ESP = { board: 'ESP32-WROVER-DEV', adcBits: 12 };

const EXAMPLES = {
  'servo-control':       { ...UNO, connect: 'std', target: 'canvas' },
  'potentiometer-p5js':  { ...UNO, connect: 'std', target: 'canvas', feeds: [{ kind: 'analog', pin: 14, ms: 120 }] },
  'ultrasonic-sensor':   { ...UNO, connect: 'std', target: 'canvas', feeds: [{ kind: 'ultrasonic', id: 0, ms: 120 }] },
  'IMU':                 { ...ESP, connect: 'std', target: '#stage', settle: 4500, feeds: [{ kind: 'imu', id: 0, ms: 50 }] },
  'neopixel':            { ...ESP, connect: 'std', target: 'canvas', mouse: [430, 150] },
  'shared-servo':        { ...UNO, connect: 'std', target: 'canvas',
    shares: [{ device: 201, id: 250, name: 'pan', frames: [{ cmd: 0x14, params: [250, 9, 544, 2400] }, { cmd: 0x16, params: [250, 125] }] }] },
  'stepper-motor':       { ...ESP, connect: 'std', target: 'canvas', feeds: [{ kind: 'stepper', id: 0, center: 300, amp: 260, ms: 100 }] },
  'bus-servos':          { ...ESP, connect: 'std', target: 'canvas',
    postFrames: [{ cmd: 0x63, target: 206, params: [0, 1, 1] }, { cmd: 0x63, target: 206, params: [1, 2, 1] }],
    feeds: [{ kind: 'busRead', id: 0, center: 2350, amp: 500, temp: 37, ms: 120 }, { kind: 'busRead', id: 1, center: 1750, amp: 500, phase: 2, temp: 39, ms: 120 }] },
  'basic-light-switch':  { ...UNO, connect: 'std', target: 'main' },
  'shared-light-switch': { ...UNO, connect: 'std', target: 'main',
    sharePins: [{ pin: 13, mode: 1 }], postFrames: [{ cmd: 0x03, target: 13, params: [1] }] },
  'shared-potentiometer':{ ...UNO, connect: 'std', target: 'main', sharePins: [{ pin: 14, mode: 8, interval: 50 }], feeds: [{ kind: 'analog', pin: 14, ms: 120 }] },
  'control-panel':       { ...UNO, connect: 'std', target: 'main' },
  'messaging':           { ...UNO, connect: 'std', target: 'main', messages: { uptime: 41, seed: [{ key: 'led', value: true }, { key: 'brightness', value: 128 }, { key: 'temp', value: 22.5 }, { key: 'label', value: 'hello' }] } },
  'coordinated-motion':  { ...ESP, connect: 'std', target: 'canvas', settle: 1900 },
  'leader-follower':     { ...ESP, connect: 'std', target: 'canvas', settle: 1900,
    postFrames: [0, 1, 2, 3, 4, 5].map(id => ({ cmd: 0x63, target: 206, params: [id, id + 1, 1] })),
    feeds: [0, 1, 2, 3, 4, 5].map(id => ({ kind: 'busRead', id, center: Math.round(2048 + 900 * Math.sin(id * 0.9)), amp: 120, phase: id, ms: 150 })) },
  'gesture-builder':     { ...ESP, connect: 'std', target: 'main', settle: 1600 },
  // camera-stream / camera-posenet: not simulated (need a real camera + subject).
};

async function shoot(page, base, name, cfg) {
  const url = `${base}/examples/${name}/index.html`;
  await page.evaluateOnNewDocument(installSim, { board: cfg.board, adcBits: cfg.adcBits, feeds: cfg.feeds, sharePins: cfg.sharePins, shares: cfg.shares, postFrames: cfg.postFrames, messages: cfg.messages });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}

  if (cfg.connect === 'std') {
    // Every connection row (a .row that holds a transport <select>) gets a
    // valid IP; every primary button is the Connect for its board. Handles
    // single-board pages and the two-board leader/follower alike.
    await page.evaluate(() => {
      document.querySelectorAll('.row').forEach(row => {
        if (!row.querySelector('select')) return;
        const ip = row.querySelector('input[type=text]'); if (ip) ip.value = '192.168.1.50';
      });
      // p5 buttons bind 'mousedown' (.mousePressed); connect.js binds onclick.
      // Fire both so either wiring triggers.
      document.querySelectorAll('button.primary').forEach(b => {
        ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true })));
      });
    });
    try {
      await page.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Connected'),
        { timeout: 8000 });
    } catch (e) { console.log(`  [${name}] note: no 'Connected' button state seen (harmless for custom UIs)`); }
  }

  if (cfg.mouse) await page.mouse.move(cfg.mouse[0], cfg.mouse[1]);
  await new Promise(r => setTimeout(r, cfg.settle || 1400));

  // Capture mode: 'full' (default) grabs the whole page so you can crop it
  // yourself; SHOT=element grabs just the configured visual element.
  const file = path.join(OUT, `${name}.png`);
  const el = (SHOT_MODE === 'element' && cfg.target) ? await page.$(cfg.target) : null;
  if (el) await el.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
  console.log(`  saved ${path.relative(REPO, file)}`);
}

(async () => {
  if (!CHROME) {
    console.error('No Chrome found. Install Google Chrome or set CHROME_PATH=/path/to/chrome');
    process.exit(1);
  }
  // NON-DESTRUCTIVE BY DEFAULT: an existing PNG in OUT is never overwritten
  // (published screenshots get hand-cropped — clobbering them loses that work).
  // Pass --force to regenerate. This tool is run ON REQUEST only; nothing in
  // the docs build invokes it.
  const list = names.length ? names : Object.keys(EXAMPLES);
  const srv = await startServer(REPO);
  const base = `http://127.0.0.1:${srv.address().port}`;
  console.log(`output → ${OUT}${FORCE ? '  (--force: overwriting)' : '  (skipping existing; --force to overwrite)'}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  for (const name of list) {
    const cfg = EXAMPLES[name];
    if (!cfg) { console.log(`skip ${name} (no config)`); continue; }
    if (!FORCE && fs.existsSync(path.join(OUT, `${name}.png`))) {
      console.log(`skip ${name} (image exists — --force to overwrite)`);
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 1000, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log(`  [${name}] pageerror: ${e.message}`));
    try { await shoot(page, base, name, cfg); }
    catch (e) { console.log(`  [${name}] FAILED: ${e.message}`); }
    await page.close();
  }
  await browser.close();
  srv.close();
})();
