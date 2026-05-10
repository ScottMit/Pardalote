// =============================================
// Servo Test — sketch.js
// =============================================

// ── Pin assignments — update when changing boards ──
const PIN_SERVO = D9;   // servo signal wire
// ──────────────────────────────────────────────────

let arduino, servo;
let ipInput, connectBtn;
let attachBtn, detachBtn;
let angleSlider;
let sweepFromInput, sweepToInput, sweepTimeInput;

let confirmedAngle = 90;
let targetAngle    = 90;
let isAttached     = false;

const CX = 210;
const CY = 185;
const R  = 105;

function setup() {
    // — DOM controls above canvas —

    ipInput    = createInput('192.168.x.x').size(140);
    connectBtn = createButton('Connect');
    connectBtn.mousePressed(() => arduino.connect(ipInput.value()));

    createElement('br');

    attachBtn = createButton(`Attach ${PIN_SERVO}`);
    detachBtn = createButton('Detach');
    attachBtn.mousePressed(() => { if (arduino.connected) servo.attach(PIN_SERVO); });
    detachBtn.mousePressed(() => { if (arduino.connected) servo.detach(); });

    createElement('br');

    createSpan('Angle:').style('color', '#888').style('font-family', 'monospace');
    angleSlider = createSlider(0, 180, 90, 1).style('width', '220px');
    angleSlider.input(() => {
        targetAngle = angleSlider.value();
        if (arduino.connected) servo.write(targetAngle);
    });

    createElement('br');

    createButton('0°'  ).mousePressed(() => setTarget(0,   () => servo.min()   ));
    createButton('90°' ).mousePressed(() => setTarget(90,  () => servo.center()));
    createButton('180°').mousePressed(() => setTarget(180, () => servo.max()   ));

    createElement('br');

    createSpan('Sweep:').style('color', '#888').style('font-family', 'monospace');
    sweepFromInput = createInput('0'   ).size(34).attribute('type', 'number');
    createSpan('→').style('color', '#555').style('margin', '0 4px');
    sweepToInput   = createInput('180' ).size(34).attribute('type', 'number');
    createSpan('in').style('color', '#555').style('margin', '0 4px');
    sweepTimeInput = createInput('2000').size(46).attribute('type', 'number');
    createSpan('ms').style('color', '#555').style('margin', '0 4px');

    createButton('Sweep').mousePressed(() => {
        if (!arduino.connected) return;
        servo.sweep(
            int(sweepFromInput.value()),
            int(sweepToInput.value()),
            int(sweepTimeInput.value())
        );
    });
    createButton('Stop').mousePressed(() => {
        if (arduino.connected) servo.write(servo.angle);
    });

    // — Canvas —
    createCanvas(420, 235).style('display', 'block').style('margin-top', '8px');

    // — Arduino + Servo —
    arduino = new Arduino();
    servo   = new Servo();
    arduino.add('servo', servo);

    servo.onWrite(({ angle }) => {
        confirmedAngle = angle;
    });

    servo.onAttached(({ attached }) => {
        isAttached = attached;
    });
}

function draw() {
    background(26);

    // — Status dot —
    noStroke();
    fill(arduino.connected ? color(60, 200, 80) : color(200, 50, 60));
    circle(18, 18, 12);
    fill(200);
    textFont('monospace');
    textSize(13);
    textAlign(LEFT, CENTER);
    text(arduino.connected ? 'Connected' : 'Disconnected', 30, 18);

    if (!arduino.connected) return;

    // — Track arc (full 0–180°, dark) —
    noFill();
    stroke(50);
    strokeWeight(4);
    drawServoArc(0, 180);

    // — Active arc (0 to confirmed, orange) —
    stroke(255, 160, 0);
    strokeWeight(4);
    drawServoArc(0, confirmedAngle);

    // — Target tick (blue) —
    const ta = servoToRad(targetAngle);
    stroke(80, 150, 255);
    strokeWeight(2);
    line(
        CX + cos(ta) * (R - 6),
        CY - sin(ta) * (R - 6),
        CX + cos(ta) * (R + 14),
        CY - sin(ta) * (R + 14)
    );

    // — Confirmed needle —
    const ca = servoToRad(confirmedAngle);
    stroke(255, 160, 0);
    strokeWeight(2.5);
    line(CX, CY, CX + cos(ca) * R, CY - sin(ca) * R);

    // — Center dot —
    noStroke();
    fill(255, 160, 0);
    circle(CX, CY, 9);

    // — Angle readout —
    fill(220);
    noStroke();
    textSize(30);
    textAlign(CENTER, TOP);
    text(`${confirmedAngle}°`, CX, CY + 18);

    // — Attach status —
    textSize(11);
    fill(isAttached ? color(60, 200, 80) : color(180, 50, 50));
    text(isAttached ? 'ATTACHED' : 'DETACHED', CX, CY + 52);

    // — 0° / 180° labels —
    fill(100);
    textSize(11);
    textAlign(RIGHT, CENTER);
    text('0°', CX - R - 6, CY);
    textAlign(LEFT, CENTER);
    text('180°', CX + R + 6, CY);
}

// Map servo angle (0–180) to canvas radian (PI → 0, left → right through top)
function servoToRad(deg) {
    return map(deg, 0, 180, PI, 0);
}

// Draw an arc segment in servo-angle space
function drawServoArc(fromDeg, toDeg) {
    beginShape();
    for (let deg = fromDeg; deg <= toDeg; deg++) {
        const a = servoToRad(deg);
        vertex(CX + cos(a) * R, CY - sin(a) * R);
    }
    endShape();
}

// Set target angle and call servo method if connected
function setTarget(angle, method) {
    targetAngle = angle;
    angleSlider.value(angle);
    if (arduino.connected) method();
}
