// ==============================================================
// Light Switch — Shared Control example
//
// Both the Arduino sketch and this browser can flip pin 13.
// The Arduino calls Pardalote.send(13, value) when its buttons
// fire; the browser calls arduino.digitalWrite(13, value) when
// its buttons are clicked. Each one's change becomes a broadcast
// that the other side picks up via arduino.pin(LIGHT).on('change', …).
// ==============================================================

const ARDUINO_IP = '172.20.10.5';   // Change this to your Arduino's IP
const LIGHT      = 13;

const arduino = new Arduino();
arduino.connect(ARDUINO_IP);

// Browser → Arduino: clicking the buttons sends a normal digitalWrite.
document.getElementById('on-btn').onclick  = () => arduino.digitalWrite(LIGHT, HIGH);
document.getElementById('off-btn').onclick = () => arduino.digitalWrite(LIGHT, LOW);

// Arduino → Browser: any change to pin 13 (either side) lands here.
arduino.pin(LIGHT).on('change', ({ value }) => {
    const el = document.getElementById('light');
    el.textContent = value ? 'ON' : 'OFF';
    el.className   = value ? 'on' : 'off';
});

// Connection indicator
arduino.on('ready',      () => setStatus('ready'));
arduino.on('disconnect', () => setStatus('waiting for connection…'));

function setStatus(s) {
    document.getElementById('status').textContent = 'status: ' + s;
}
