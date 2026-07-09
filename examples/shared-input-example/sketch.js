// ==============================================================
// Potentiometer — Shared Input example
//
// The Arduino sketch calls Pardalote.share(A0, MODE_ANALOG_INPUT)
// once in setup(), which tells THIS browser to auto-start polling A0.
// All we need to do here is listen via onChange — no pinMode, no
// analogRead, no polling code at all on the JS side.
// ==============================================================

const ARDUINO_IP = '10.1.1.128';   // Change this to your Arduino's IP
const POT        = 'A0';

const arduino = new Arduino();
arduino.connect(ARDUINO_IP);

// Register the pin listener AFTER 'ready' — string aliases like 'A0'
// resolve from the board's HELLO handshake, which lands at 'ready'.
// Calling onChange('A0', …) before then throws "unknown pin alias".
arduino.on('ready', () => {
    setStatus(true);
    arduino.onChange(POT, value => {
        document.getElementById('value').textContent = value;
        const pct = (value / arduino.analogMax) * 100;
        document.getElementById('bar').style.width = pct + '%';
    });
});

// Connection indicator
arduino.on('disconnect', () => setStatus(false));

function setStatus(connected) {
    const el = document.getElementById('status');
    el.textContent = connected ? '● CONNECTED' : '● DISCONNECTED';
    el.className   = connected ? 'connected'   : 'disconnected';
}
