// ==============================================================
// connect.js — Pardalote connection UI (shared boilerplate)
// Builds the on-page Board controls (WiFi / USB, IP, Connect / Disconnect),
// remembers your choice in this browser, and keeps the link alive across
// reconnects. This is the same "connection standard" used across the Pardalote
// examples — pulled into its own file so each sketch stays about the lesson.
//
// It builds its controls with the DOM directly (no p5 dependency), so the very
// same file works in every example — p5 sketch or plain-DOM page alike. It only
// needs the house-style page around it: a <main>, a #top header, and a #status
// line. You don't need to edit this file — copy the whole example folder and it
// works (it travels with the example; no external dependency).
//
// Usage, from your sketch after `arduino = new Arduino()`:
//   setupConnection(arduino, { store: 'pardalote-potentiometer' });
//
// Options (all optional):
//   store        localStorage key for the remembered IP / transport.
//   defaults     { ip, transport } starting values.
//   label        the row's label cell (default 'Board'). Use 'Leader' /
//                'Follower' etc. when one page has more than one board.
//   manageStatus when false, connect.js never writes #status — the sketch owns
//                the status line (e.g. a page with two boards + one status).
//
// Returns { setStatus, connect, disconnect, row, transportEl, ipEl,
//           connectEl, disconnectEl }. `row` lets a sketch append extra
// controls (e.g. bus RX/TX pins) to the same connection row; the element
// refs let it read the current transport/IP.
//
// Configure pins in your sketch with the library's own event:
//   arduino.on('ready', () => { ...configure pins here... });
//
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

// --- Autofill-warning hygiene (runs once when this file loads) -----------
// p5's createInput()/createSelect() — and some tools' dynamically-built
// controls — make <input>/<select> elements with no name or id, which the
// browser flags as an autofill risk in the console. Give every such field a
// harmless unique name, now and as new ones appear.
(function nameFormFields() {
    let n = 0;
    const fix = (el) => {
        if (!el || el.nodeType !== 1 || el.name || el.id) return;
        const t = el.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') el.name = 'pf-' + (++n);
    };
    const sweep = () => document.querySelectorAll('input, select, textarea').forEach(fix);
    sweep();                        // fields already in the HTML
    requestAnimationFrame(sweep);   // fields the sketch adds during setup()
    new MutationObserver((muts) => {
        for (const m of muts) m.addedNodes.forEach((node) => {
            fix(node);
            if (node.querySelectorAll) node.querySelectorAll('input, select, textarea').forEach(fix);
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
})();

function setupConnection(arduino, opts = {}) {
    const STORE    = opts.store || 'pardalote-example';
    const DEFAULTS = { ip: '192.168.x.x', transport: 'wifi', ...(opts.defaults || {}) };
    const saved    = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
    const LABEL    = opts.label || 'Board';
    const manageStatus = opts.manageStatus !== false;   // default true

    const statusEl  = document.getElementById('status');
    const setStatus = (s) => { if (statusEl) statusEl.textContent = 'status: ' + s; };
    const emit      = (s) => { if (manageStatus) setStatus(s); };   // gated: skipped when the sketch owns status

    let manualDisconnect = false, usbBusy = false;

    // --- Board row: WiFi/USB dropdown, IP field, Connect / Disconnect ---
    // Built with the DOM (not p5) so this file works in any example, and placed
    // right under the page header — above the canvas/display — no matter when
    // the sketch calls us.
    const row = document.createElement('div');
    row.className = 'row pardalote-conn';
    // name= keeps the browser's autofill warning quiet; autocomplete=off stops
    // it offering to fill an IP field with names/addresses. type=button so a
    // stray Enter can't try to submit (there's no form here anyway).
    row.innerHTML =
        '<span class="lbl">' + LABEL + '</span>' +
        '<select name="pardalote-transport"><option value="WiFi">WiFi</option><option value="USB">USB</option></select>' +
        '<input name="pardalote-ip" type="text" autocomplete="off" style="width:130px">' +
        '<button type="button" class="primary">Connect</button>' +
        '<button type="button">Disconnect</button>';
    // Place the row right under the page header — inside whatever holds #top
    // (usually <main>, but some tools put the header in a separate band). When a
    // page sets up more than one board, each new row lands after the previous one.
    const top   = document.getElementById('top');
    const host  = (top && top.parentElement) || document.querySelector('main');
    const prior = host.querySelectorAll(':scope > .pardalote-conn');
    const anchor = prior.length ? prior[prior.length - 1] : top;
    host.insertBefore(row, anchor ? anchor.nextSibling : host.firstChild);

    const transportEl = row.querySelector('select');
    const ipEl        = row.querySelector('input');
    const [connectEl, disconnectEl] = row.querySelectorAll('button');
    ipEl.value        = saved.ip;
    transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';

    transportEl.onchange = switchTransport;
    connectEl.onclick    = doConnect;
    disconnectEl.onclick = doDisconnect;
    applyTransport();

    // --- Arduino lifecycle (button state + status only) ---------------
    // The sketch attaches its own arduino.on('ready', …) to configure pins —
    // these events support multiple listeners, so both fire.
    arduino.on('ready', () => { setConnected(true); emit('ready'); });
    arduino.on('disconnect', () => {
        setConnected(false);
        // 'usbBusy' fires just before this when a silent reconnect finds the
        // board back on WiFi — say so instead of a misleading "reconnecting…".
        if (usbBusy) { usbBusy = false; emit('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) emit('reconnecting…');
    });
    arduino.on('usbBusy', () => { usbBusy = true; });

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else emit("enter your board's IP and press Connect");

    // --- helpers ------------------------------------------------------
    function persist() {
        saved.ip = ipEl.value.trim();
        saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
        localStorage.setItem(STORE, JSON.stringify(saved));
    }
    async function doConnect() {
        persist();
        manualDisconnect = false;
        if (saved.transport === 'usb') {
            emit('connecting over USB…');
            await arduino.connectSerial(PROMPT);   // always raise the port picker
            if (!arduino.socket) emit('press Connect and choose the USB port');
            return;
        }
        const ip = ipEl.value.trim();
        if (!ip || ip.includes('x')) { emit("enter your board's IP and press Connect"); return; }
        arduino.connect(ip); emit('connecting…');
    }
    function doDisconnect() {
        manualDisconnect = true;
        disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
        connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
        arduino.disconnect();
        setTimeout(() => setConnected(false), 3000);   // safety net if 'disconnect' is slow
        emit('disconnected — press Connect to resume');
    }
    // WiFi shows the IP field; USB hides it (the browser's port picker chooses).
    function applyTransport() {
        ipEl.style.display = (transportEl.value === 'USB') ? 'none' : '';
    }
    // Green "Connected" when live, plain "Connect" otherwise; restore Disconnect.
    function setConnected(on) {
        connectEl.textContent = on ? 'Connected' : 'Connect';
        connectEl.classList.toggle('connected', on);
        connectEl.classList.toggle('primary', !on);
        if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
    }
    // Flipping WiFi/USB drops the current connection — a browser holds ONE link.
    function switchTransport() {
        manualDisconnect = true;
        arduino.disconnect(); setConnected(false);
        persist(); applyTransport();
        emit('channel switched — press Connect');
    }

    // Handle back to the sketch: status/reconnect helpers, plus the row and its
    // fields so a sketch can append extra controls or read the current values.
    return { setStatus, connect: doConnect, disconnect: doDisconnect,
             row, transportEl, ipEl, connectEl, disconnectEl };
}
