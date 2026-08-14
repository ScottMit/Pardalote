// ==============================================================
// NeoPixel — p5.js + Pardalote
// Basic example: mix a colour with the mouse and the LED strip
// follows it live. Across the canvas = hue, up and down = brightness.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '172.20.10.6';   // Change this to your Arduino's IP

let arduino;

let pixelPin = 18;
let numPixels = 8;

function setup() {
    createCanvas(600, 400);
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

    // draw color field on screen
    noStroke();
    for (let i = 0; i < width; i++) {
        let newH = map(i, 0, width, 0, 360);
        for (let j = 0; j < height; j++) {
            let newB = map(j, 0, height, 110, 0);
            fill(newH, 255, newB);
            rect(i, j, 1, 1);
        }
    }
    colorMode(RGB);
}

function draw() {
    let circleRadius = 50;
    let neoColor;
    // set NeoPixel colors based on mouse location
    if (dist(mouseX, mouseY, width / 2, height / 2) < circleRadius){
        // make white
        neoColor = arduino.strip.Color(255, 255, 255);
        fill(255);
    } else {
        // get pixel color at mouse location
        let pixelColor = get(mouseX, mouseY);
        fill(pixelColor);
        // calculate NeoPixel color
        neoColor = arduino.strip.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
    }

    // fill the strip. fill(color, first_pixel, count), then
    // show() sends the buffered colours to the Arduino (rate-limited by
    // the library, so calling it every frame is fine).
    if (arduino.connected) {
        arduino.strip.fill(neoColor, 0, numPixels);
        arduino.strip.show();
    }

    // preview the colour on a central circle
    circle(width / 2, height / 2, circleRadius*2);
}

