// ==============================================================
// Potentiometer — Shared Input example
//
// The Arduino sketch calls Pardalote.share(A0, ANALOG_INPUT_MODE) once in
// setup(), which tells THIS browser to auto-start polling A0. All we do here
// is listen on the pin handle — no pinMode, no analogRead, no polling code on
// the JS side, and no pin to configure (the Arduino owns it).
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// ==============================================================

const POT = 'A0';   // shared input — matches the Arduino sketch

const arduino = new Arduino();
setupConnection(arduino, { store: 'pardalote-shared-potentiometer' });

// Pin handles resolve alias strings like 'A0' lazily, so this listener can be
// registered right away — it starts firing once the board's alias table
// arrives with the connection handshake.
arduino.pin(POT).on('change', ({ value }) => {
    document.getElementById('value').textContent = value;
    const pct = (value / arduino.analogMax) * 100;
    document.getElementById('bar').style.width = pct + '%';
});
