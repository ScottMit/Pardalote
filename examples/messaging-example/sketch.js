// ==============================================================
// Messaging example
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
// Pair this with messaging.ino: the sketch watches "mode", drives the
// built-in LED from a "led" message, and sends a retained "uptime".
// ==============================================================

const ARDUINO_IP = '10.1.1.128';   // Change this to your Arduino's IP

const arduino = new Arduino();
arduino.connect(ARDUINO_IP);

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
arduino.on('ready',      () => setStatus(true));
arduino.on('disconnect', () => setStatus(false));

function setStatus(connected) {
    const el = document.getElementById('status');
    el.textContent = connected ? '● CONNECTED' : '● DISCONNECTED';
    el.className   = connected ? 'connected'   : 'disconnected';
}
