// ==============================================================
// Potentiometer — Shared Input example
//
// The Arduino sketch calls Pardalote.share(A0, ANALOG_INPUT_MODE)
// once in setup(), which tells THIS browser to auto-start polling A0.
// All we need to do here is listen on the pin handle — no pinMode,
// no analogRead, no polling code at all on the JS side.
// ==============================================================

const ARDUINO_IP = '172.20.10.5';   // Change this to your Arduino's IP
const POT        = 'A0';

const arduino = new Arduino();
arduino.connect(ARDUINO_IP);

// Pin handles resolve alias strings like 'A0' lazily, so this listener
// can be registered right away — it starts firing once the board's
// alias table arrives with the connection handshake.
arduino.pin(POT).on('change', ({ value }) => {
    document.getElementById('value').textContent = value;
    const pct = (value / arduino.analogMax) * 100;
    document.getElementById('bar').style.width = pct + '%';
});

// Connection indicator
arduino.on('ready',      () => setStatus('ready'));
arduino.on('disconnect', () => setStatus('waiting for connection…'));

function setStatus(s) {
    document.getElementById('status').textContent = 'status: ' + s;
}
