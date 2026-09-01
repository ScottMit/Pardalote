// =============================================
// Control panel — every pin, live (a Pardalote tool)
// Works out of the box: the connection is set on the page (and
// remembered by this browser) — no code editing needed.
// House style: see style.css — shared by every Pardalote example.
// =============================================

// --- Saved settings (browser localStorage) -----------------------------
// The connection (IP / transport) is remembered separately by connect.js;
// this store just holds the last board shown.
const STORE = 'pardalote-control-panel-cfg';
const saved = { board: '', ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    localStorage.setItem(STORE, JSON.stringify(saved));
}

let arduino;
let boardSelect, statusEl;
let panelEl      = null;
let currentBoard = null;   // name of the board currently rendered
let manualBoard  = false;  // true if the user has manually chosen a board

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
    const head = select('#head');
    statusEl = select('#status');

    arduino = new Arduino();
    setupConnection(arduino, { store: 'pardalote-control-panel' });   // Board controls + connection

    // Board selector — auto-set from the HELLO handshake unless chosen here
    let r = row(head, 'Board type');
    boardSelect = createSelect().parent(r);
    Object.keys(BOARDS).forEach(name => boardSelect.option(name));
    boardSelect.changed(() => {
        manualBoard = true;   // user has taken control — suppress auto-switch
        switchBoard(boardSelect.value());
    });

    // Auto-switch to the board reported in the HELLO handshake,
    // unless the user has manually chosen a different board.
    arduino.on('ready', () => {
        if (!manualBoard) switchBoard(arduino.board);
        setStatus(`ready — ${arduino.board}`);
    });

    // — Initial control panel: last board used, else the first known —
    const initial = BOARDS[saved.board] ? saved.board : Object.keys(BOARDS)[0];
    boardSelect.elt.value = initial;
    currentBoard = initial;
    panelEl = buildControlPanel(arduino, initial, BOARDS);
}

function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
