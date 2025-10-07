// ==============================================================
// Servo Control Example
// Basic example showing how to use servos with JS2Arduino
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.0.0.43'; // Change this to your Arduino's IP

let arduino;
let angle = 90; // Starting angle
let machineState = 1;
let direction = 1; // 1 for increasing, -1 for decreasing

function setup() {
    createCanvas(600, 400);

    // Connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // Attach servo to the Arduino
    arduino.add('myServo', new Servo(arduino));

    // Attach servo to pin 5 (common servo pin)
    arduino.myServo.attach(5);

    // Move to center position
    arduino.myServo.center();

    console.log("Servo attached to pin 5");
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
            let targetAngle = map(mouseLoc, 0, width, 0, 180);
            arduino.myServo.write(targetAngle);
            break;
        }
        case 2: {
            // autoSweep runs in background, get the current angle
            break;
        }
        case 3: {
            arduino.myServo.center();
            break;
        }
        case 4: {
            arduino.myServo.min();
            break;
        }
        case 5: {
            arduino.myServo.max();
            break;
        }
    }
    angle = arduino.myServo.currentAngle;
}

function drawServoVisualization() {
    push();
    translate(width / 2, 2 * height / 3);

    fill(100);
    rect(-30, -15, 60, 30);

    stroke(255, 100, 100);
    strokeWeight(4);
    let armAngle = map(angle, 0, 180, -PI/2, PI/2);
    line(0, 0, cos(armAngle) * 80, sin(armAngle) * 80);

    fill(255);
    noStroke();
    circle(0, 0, 8);

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
