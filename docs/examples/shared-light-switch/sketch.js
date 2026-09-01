// ==============================================================
// Light Switch — Shared Control example
//
// Both the Arduino sketch and this browser can flip pin 13. The Arduino calls
// Pardalote.send(13, value) when its buttons fire; the browser calls
// arduino.digitalWrite(13, value) when its buttons are clicked. Each one's
// change becomes a broadcast the other side picks up via
// arduino.pin(LIGHT).on('change', …). The pin is set in the Arduino code.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// ==============================================================

const LIGHT = 13;   // shared pin — matches the Arduino sketch

const arduino = new Arduino();
setupConnection(arduino, { store: 'pardalote-shared-light-switch' });

// Browser → Arduino: clicking the buttons sends a normal digitalWrite.
document.getElementById('on-btn').onclick  = () => arduino.digitalWrite(LIGHT, HIGH);
document.getElementById('off-btn').onclick = () => arduino.digitalWrite(LIGHT, LOW);

// Arduino → Browser: any change to the shared pin (either side) lands here.
arduino.pin(LIGHT).on('change', ({ value }) => {
    const el = document.getElementById('light');
    el.textContent = value ? 'ON' : 'OFF';
    el.className   = value ? 'on' : 'off';
});
