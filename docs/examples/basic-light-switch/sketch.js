// ==============================================================
// Basic light switch — Pardalote
// Two buttons drive an LED with digitalWrite().
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

const LED = 13;   // the LED pin (13 is the board's built-in LED)

const arduino = new Arduino();
setupConnection(arduino, { store: 'pardalote-basic-light-switch' });

// Configure the pin whenever the board is ready (it forgets pins on reset).
arduino.on('ready', () => arduino.pinMode(LED, OUTPUT));

// Browser → Arduino: the buttons send a digitalWrite.
document.getElementById('led-on').onclick  = () => arduino.digitalWrite(LED, HIGH);
document.getElementById('led-off').onclick = () => arduino.digitalWrite(LED, LOW);
