// ==============================================================
// Basic light switch
// Two buttons drive an LED with digitalWrite(). Connection and the LED pin
// are set on the page (and remembered by this browser) — no code editing
// needed.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-basic-light-switch';
const saved = { ip: '192.168.x.x', transport: 'wifi', pin: 13, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

const arduino = new Arduino();
const ipEl = document.getElementById('ip');
const transportEl = document.getElementById('transport');
const connectEl = document.getElementById('connect');
const disconnectEl = document.getElementById('disconnect');
const pinEl = document.getElementById('led-pin');
ipEl.value = saved.ip;
transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
pinEl.value = saved.pin;

let ready = false, manualDisconnect = false, usbBusy = false;

// --- Connection standard (see PROJECT-STATUS; duplicated per example) ---
function persistConn() {
    saved.ip = ipEl.value.trim();
    saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
    saved.pin = parseInt(pinEl.value, 10);
    localStorage.setItem(STORE, JSON.stringify(saved));
}
function applyTransport() {
    const usb = (transportEl.value === 'USB');
    ipEl.style.display = usb ? 'none' : '';
}
function setConnected(on) {
    connectEl.textContent = on ? 'Connected' : 'Connect';
    connectEl.classList.toggle('connected', on);
    connectEl.classList.toggle('primary', !on);
    if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
}
function switchTransport() {
    manualDisconnect = true; ready = false;
    arduino.disconnect();
    setConnected(false);
    persistConn();
    applyTransport();
    setStatus('channel switched — press Connect');
}
transportEl.onchange = switchTransport;

async function doConnect() {
    persistConn();
    manualDisconnect = false; ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipEl.value.trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip);
    setStatus('connecting…');
}
function doDisconnect() {
    manualDisconnect = true; ready = false;
    disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
    connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
connectEl.onclick = doConnect;
disconnectEl.onclick = doDisconnect;
applyTransport();

// Configure the LED pin INSIDE 'ready' (pin state resets on every reconnect).
arduino.on('ready', () => {
    setConnected(true);
    ready = true;
    arduino.pinMode(saved.pin, OUTPUT);
    setStatus(`ready — LED on pin ${saved.pin}`);
});
arduino.on('disconnect', () => {
    ready = false; setConnected(false);
    if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
    else if (!manualDisconnect) setStatus('reconnecting…');
});
arduino.on('usbBusy', () => { usbBusy = true; });

// Browser → Arduino: clicking the buttons sends a normal digitalWrite.
document.getElementById('led-on').onclick  = () => { if (ready) arduino.digitalWrite(saved.pin, HIGH); };
document.getElementById('led-off').onclick = () => { if (ready) arduino.digitalWrite(saved.pin, LOW); };
// Re-apply pinMode when the pin field changes.
pinEl.onchange = () => { persistConn(); if (ready) arduino.pinMode(saved.pin, OUTPUT); };

// Returning visit: reconnect with the remembered settings.
if (localStorage.getItem(STORE)) doConnect();
else setStatus("enter your board's IP and press Connect");

function setStatus(s) { document.getElementById('status').textContent = 'status: ' + s; }
