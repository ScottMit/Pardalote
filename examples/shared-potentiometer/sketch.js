// ==============================================================
// Potentiometer — Shared Input example
//
// The Arduino sketch calls Pardalote.share(A0, ANALOG_INPUT_MODE) once in
// setup(), which tells THIS browser to auto-start polling A0. All we do here
// is listen on the pin handle — no pinMode, no analogRead, no polling code on
// the JS side, and no pin to configure (the Arduino owns it). Just connect.
// House style: see style.css — shared by every Pardalote example.
// ==============================================================

const POT = 'A0';   // shared input — matches the Arduino sketch

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-shared-potentiometer';
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

// Pin handles resolve alias strings like 'A0' lazily, so this listener can be
// registered right away — it starts firing once the board's alias table
// arrives with the connection handshake.
arduino.pin(POT).on('change', ({ value }) => {
    document.getElementById('value').textContent = value;
    const pct = (value / arduino.analogMax) * 100;
    document.getElementById('bar').style.width = pct + '%';
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
