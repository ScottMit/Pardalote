// ==============================================================
// NeoPixel — p5.js + Pardalote
// Mix a colour with the mouse and the LED strip follows it live: across the
// canvas = hue, up and down = brightness. Connection, the strip's data pin and
// the pixel count are set on the page (and remembered by this browser) — no
// code editing needed.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-neopixel';
const DEFAULTS = {
    ip: '192.168.x.x',
    transport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
    pin: 27,             // strip data pin
    count: 8,            // number of pixels
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    saved.pin = int(pinIn.value());
    saved.count = Math.max(1, int(countIn.value()));
    localStorage.setItem(STORE, JSON.stringify(saved));
}

const W = 600, H = 400;

let arduino, ready = false, statusEl;
let ipIn, transportSelect, connectBtn, disconnectBtn, pinIn, countIn;
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

    // --- wiring, with the other settings above the display ---
    r = row(main, 'Wiring');
    createSpan('pixel pin').parent(r);
    pinIn = createInput(String(saved.pin), 'number').parent(r); pinIn.style('width', '56px');
    createSpan('count').parent(r);
    countIn = createInput(String(saved.count), 'number').parent(r); countIn.style('width', '56px');
    const applyWiring = () => { persist(); if (ready) onReady(); };
    pinIn.changed(applyWiring); countIn.changed(applyWiring);

    // --- the display: a hue × brightness colour field ---
    createCanvas(W, H).parent(main);
    drawColourField();

    // create Arduino and register the NeoPixel strip
    arduino = new Arduino();
    arduino.add('strip', new NeoPixel());
    arduino.on('ready', () => { setConnected(true); onReady(); });
    arduino.on('disconnect', () => {
        ready = false; setConnected(false);
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    arduino.on('usbBusy', () => { usbBusy = true; });

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

// Configure the strip INSIDE 'ready' (device state resets on every reconnect).
function onReady() {
    arduino.strip.init(saved.pin, saved.count);   // pin, number of pixels
    arduino.strip.setBrightness(50);
    arduino.strip.clear();
    arduino.strip.show();
    ready = true;
    setStatus(`ready — ${saved.count} pixels on pin ${saved.pin}`);
}

// The hue (x) × brightness (y) field — drawn once; draw() only overlays a swatch.
function drawColourField() {
    colorMode(HSB);
    noStroke();
    for (let i = 0; i < width; i++) {
        const newH = map(i, 0, width, 0, 360);
        for (let j = 0; j < height; j++) {
            const newB = map(j, 0, height, 110, 0);
            fill(newH, 255, newB);
            rect(i, j, 1, 1);
        }
    }
    colorMode(RGB);
}

function draw() {
    const circleRadius = 50;
    let neoColor;
    // pick the NeoPixel colour from the mouse location
    if (dist(mouseX, mouseY, width / 2, height / 2) < circleRadius) {
        neoColor = arduino.strip.Color(255, 255, 255);   // white in the centre
        fill(255);
    } else {
        const pixelColor = get(mouseX, mouseY);
        fill(pixelColor);
        neoColor = arduino.strip.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
    }

    // push the colour to the whole strip (show() is rate-limited by the library)
    if (arduino.connected && ready) {
        arduino.strip.fill(neoColor, 0, saved.count);
        arduino.strip.show();
    }

    // preview the colour on a central circle
    noStroke();
    circle(width / 2, height / 2, circleRadius * 2);
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
    persist(); applyTransport();
    setStatus('channel switched — press Connect');
}

function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
