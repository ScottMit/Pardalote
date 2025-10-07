// ==============================================================
// NeoPixel Control from P5js
// Basic example showing how to use P5js to control NeoPixels with JS2Arduino - arduinoComs.js
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.0.0.43';

let arduino;

function setup() {
    createCanvas(600, 600);
    colorMode(HSB);

    // connect to Arduino
    arduino = new Arduino();
    arduino.connect(ArduinoIP);

    // attach NeoPixel array to the Arduino
    arduino.add('neoStrip1', new NeoPixel(arduino));
    // Init strip: pin 6, 8 pixels
    arduino.neoStrip1.init(6, 8);
    // set strip brightness
    arduino.neoStrip1.setBrightness(50);
    // Clear everything
    arduino.neoStrip1.clear();
    // calling show() sends the commands to the Arduino
    arduino.neoStrip1.show();

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
    // set NeoPixel colors based on mouse location
    if (dist(mouseX, mouseY, width / 2, height / 2) < circleRadius){
        // make a rainbow
        rainbowEffect(arduino.neoStrip1, 8);
        fill(255);
    } else {
        // get pixel color at mouse location
        let pixelColor = get(mouseX, mouseY);
        fill(pixelColor);
        // calculate NeoPixel color
        let neoColor = arduino.neoStrip1.Color(red(pixelColor), green(pixelColor), blue(pixelColor));
        // fill(the_color, starting_pixel, number_of_pixels)
        arduino.neoStrip1.fill(neoColor, 0, 8);
        arduino.neoStrip1.show();
    }
    // draw central circle on screen
    circle(width / 2, height / 2, circleRadius*2);
}

function rainbowEffect(strip, numPixels) {
    for (let i = 0; i < numPixels; i++) {
        let hue = map(i, 0, numPixels - 1, 0, 360);
        colorMode(HSB);
        let rainbowColor = color(hue, 255, 255);
        colorMode(RGB);
        // calculate the color
        let c = strip.Color(red(rainbowColor), green(rainbowColor), blue(rainbowColor));
        // set the NeoPixel color
        strip.setPixelColor(i, c);
    }
    // calling show() sends the commands to the Arduino
    strip.show();
}