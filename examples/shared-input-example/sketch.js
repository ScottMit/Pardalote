// ==============================================================
// Potentiometer — Shared Input example
//
// The Arduino sketch calls Pardalote.share(A0, MODE_ANALOG_INPUT)
// once in setup(), which tells THIS browser to auto-start polling A0.
// All we need to do here is listen via onChange — no pinMode, no
// analogRead, no polling code at all on the JS side.
// ==============================================================

const ARDUINO_IP = '192.168.1.42';   // Change this to your Arduino's IP
const POT        = 'A0';

const arduino = new Arduino();
arduino.connect(ARDUINO_IP);

arduino.onChange(POT, value => {
    document.getElementById('value').textContent = value;
    const pct = (value / arduino.analogMax) * 100;
    document.getElementById('bar').style.width = pct + '%';
});

// Connection indicator
arduino.on('ready',      () => setStatus(true));
arduino.on('disconnect', () => setStatus(false));

function setStatus(connected) {
    const el = document.getElementById('status');
    el.textContent = connected ? '● CONNECTED' : '● DISCONNECTED';
    el.className   = connected ? 'connected'   : 'disconnected';
}
