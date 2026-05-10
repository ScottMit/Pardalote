// ==============================================================
// Simple Arduino LED Control Demo
// Basic example showing how to use p5.js to control an LED with Pardalote
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

// UPDATE THIS IP ADDRESS TO MATCH YOUR ARDUINO
let ArduinoIP = '10.1.1.161';

let arduino;

// Initialize when page loads
window.addEventListener('load', function() {
    // Connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // Set up pins once connected — pinMode must be called after the
    // connection is established, not before, as the frame would otherwise
    // be sent before the WebSocket is open and silently dropped.
    arduino.on('ready', function() {
        arduino.pinMode(13, OUTPUT);  // Built-in LED
    });

    // Set up button event listeners
    document.getElementById('led-on').addEventListener('click', function() {
        arduino.digitalWrite(13, HIGH);
    });

    document.getElementById('led-off').addEventListener('click', function() {
        arduino.digitalWrite(13, LOW);
    });
});