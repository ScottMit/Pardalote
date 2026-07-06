// ==============================================================
// Bus Servo Control Example
// Two Feetech ST-series bus servos on one UART: drag to command position,
// read live position/load/temperature back, and free a joint to hand-pose it.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.186';   // Change this to your Arduino's IP

let arduino;
let ready = false;
let status = 'connecting…';

// Two joints on the bus — servo IDs 1 and 2 (ST series, 0–4095).
const JOINTS = [
    { name: 'shoulder', servoId: 1 },
    { name: 'elbow',    servoId: 2 },
];

function setup() {
    createCanvas(600, 420);

    arduino = new Arduino();
    JOINTS.forEach(j => arduino.add(j.name, new BusServo()));
    arduino.connect(ArduinoIP);

    arduino.on('ready', () => {
        // configureBus() is optional — defaults to Serial1 @ 1 Mbps.
        // On ESP32 with custom UART pins: arduino.shoulder.configureBus({ rxPin: 18, txPin: 19 });
        JOINTS.forEach(j => {
            const s = arduino[j.name];
            s.attach(j.servoId, 'ST');
            s.setLimits(1024, 3072);   // servo-enforced ±quarter-turn from centre
            s.center();
            s.read(120);               // poll live feedback
        });
        ready = true;
        status = 'ready';
    });

    arduino.on('disconnect', () => { ready = false; status = 'reconnecting…'; });
}

function draw() {
    background(28);

    fill(255);
    textSize(16);
    text('Bus Servo Control Example', 20, 30);
    text(`status: ${status}`, 20, 54);

    textSize(13);
    text('Drag a dial to command position.  [1]/[2] free a joint to pose it by hand,', 20, 84);
    text('then press the same key to re-hold at the posed position.', 20, 102);

    if (ready) JOINTS.forEach((j, i) => drawJoint(arduino[j.name], j.name, 170 + i * 250, 260));
}

function drawJoint(s, label, cx, cy) {
    const angle = map(s.position, 0, s.resolution, -PI, PI);

    push();
    translate(cx, cy);

    noFill();
    stroke(s.torqueOn ? 90 : 200, s.torqueOn ? 90 : 140, 90);
    strokeWeight(2);
    circle(0, 0, 180);

    stroke(120, 200, 255);
    strokeWeight(5);
    line(0, 0, cos(angle - HALF_PI) * 82, sin(angle - HALF_PI) * 82);

    fill(255); noStroke();
    circle(0, 0, 9);
    textAlign(CENTER);
    textSize(14);
    text(label + (s.torqueOn ? '' : '  (free)'), 0, 118);
    textSize(12);
    text(`pos ${s.position}   ${s.positionDegrees.toFixed(0)}°`, 0, 138);
    text(`load ${s.load}   ${s.voltage.toFixed(1)}V   ${s.temperature}°C`, 0, 156);
    pop();
}

function mouseDragged() {
    if (!ready) return;
    JOINTS.forEach((j, i) => {
        const cx = 170 + i * 250, cy = 260;
        if (dist(mouseX, mouseY, cx, cy) < 95) {
            const a = atan2(mouseY - cy, mouseX - cx) + HALF_PI;
            const counts = map(a, -PI, PI, 0, arduino[j.name].resolution);
            arduino[j.name].write(counts, { speed: 3000 });
        }
    });
}

function keyPressed() {
    if (!ready) return;
    const idx = key === '1' ? 0 : key === '2' ? 1 : -1;
    if (idx < 0) return;
    const s = arduino[JOINTS[idx].name];
    if (s.torqueOn) s.disableTorque();   // go limp — pose by hand
    else            s.enableTorque();    // re-hold at current position
}
