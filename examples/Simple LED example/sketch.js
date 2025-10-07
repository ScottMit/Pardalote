// ==============================================================
// Simple Arduino LED Control Demo
// Basic example showing how to use JS2Arduino - arduinoComs.js
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

// UPDATE THIS IP ADDRESS TO MATCH YOUR ARDUINO
let ArduinoIP = '10.0.0.43';

let arduino;

// Initialize when page loads
window.addEventListener('load', function() {
    // Connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // Set up pins
    arduino.pinMode(13, OUTPUT);  // Built-in LED

    // Set up button event listeners
    document.getElementById('led-on').addEventListener('click', function() {
        arduino.digitalWrite(13, HIGH);
    });

    document.getElementById('led-off').addEventListener('click', function() {
        arduino.digitalWrite(13, LOW);
    });
});