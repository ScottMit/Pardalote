// =============================================
// Control panel — every pin, live (a Pardalote tool)
// Works out of the box: the connection is set on the page (and
// remembered by this browser) — no code editing needed.
// House style: see style.css — shared by every Pardalote example.
// =============================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-control-panel';
const saved = { ip: '192.168.x.x', board: '', transport: 'wifi',
                ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip        = ipInput.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}

let arduino;
let ipInput, transportSelect, connectLbl, boardSelect, statusEl, connectBtn, disconnectBtn;
let panelEl      = null;
let currentBoard = null;   // name of the board currently rendered
let manualBoard  = false;  // true if the user has manually chosen a board
let manualDisconnect = false;
let usbBusy = false;   // board on WiFi, silent USB reconnect refused (see 'usbBusy')

function switchBoard(name) {
    if (!BOARDS[name]) {
        console.warn(`Control panel: unrecognised board "${name}" — add it to BOARDS in boards.js`);
        return;
    }
    if (name === currentBoard) return;
    currentBoard = name;
    arduino.endAll();
    if (panelEl) panelEl.remove();
    boardSelect.elt.value = name;
    panelEl = buildControlPanel(arduino, name, BOARDS);
    saved.board = name;               // remember the last board shown
    persist();
}

function setup() {
    noCanvas();
    // header band (graph-paper) holds the heading + controls; the boards
    // render below it in <main> on plain paper
    const main = select('#head');

    // Heading + status live in index.html (#top); the sketch just drives status.
    statusEl = select('#status');

    // Connection — WiFi (IP) or USB (Web Serial), remembered per browser
    let r = row(main, 'Board IP');
    connectLbl = r.elt.querySelector('.lbl');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi');
    transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipInput = createInput(saved.ip, 'text').parent(r);
    ipInput.style('width', '130px');
    connectBtn = createButton('Connect').parent(r).mousePressed(doConnect);
    connectBtn.addClass('primary');
    disconnectBtn = createButton('Disconnect').parent(r).mousePressed(doDisconnect);
    applyTransport();

    // Board selector — auto-set from the HELLO handshake unless chosen here
    r = row(main, 'Board');
    boardSelect = createSelect().parent(r);
    Object.keys(BOARDS).forEach(name => boardSelect.option(name));
    boardSelect.changed(() => {
        manualBoard = true;   // user has taken control — suppress auto-switch
        switchBoard(boardSelect.value());
    });

    // — Arduino —
    arduino = new Arduino();

    // Auto-switch to the board reported in the HELLO handshake,
    // unless the user has manually chosen a different board.
    arduino.on('ready', () => {
        if (!manualBoard) switchBoard(arduino.board);
        setStatus(`ready — ${arduino.board}`);
        setConnected(true);
        // arduino.setWriteThrottle(50);
    });
    arduino.on('disconnect', () => {
        setConnected(false);
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    // 'usbBusy': a silent USB reconnect reached a board that's on WiFi — it won't
    // switch without a picker gesture. The 'disconnect' that follows shows the prompt.
    arduino.on('usbBusy', () => { usbBusy = true; });

    // — Initial control panel: last board used, else the first known —
    const initial = BOARDS[saved.board] ? saved.board : Object.keys(BOARDS)[0];
    boardSelect.elt.value = initial;
    currentBoard = initial;
    panelEl = buildControlPanel(arduino, initial, BOARDS);

    // Returning visit: reconnect with the remembered settings. (USB
    // auto-connects only if this page already holds the port permission —
    // otherwise the browser needs a click first.)
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

// WiFi mode shows the IP field; USB mode hides it (the browser's port
// picker does the choosing). The sketch side of USB is
// Pardalote.begin(PARDALOTE_SERIAL).
function applyTransport() {
    const usb = (saved.transport === 'usb');
    ipInput.style('display', usb ? 'none' : '');
    if (connectLbl) connectLbl.textContent = usb ? 'Board USB' : 'Board IP';
}

async function doConnect() {
    manualBoard = false;      // reset on each new connection attempt
    manualDisconnect = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        // No socket = no port chosen (picker cancelled).
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipInput.value().trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    persist();
    arduino.connect(ip);
    setStatus('connecting…');
}

function doDisconnect() {
    manualDisconnect = true;
    // USB port close can take a moment — show progress so the UI isn't "stuck".
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();     // the 'disconnect' event restores the button when done
    setTimeout(() => setConnected(false), 3000);   // safety: restore even if no event fires
    setStatus('disconnected — press Connect to resume');
}

// --- Connect-button state (connection standard — see PROJECT-STATUS) ---
// Green "Connected" when live, plain "Connect" otherwise; restore Disconnect.
function setConnected(on) {
    if (connectBtn) {
        connectBtn.html(on ? 'Connected' : 'Connect');
        connectBtn.removeClass(on ? 'primary' : 'connected').addClass(on ? 'connected' : 'primary');
    }
    if (!on && disconnectBtn) { disconnectBtn.html('Disconnect'); disconnectBtn.removeAttribute('disabled'); }
}
// Flipping WiFi/USB drops the current connection — a browser holds ONE link, so
// the "Connected" badge must not carry over to the newly-selected channel.
function switchTransport() {
    manualDisconnect = true;
    arduino.disconnect();
    setConnected(false);
    persist();
    applyTransport();
    setStatus('channel switched — press Connect');
}

function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
