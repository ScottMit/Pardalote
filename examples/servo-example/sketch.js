// ==============================================================
// Servo Control Example
// Basic example showing how to use servos with Pardalote
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.186'; // Change this to your Arduino's IP

let arduino;
let servoPin = 5;
// We track the commanded angle locally for the on-screen visualization.
// arduino.myServo.read() exists too — but it round-trips to the Arduino,
// and on ESP32 it reads the PWM duty register which can return values
// slightly off the commanded angle. For just "what did I tell the servo
// to do?" tracking it locally is simpler and exact.
let angle = 90; // Starting angle
let machineState = 1;
let direction = 1; // 1 for increasing, -1 for decreasing

function setup() {
    createCanvas(600, 400);

    // Connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // Attach servo to the Arduino
    arduino.add('myServo', new Servo());

    // Attach servo to pin
    arduino.myServo.attach(servoPin);

    // Move to center position
    arduino.myServo.center();

    console.log("Servo attached to pin " + servoPin);
}

function draw() {
    background(50);

    // Draw servo position visualization
    drawServoVisualization();

    // Draw control instructions
    fill(255);
    textSize(16);
    text("Servo Control Example", 20, 30);
    text("Press 'M' to have the mouse X controls servo angle", 20, 60);
    text("Press 'S' to start auto sweep", 20, 90);
    text("Press 'L' to move the servo to the left", 20, 120);
    text("Press 'R' to move the servo to the right", 20, 150);
    text("Press 'C' to centre the servo", 20, 180);

    switch (machineState) {
        case 1: {
            // Control servo with mouse X position
            let mouseLoc = constrain(mouseX, 0, width);
            angle = map(mouseLoc, 0, width, 0, 180);
            arduino.myServo.write(angle);
            break;
        }
        case 2: {
            // autoSweep runs in background; arduino.myServo.angle holds the
            // current commanded angle, updated by each sweep step.
            angle = arduino.myServo.angle;
            break;
        }
        case 3: {
            angle = 90;
            arduino.myServo.center();
            break;
        }
        case 4: {
            angle = 0;
            arduino.myServo.min();
            break;
        }
        case 5: {
            angle = 180;
            arduino.myServo.max();
            break;
        }
    }
}

function drawServoVisualization() {
    push();
    translate(width / 2, 2 * height / 3);
    push();
    rotate(-PI/2);

    fill(100);
    rect(-30, -15, 60, 30);

    stroke(255, 100, 100);
    strokeWeight(4);
    let armAngle = map(angle, 0, 180, -PI/2, PI/2);
    line(0, 0, cos(armAngle) * 80, sin(armAngle) * 80);

    fill(255);
    noStroke();
    circle(0, 0, 8);

    pop();
    fill(255);
    textAlign(CENTER);
    text(Math.round(angle) + "°", 0, 60);

    pop();
}

function keyPressed() {
    if (key === 'm' || key === 'M') {
        machineState = 1; // manual
    }

    if (key === 's' || key === 'S') {
        if (machineState !== 2) {
            machineState = 2;
            autoSweep(); // start sweep loop once
        }
    }

    if (key === 'c' || key === 'C') {
        machineState = 3;
    }

    if (key === 'l' || key === 'L') {
        machineState = 4;
    }

    if (key === 'r' || key === 'R') {
        machineState = 5;
    }
}

async function autoSweep() {
    console.log("Starting auto sweep...");
    while (machineState === 2) {
        // Sweep from 0 → 180 over 2s
        await arduino.myServo.sweep(0, 180, 2000);
        if (machineState !== 2) break;  // stop if state changed

        // Small pause
        await new Promise(resolve => setTimeout(resolve, 100));
        if (machineState !== 2) break;  // stop if state changed

        // Sweep back from 180 → 0 over 2s in 10 steps
        await arduino.myServo.sweep(180, 0, 2000, 10);
        if (machineState !== 2) break;  // stop if state changed

        // Small pause
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log("Auto sweep stopped");
}
