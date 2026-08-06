// ==============================================================
// NeoPixel — p5.js + Pardalote
// Basic example: mix a colour with the mouse and the LED strip
// follows it live. Across the canvas = hue, up and down = brightness.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '192.168.x.x';   // Change this to your Arduino's IP

let arduino;

let pixelPin = 11;
let numPixels = 8;

function setup() {
    createCanvas(600, 400);
    createDiv('Move the mouse: across for hue, up and down for brightness. '
        + 'The dots along the bottom preview the strip.').class('hint').parent(select('main'));
    colorMode(HSB);

    // create Arduino and register the NeoPixel strip
    arduino = new Arduino();
    arduino.add('strip', new NeoPixel());

    // configure the strip once the Arduino is ready
    arduino.on('ready', () => {
        arduino.strip.init(pixelPin, numPixels);   // pin, number of pixels
        arduino.strip.setBrightness(50);
        arduino.strip.clear();
        arduino.strip.show();                      // show() sends it to the Arduino
    });

    // open the WebSocket connection
    arduino.connect(ArduinoIP);
}

function draw() {
    // mix a colour with the mouse: x = hue, y = brightness
    let h = map(mouseX, 0, width, 0, 360);
    let b = map(mouseY, 0, height, 100, 15);
    let c = color(h, 90, b);

    // the canvas IS the colour…
    background(c);

    // …and the strip matches it. fill(color, first_pixel, count), then
    // show() sends the buffered colours to the Arduino (rate-limited by
    // the library, so calling it every frame is fine).
    if (arduino.connected) {
        let neoColor = arduino.strip.Color(red(c), green(c), blue(c));
        arduino.strip.fill(neoColor, 0, numPixels);
        arduino.strip.show();
    }

    // preview the strip: one dot per pixel along the bottom
    stroke(0, 0, 100); strokeWeight(2); fill(c);
    for (let i = 0; i < numPixels; i++) {
        let x = map(i, 0, numPixels - 1, 60, width - 60);
        circle(x, height - 40, 24);
    }
}
