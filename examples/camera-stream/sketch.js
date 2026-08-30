// ==============================================================
// Camera Example
// Streams MJPEG video from an ESP32-S3 camera into a p5.js canvas.
// Connection is set on the page (and remembered by this browser) — no code
// editing needed. There's no pin to set: the camera's stream port is fixed
// by the firmware.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-camera-stream';
const DEFAULTS = { ip: '192.168.x.x', transport: 'wifi' };
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}

const CAMERA_PORT = 82;
const W = 640, H = 480;

let arduino, ready = false, statusEl, camEl = null;   // <img> for the MJPEG stream
let ipIn, transportSelect, connectBtn, disconnectBtn;
let manualDisconnect = false, usbBusy = false;

function setup() {
    const main = select('main');
    statusEl = select('#status');

    // Board — WiFi (IP) or USB (Web Serial), connect/disconnect
    let r = row(main, 'Board');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi'); transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipIn = createInput(saved.ip, 'text').parent(r); ipIn.style('width', '130px');
    connectBtn = createButton('Connect').parent(r).mousePressed(doConnect).addClass('primary');
    disconnectBtn = createButton('Disconnect').parent(r).mousePressed(doDisconnect);
    applyTransport();

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');

    arduino = new Arduino();
    arduino.add('cam', new Camera());
    arduino.on('ready', () => { setConnected(true); onReady(); });
    arduino.on('disconnect', () => {
        ready = false; setConnected(false);
        if (camEl) { camEl.remove(); camEl = null; }
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    arduino.on('usbBusy', () => { usbBusy = true; });
    arduino.cam.on('stream', ({ url }) => {
        if (camEl) camEl.remove();
        camEl = createImg(url, '');
        camEl.hide();
    });

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

function onReady() {
    arduino.cam.attach(CAMERA_PORT);
    ready = true;
    setStatus('ready — starting camera…');
}

function draw() {
    background(255);

    if (camEl) {
        try {
            image(camEl, 0, 0, width, height);
        } catch (e) {
            // img entered broken state (stream dropped) — clear and show placeholder
            camEl.remove();
            camEl = null;
        }
    } else {
        // Waiting for stream — show a placeholder message (house cream card)
        fill('#F2E9D8'); noStroke();
        rect(0, 0, width, height);
        fill('#6d6a5f');
        textAlign(CENTER, CENTER); textSize(16);
        text(arduino.connected ? 'Starting camera…' : 'Connecting…', width / 2, height / 2);
        textAlign(LEFT, BASELINE);
    }

    // Connection status dot — top-right corner (teal = connected)
    noStroke();
    fill(arduino.connected ? '#3FA9A0' : '#D3542B');
    circle(width - 16, 16, 12);
}

// -------------------------------------------------------------------
// Connection standard (see PROJECT-STATUS; duplicated per example)
// -------------------------------------------------------------------
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
    arduino.connect(ip); setStatus('connecting…');
}
function doDisconnect() {
    manualDisconnect = true; ready = false;
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
// WiFi shows the IP field; USB hides it (the browser's port picker chooses).
function applyTransport() {
    const usb = (transportSelect.value() === 'USB');
    ipIn.style('display', usb ? 'none' : '');
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
    arduino.disconnect(); setConnected(false);
    if (camEl) { camEl.remove(); camEl = null; }
    persist(); applyTransport();
    setStatus('channel switched — press Connect');
}

function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
