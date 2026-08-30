// ==============================================================
// Light Switch — Shared Control example
//
// Both the Arduino sketch and this browser can flip pin 13. The Arduino calls
// Pardalote.send(13, value) when its buttons fire; the browser calls
// arduino.digitalWrite(13, value) when its buttons are clicked. Each one's
// change becomes a broadcast the other side picks up via
// arduino.pin(LIGHT).on('change', …). The pin is set in the Arduino code —
// there's nothing to configure here but the connection.
// House style: see style.css — shared by every Pardalote example.
// ==============================================================

const LIGHT = 13;   // shared pin — matches the Arduino sketch

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-shared-light-switch';
const saved = { ip: '192.168.x.x', transport: 'wifi', ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

const arduino = new Arduino();
const ipEl = document.getElementById('ip');
const transportEl = document.getElementById('transport');
const connectEl = document.getElementById('connect');
const disconnectEl = document.getElementById('disconnect');
ipEl.value = saved.ip;
transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';

let manualDisconnect = false, usbBusy = false;

// --- Connection standard (see PROJECT-STATUS; duplicated per example) ---
function persistConn() {
    saved.ip = ipEl.value.trim();
    saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
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
    manualDisconnect = true;
    arduino.disconnect();
    setConnected(false);
    persistConn();
    applyTransport();
    setStatus('channel switched — press Connect');
}
transportEl.onchange = switchTransport;

async function doConnect() {
    persistConn();
    manualDisconnect = false;
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
    manualDisconnect = true;
    disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
    connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
connectEl.onclick = doConnect;
disconnectEl.onclick = doDisconnect;
applyTransport();

// Browser → Arduino: clicking the buttons sends a normal digitalWrite.
document.getElementById('on-btn').onclick  = () => arduino.digitalWrite(LIGHT, HIGH);
document.getElementById('off-btn').onclick = () => arduino.digitalWrite(LIGHT, LOW);

// Arduino → Browser: any change to the shared pin (either side) lands here.
arduino.pin(LIGHT).on('change', ({ value }) => {
    const el = document.getElementById('light');
    el.textContent = value ? 'ON' : 'OFF';
    el.className   = value ? 'on' : 'off';
});

arduino.on('ready', () => { setConnected(true); setStatus('ready'); });
arduino.on('disconnect', () => {
    setConnected(false);
    if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
    else if (!manualDisconnect) setStatus('reconnecting…');
});
arduino.on('usbBusy', () => { usbBusy = true; });

// Returning visit: reconnect with the remembered settings.
if (localStorage.getItem(STORE)) doConnect();
else setStatus("enter your board's IP and press Connect");

function setStatus(s) { document.getElementById('status').textContent = 'status: ' + s; }
