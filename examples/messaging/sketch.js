// ==============================================================
// Messaging — key/value channel + traffic inspector (a Pardalote tool)
// Works out of the box: the connection is set on the page (and
// remembered by this browser) — no code editing needed.
//
// Named key/value messages flow both ways over the same WebSocket,
// with no pin or hardware device attached:
//
//   arduino.send(key, value, { retain, broadcast })  — send
//   arduino.watch(key, cb)                           — watch one key
//   arduino.on('message', cb)                        — watch all keys
//   arduino.messages[key]                            — last received value
//   arduino.on('frame', cb)                          — inspect ALL traffic
//
// Pair this with messaging.ino: the sketch logs every message, drives the
// built-in LED from a "led" message, and sends a retained "uptime".
// House style: see style.css — shared by every Pardalote example.
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-messaging';
const saved = { ip: '192.168.x.x', transport: 'wifi', ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

const arduino = new Arduino();
const ipEl = document.getElementById('ip');
const transportEl = document.getElementById('transport');
const connectEl = document.getElementById('connect');
const disconnectEl = document.getElementById('disconnect');
const connectLblEl = document.getElementById('connect-lbl');
ipEl.value = saved.ip;
transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';

// --- Connection standard (see PROJECT-STATUS; duplicated per example) ---
function persistConn() {
    saved.ip = ipEl.value.trim();
    saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}
function applyTransport() {
    const usb = (transportEl.value === 'USB');
    ipEl.style.display = usb ? 'none' : '';
    connectLblEl.textContent = usb ? 'Board USB' : 'Board IP';
}
function setConnected(on) {
    connectEl.textContent = on ? 'Connected' : 'Connect';
    connectEl.classList.toggle('connected', on);
    connectEl.classList.toggle('primary', !on);
    if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
}
// Flipping WiFi/USB drops the current connection — a browser holds ONE link.
function switchTransport() {
    manualDisconnect = true;
    arduino.disconnect();
    setConnected(false);
    persistConn();
    applyTransport();
    setStatus('channel switched — press Connect');
}
transportEl.onchange = switchTransport;

let manualDisconnect = false;
let usbBusy = false;   // board on WiFi, silent USB reconnect refused (see 'usbBusy')
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
    arduino.disconnect();   // the 'disconnect' event restores the button when done
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
connectEl.onclick = doConnect;
disconnectEl.onclick = doDisconnect;
applyTransport();

// Returning visit: reconnect with the remembered IP.
if (localStorage.getItem(STORE)) doConnect();
else setStatus("enter your board's IP and press Connect");

// --- Send: auto-type the text-box value (int / float / bool / text) ---
document.getElementById('send-form').onsubmit = (e) => {
    e.preventDefault();
    const key   = document.getElementById('key').value.trim();
    const raw   = document.getElementById('value').value;
    if (!key) return;
    arduino.send(key, parseValue(raw), {
        retain:    document.getElementById('retain').checked,
        broadcast: document.getElementById('broadcast').checked,
    });
};

function parseValue(raw) {
    const s = raw.trim();
    if (s === 'true')  return true;
    if (s === 'false') return false;
    if (s !== '' && !isNaN(Number(s))) return Number(s);   // int or float
    return raw;                                            // text
}

// --- Code panel: show the arduino.send() call the form builds ---
function updateCode() {
    const key = document.getElementById('key').value.trim() || 'key';
    const v   = parseValue(document.getElementById('value').value);
    const shown = typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v);
    const flags = [];
    if (document.getElementById('retain').checked)    flags.push('retain: true');
    if (document.getElementById('broadcast').checked) flags.push('broadcast: true');
    const opts = flags.length ? `, { ${flags.join(', ')} }` : '';
    document.getElementById('code').textContent =
        `arduino.send('${key}', ${shown}${opts});`;
}
['key', 'value', 'retain', 'broadcast'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateCode));
updateCode();

// --- Receive: log every message, whatever the key ---
arduino.on('message', ({ key, value, type }) => {
    const li = document.createElement('li');
    const shown = value instanceof Uint8Array ? `[${value.length} bytes]` : String(value);
    li.innerHTML = `<b>${key}</b> = ${shown} <span class="badge">${type}</span>`;
    const log = document.getElementById('log');
    log.prepend(li);
    while (log.children.length > 30) log.lastChild.remove();
});

// --- Watch one specific key (the sketch's retained uptime counter) ---
arduino.watch('uptime', (secs) => {
    document.getElementById('uptime').textContent = `uptime: ${secs}s`;
});

// --- Frame monitor: see ALL traffic, not just messages ---
// Pin-oriented core commands — their `target` field IS the pin number.
const PIN_COMMANDS = new Set([
    'PIN_MODE', 'DIGITAL_WRITE', 'DIGITAL_READ', 'ANALOG_WRITE', 'ANALOG_READ', 'END',
]);

// Turn a raw frame event into a readable line, e.g.
//   DIGITAL_WRITE pin13 = 1     (pin lives in `target`, value in `params`)
//   MESSAGE led = true          (key + value decoded from the payload)
function describeFrame(ev) {
    // MESSAGE carries its key/value in the payload, so cmdName + params
    // alone can't show the key. Decode with the library's own helper.
    if (ev.cmdName === 'MESSAGE' && typeof decodeMessage === 'function') {
        const m = decodeMessage(ev);
        if (m) {
            const shown = m.value instanceof Uint8Array ? `[${m.value.length} bytes]` : String(m.value);
            return `MESSAGE ${m.key} = ${shown}`;
        }
    }
    // Everything else: label the target (pin for pin commands, #id for
    // extension frames) and show the value(s) from params.
    let where = '';
    if (PIN_COMMANDS.has(ev.cmdName)) where = ` pin${ev.target}`;
    else if (ev.target)              where = ` #${ev.target}`;
    const value = ev.params.length ? ` = ${ev.params.join(', ')}` : '';
    return `${ev.cmdName}${where}${value}`;
}

function onFrame(ev) {
    const li = document.createElement('li');
    li.textContent = `${ev.dir === 'in' ? '←' : '→'} ${describeFrame(ev)}`;
    li.className = ev.dir;
    const list = document.getElementById('frames');
    list.prepend(li);
    while (list.children.length > 40) list.lastChild.remove();
}
document.getElementById('monitor').onchange = (e) => {
    if (e.target.checked) arduino.on('frame', onFrame);
    else                  arduino.off('frame', onFrame);
};

// --- Connection indicator ---
arduino.on('ready',      () => { setConnected(true); setStatus('ready'); });
arduino.on('disconnect', () => { setConnected(false);
    if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
    else if (!manualDisconnect) setStatus('reconnecting…'); });
// 'usbBusy': a silent USB reconnect reached a board that's on WiFi — it won't
// switch without a picker gesture. The 'disconnect' that follows shows the prompt.
arduino.on('usbBusy', () => { usbBusy = true; });

function setStatus(s) {
    document.getElementById('status').textContent = 'status: ' + s;
}
