// =============================================
// Control Panel — sketch.js
// =============================================

// ── Default connection IP — update as needed ──
const IP = '192.168.x.x';
// ─────────────────────────────────────────────

let arduino;
let ipInput, connectBtn;
let panelEl = null;

function setup() {
    // — IP input + connect button —
    ipInput    = createInput(IP).size(140);
    connectBtn = createButton('Connect');
    connectBtn.mousePressed(() => arduino.connect(ipInput.value()));
    createElement('br');

    // — Board selector —
    const boardSelect = createSelect();
    boardSelect.style('margin-top', '6px');
    Object.keys(BOARDS).forEach(name => boardSelect.option(name));
    boardSelect.changed(() => {
        arduino.endAll();
        if (panelEl) panelEl.remove();
        panelEl = buildControlPanel(arduino, boardSelect.value(), BOARDS);
    });
    createElement('br');

    // — Small canvas for connection status only —
    createCanvas(220, 28);
    textFont('monospace');

    // — Arduino and initial control panel —
    arduino = new Arduino();
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
