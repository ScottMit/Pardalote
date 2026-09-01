// ==============================================================
// connect-usb.js — USB-only connection UI for the HOSTED examples.
//
// This is a drop-in replacement for connect.js used ONLY by the runnable
// copies under docs/examples/<slug>/ (the "Try now over USB" pages). The docs
// site is served over HTTPS, and a board's WiFi link is a plain ws:// socket,
// which browsers block from an https page as mixed content — so the hosted
// pages offer USB (Web Serial) only. It mirrors connect.js's API — same
// options (store, label, manageStatus) and same return shape — so any sketch
// works unchanged, including multi-board pages.
//
// GENERATED: this file is written into each mirror by docs-src/build_examples.py.
// Edit the source at docs-src/connect-usb.js, never the copies. The WiFi/USB
// version the students copy lives in each examples/<slug>/connect.js.
//
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

function setupConnection(arduino, opts = {}) {
    const LABEL = opts.label || 'Board';
    const manageStatus = opts.manageStatus !== false;   // default true

    const statusEl  = document.getElementById('status');
    const setStatus = (s) => { if (statusEl) statusEl.textContent = 'status: ' + s; };
    const emit      = (s) => { if (manageStatus) setStatus(s); };

    let manualDisconnect = false;

    // --- Board row: label, then Connect / Disconnect (USB only) -------
    // Web Serial needs a real click, so there's no auto-connect on load. When a
    // page sets up more than one board, each new row lands after the previous.
    const row = document.createElement('div');
    row.className = 'row pardalote-conn';
    row.innerHTML =
        '<span class="lbl">' + LABEL + '</span>' +
        '<button type="button" class="primary">Connect</button>' +
        '<button type="button">Disconnect</button>';
    const top   = document.getElementById('top');
    const host  = (top && top.parentElement) || document.querySelector('main');
    const prior = host.querySelectorAll(':scope > .pardalote-conn');
    const anchor = prior.length ? prior[prior.length - 1] : top;
    host.insertBefore(row, anchor ? anchor.nextSibling : host.firstChild);

    const [connectEl, disconnectEl] = row.querySelectorAll('button');
    connectEl.onclick    = doConnect;
    disconnectEl.onclick = doDisconnect;

    // --- Arduino lifecycle (button state + status only) ---------------
    arduino.on('ready', () => { setConnected(true); emit('ready'); });
    arduino.on('disconnect', () => {
        setConnected(false);
        emit(manualDisconnect ? 'disconnected — press Connect to resume' : 'reconnecting…');
    });

    emit('press Connect and choose the USB port');

    // --- helpers ------------------------------------------------------
    async function doConnect() {
        manualDisconnect = false;
        emit('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always raise the port picker
        if (!arduino.socket) emit('press Connect and choose the USB port');
    }
    function doDisconnect() {
        manualDisconnect = true;
        disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
        connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
        arduino.disconnect();
        setTimeout(() => setConnected(false), 3000);   // safety net if 'disconnect' is slow
        emit('disconnected — press Connect to resume');
    }
    // Green "Connected" when live, plain "Connect" otherwise; restore Disconnect.
    function setConnected(on) {
        connectEl.textContent = on ? 'Connected' : 'Connect';
        connectEl.classList.toggle('connected', on);
        connectEl.classList.toggle('primary', !on);
        if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
    }

    // Same handle back to the sketch as connect.js (no transport/IP fields here).
    return { setStatus, connect: doConnect, disconnect: doDisconnect,
             row, transportEl: null, ipEl: null, connectEl, disconnectEl };
}
