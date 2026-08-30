#!/usr/bin/env python3
"""Shared example metadata — the single source of truth for the examples gallery.

Pure data, no third-party imports, so both build_examples.py (which needs
markdown_it / pygments) and build_llms.py (stdlib-only) can read it without
pulling in build dependencies. Insertion order is the gallery reading order
(roughly beginner -> advanced).

  slug -> (title, blurb, emoji, gradient, [tags], level)
"""

EXAMPLES = {
    "control-panel": ("Control panel",
        "A dashboard for every pin on your board, laid out over a photo of it. Test circuits without writing a line of code.",
        "🎛️", "linear-gradient(135deg,#232129,#4a4652)", ["Multi-user", "Tool"], "Beginner"),
    "basic-light-switch": ("Basic light switch",
        "Two buttons on a web page turn the board's LED on and off. The simplest possible start — no frameworks at all.",
        "💡", "linear-gradient(135deg,#fdf0d4,#f2b705)", ["Basics"], "Beginner"),
    "potentiometer-p5js": ("Potentiometer",
        "Turn a knob, and a circle on screen grows and shrinks with it. Your first taste of live data flowing into a p5.js sketch.",
        "◉", "linear-gradient(135deg,#e3eef5,#8ec6e6)", ["Basics", "p5.js"], "Beginner"),
    "shared-light-switch": ("Shared light switch",
        "One light, four switches: two physical buttons and two on screen. Press any of them — everything stays in sync.",
        "🔦", "linear-gradient(135deg,#fbe3dc,#e08b6d)", ["Multi-user"], "Beginner"),
    "shared-potentiometer": ("Shared potentiometer",
        "The Arduino announces its own analog input and the browser listens — a turn of the knob shows up live on screen with no JS setup.",
        "🎚️", "linear-gradient(135deg,#efe7d8,#d9bf8c)", ["Multi-user", "Basics"], "Beginner"),
    "messaging": ("Messaging",
        "Send named key/value messages between the browser and the sketch — no pins involved — and inspect every frame on the wire with the live traffic monitor.",
        "✉️", "linear-gradient(135deg,#e7e3da,#b8b0a0)", ["Multi-user", "Tool"], "Intermediate"),
    "shared-servo": ("Shared servo",
        "The Arduino sketch creates the servo and the browser receives it automatically — then both sides drive the same horn.",
        "🤝", "linear-gradient(135deg,#e0ded1,#c2b280)", ["Multi-user", "Motion", "p5.js"], "Intermediate"),
    "servo-control": ("Servo control",
        "A full servo control panel: immediate and timed moves, soft limits, and homing, with a live gauge and call log.",
        "🦾", "linear-gradient(135deg,#e8e2d4,#c9bea4)", ["Motion", "Tool"], "Intermediate"),
    "stepper-motor": ("Stepper motor",
        "Precise position moves, continuous rotation, and a live position readout — the browser as a motor controller.",
        "⚙️", "linear-gradient(135deg,#e5e0f0,#b0a3d4)", ["Motion", "Tool"], "Intermediate"),
    "bus-servos": ("Bus servos",
        "Drive smart serial servos — the kind used in robot arms. Pose a joint by hand, read it back, and replay it.",
        "🤖", "linear-gradient(135deg,#dcefe0,#8fc79a)", ["Motion", "Tool"], "Advanced"),
    "coordinated-motion": ("Coordinated motion",
        "Two different motors — mix a servo, stepper, or bus servo — sweep in perfect unison using a group.",
        "🎛️", "linear-gradient(135deg,#fdf0d4,#f5c95c)", ["Motion", "Tool"], "Advanced"),
    "leader-follower": ("Leader → Follower",
        "Teleoperate a robot arm by hand: move a leader arm and a second follower arm mirrors it live, joint for joint — the LeRobot leader/follower rig, in the browser across two boards.",
        "🕹️", "linear-gradient(135deg,#d9ece8,#5fa89e)", ["Motion", "Tool"], "Advanced"),
    "gesture-builder": ("Gesture Builder",
        "Author expressive motion on a timeline — draw keyframes for any mix of servos, bus servos, and steppers, play it back phase-locked, and copy out the JavaScript or Arduino code.",
        "🎬", "linear-gradient(135deg,#e7e0f2,#a48fce)", ["Motion", "Tool"], "Advanced"),
    "neopixel": ("NeoPixel",
        "Mix a colour by moving the mouse across a hue-and-brightness field, and an LED strip follows the colour under your cursor live.",
        "🌈", "linear-gradient(135deg,#f3dce8,#d989b8)", ["Light", "p5.js"], "Intermediate"),
    "ultrasonic-sensor": ("Ultrasonic sensor",
        "A distance sensor paints a colour bar that responds as you move your hand closer and further away.",
        "📏", "linear-gradient(135deg,#dceef3,#7db8c9)", ["Sensors", "p5.js"], "Intermediate"),
    "IMU": ("Motion sensor (IMU)",
        "Tilt the sensor and watch a 3D model rotate with it, live, in all three axes.",
        "🧭", "linear-gradient(135deg,#e2e6f0,#94a3cc)", ["Sensors", "p5.js"], "Advanced"),
    "camera-stream": ("Camera stream",
        "Live video from an ESP32 camera lands on a p5.js canvas, pixels and all — ready for creative coding.",
        "📷", "linear-gradient(135deg,#e8ddd2,#c4a284)", ["Vision", "p5.js"], "Advanced"),
}
