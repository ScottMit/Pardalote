// =============================================
// Control Panel — sketch.js
// =============================================

// ── Default connection IP — update as needed ──
const IP = '192.168.x.x';
// ─────────────────────────────────────────────

let arduino;
let ipInput, connectBtn, boardSelect;
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
}

function setup() {
    // — IP input + connect button —
    ipInput    = createInput(IP).size(140);
    connectBtn = createButton('Connect');
    connectBtn.mousePressed(() => {
        manualBoard = false;  // reset on each new connection attempt
        arduino.connect(ipInput.value());
    });
    createElement('br');

    // — Board selector —
    boardSelect = createSelect();
    boardSelect.style('margin-top', '6px');
    Object.keys(BOARDS).forEach(name => boardSelect.option(name));
    boardSelect.changed(() => {
        manualBoard = true;   // user has taken control — suppress auto-switch
        switchBoard(boardSelect.value());
    });
    createElement('br');

    // — Small canvas for connection status only —
    createCanvas(220, 28);
    textFont('monospace');

    // — Arduino —
    arduino = new Arduino();

    // Auto-switch to the board reported in the HELLO handshake,
    // unless the user has manually chosen a different board.
    arduino.on('ready', () => { if (!manualBoard) switchBoard(arduino._board); });

    // — Initial control panel —
    panelEl = buildControlPanel(arduino, Object.keys(BOARDS)[0], BOARDS);
}

function draw() {
    background(26);

    noStroke();
    fill(arduino.connected ? color(60, 200, 80) : color(200, 50, 60));
    circle(14, 14, 12);

    fill(200);
    textSize(13);
    textAlign(LEFT, CENTER);
    text(arduino.connected ? 'Connected' : 'Disconnected', 26, 14);
}
