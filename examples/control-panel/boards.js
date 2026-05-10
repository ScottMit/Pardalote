// =============================================
// boards.js — board definitions
// =============================================
//
// Each board entry has:
//
//   image   — path to a PNG of the board (relative to index.html)
//   imageW  — display width in px; height is derived from the image aspect ratio
//
//   pins    — flat array of all pins.
//             x, y are fractions of the image dimensions (0..1, origin top-left).
//             They mark the centre of the physical pin hole on the image.
//             Cards auto-extend LEFT  when x < 0.5
//                           RIGHT when x >= 0.5
//             Fill these in using the calibration tool.
//
//   Two pin forms:
//
//     Interactive pin — has num and modes:
//       { name: 'D3', num: 3, x: 0.95, y: 0.42,
//         modes: ['off', 'input', 'output', 'pwm out'] }
//
//     Label-only pin — no num, no modes (power rails, GND, etc.):
//       { name: 'GND', x: 0.10, y: 0.40 }
//
//   modes   — subset of: 'off', 'input', 'output', 'pwm out', 'analog in'

const BOARDS = {

    'UNO R4 WiFi': {
        image:  'boards/uno-r4-wifi.png',
        imageW: 300,
        pins: [
            // ── Power header (left side) — label only ───────── x      y
            { name: 'BOOT', x: 0.048, y: 0.428 },
            { name: 'IOREF', x: 0.048, y: 0.464 },
            { name: 'RESET', x: 0.048, y: 0.5 },
            { name: '3.3V',  x: 0.048, y: 0.536 },
            { name: '5V',    x: 0.048, y: 0.572 },
            { name: 'GND',   x: 0.048, y: 0.608 },
            { name: 'GND',   x: 0.048, y: 0.643 },
            { name: 'VIN',   x: 0.048, y: 0.679 },
            // ── Analog (left side) ──────────────────────────── x      y
            { name: 'A0', num: 14, x: 0.048, y: 0.749, modes: ['off', 'input', 'output', 'analog in'] },
            { name: 'A1', num: 15, x: 0.048, y: 0.785, modes: ['off', 'input', 'output', 'analog in'] },
            { name: 'A2', num: 16, x: 0.048, y: 0.821, modes: ['off', 'input', 'output', 'analog in'] },
            { name: 'A3', num: 17, x: 0.048, y: 0.856, modes: ['off', 'input', 'output', 'analog in'] },
            { name: 'A4', num: 18, x: 0.048, y: 0.892, modes: ['off', 'input', 'output', 'analog in'] },
            { name: 'A5', num: 19, x: 0.048, y: 0.928, modes: ['off', 'input', 'output', 'analog in'] },
            // ── Digital (right side) ────────────────────────── x      y
            { name: 'D0',  num:  0, x: 0.952, y: 0.929, modes: ['off', 'input', 'output'] },
            { name: 'D1',  num:  1, x: 0.952, y: 0.893, modes: ['off', 'input', 'output'] },
            { name: 'D2',  num:  2, x: 0.952, y: 0.857, modes: ['off', 'input', 'output'] },
            { name: 'D3',  num:  3, x: 0.952, y: 0.821, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D4',  num:  4, x: 0.952, y: 0.785, modes: ['off', 'input', 'output'] },
            { name: 'D5',  num:  5, x: 0.952, y: 0.749, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D6',  num:  6, x: 0.952, y: 0.713, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D7',  num:  7, x: 0.952, y: 0.678, modes: ['off', 'input', 'output'] },
            { name: 'D8',  num:  8, x: 0.952, y: 0.619, modes: ['off', 'input', 'output'] },
            { name: 'D9',  num:  9, x: 0.952, y: 0.583, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D10', num: 10, x: 0.952, y: 0.548, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D11', num: 11, x: 0.952, y: 0.512, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D12', num: 12, x: 0.952, y: 0.476, modes: ['off', 'input', 'output'] },
            { name: 'D13', num: 13, x: 0.952, y: 0.44, modes: ['off', 'input', 'output'] },
            { name: 'GND',  x: 0.952, y: 0.404 },
            { name: 'AREF', x: 0.952, y: 0.369 },
            { name: 'D18/SDA', num: 18, x: 0.952, y: 0.333, modes: ['off', 'input', 'output'] },
            { name: 'D19/SCL', num: 19, x: 0.952, y: 0.297, modes: ['off', 'input', 'output'] },
        ],
    },

    'ESP32-WROVER-DEV': {
        image:  'boards/esp32-wrover-dev.png',
        imageW: 300,
        pins: [
            // ── Left side (top → bottom) ─────────────────────── x      y
            { name: 'GND', x: 0.041, y: 0.022 },
            { name: 'FLASH_CLK', num: 6, x: 0.041, y: 0.066 },
            { name: 'FLASH_D0', num: 7, x: 0.041, y: 0.111 },
            { name: 'FLASH_D1', num: 8, x: 0.041, y: 0.156 },
            { name: 'A13', num: 15, x: 0.041, y: 0.2, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A12', num: 2, x: 0.041, y: 0.245, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A11', num: 0, x: 0.041, y: 0.289, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A10', num: 4, x: 0.041, y: 0.334, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'GND', x: 0.041, y: 0.378 },
            { name: 'GND', x: 0.041, y: 0.423 },
            { name: 'SS', num: 5, x: 0.041, y: 0.467, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'SCK', num: 18, x: 0.041, y: 0.512, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'MISO', num: 19, x: 0.041, y: 0.557, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'GND', x: 0.041, y: 0.601 },
            { name: 'SDA', num: 21, x: 0.041, y: 0.646, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'RX', num: 3, x: 0.041, y: 0.69 },
            { name: 'TX', num: 1, x: 0.041, y: 0.735 },
            { name: 'SCL', num: 22, x: 0.041, y: 0.779, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'MOSI', num: 23, x: 0.041, y: 0.824, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'GND', x: 0.041, y: 0.868 },
            // ── Right side (top → bottom) ────────────────────── x      y
            { name: 'VCC', x: 0.955, y: 0.022 },
            { name: 'VCC', x: 0.955, y: 0.066 },
            { name: 'FLASH_CMD', num: 11, x: 0.955, y: 0.112 },
            { name: 'FLASH_SD3', num: 10, x: 0.955, y: 0.155 },
            { name: 'FLASH_SD2', num: 9, x: 0.955, y: 0.199 },
            { name: 'A14', num:  13, x: 0.955, y: 0.245, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'GND', x: 0.955, y: 0.289 },
            { name: 'A15', num: 12, x: 0.955, y: 0.335, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A16', num: 14, x: 0.955, y: 0.378, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A17', num: 27, x: 0.955, y: 0.422, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A19', num: 26, x: 0.955, y: 0.468, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A18', num: 25, x: 0.955, y: 0.512, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A5', num: 33, x: 0.955, y: 0.556, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A4', num: 32, x: 0.955, y: 0.601, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A7', num: 35, x: 0.955, y: 0.645, modes: ['off', 'input', 'analog in'] },
            { name: 'A6', num: 34, x: 0.955, y: 0.691, modes: ['off', 'input', 'analog in'] },
            { name: 'VN/A3', num: 39, x: 0.955, y: 0.735, modes: ['off', 'input', 'analog in'] },
            { name: 'VP/A0', num: 36, x: 0.955, y: 0.779, modes: ['off', 'input', 'analog in'] },
            { name: 'RESET', x: 0.955, y: 0.824 },
            { name: '3.3V', x: 0.955, y: 0.868 },
        ],
    },

    'FireBeetle 2 ESP32-C5': {
        image:  'boards/firebeetle2-esp32-c5.png',
        imageW: 300,
        pins: [
            // ── Left side (top → bottom) ─────────────────────── x      y
            { name: 'RESET',   x: 0.046, y: 0.208 },
            { name: '3.3V',   x: 0.046, y: 0.25 },
            { name: 'GND',  x: 0.046, y: 0.333 },
            { name: 'SCK',   num:  23, x: 0.046, y: 0.415, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'MOSI',   num:  24, x: 0.046, y: 0.457, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'MISO',   num:  25, x: 0.046, y: 0.498, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'SCL',   num:  10, x: 0.046, y: 0.54, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'SDA',   num:  9, x: 0.046, y: 0.581, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'D9',   num:  28, x: 0.046, y: 0.623, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'D6',   num:  27, x: 0.046, y: 0.706, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D3',   num:  26, x: 0.046, y: 0.789, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D2',   num:  8, x: 0.046, y: 0.83, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'TX',   num:  11, x: 0.046, y: 0.872, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'RX',   num:  12, x: 0.046, y: 0.913, modes: ['off', 'input', 'output', 'pwm out'] },
            // ── Right side (top → bottom) ────────────────────── x      y
            { name: 'VIN',     x: 0.948, y: 0.374 },
            { name: '3.3V_C',  x: 0.948, y: 0.415 },
            { name: 'GND',  x: 0.948, y: 0.457 },
            { name: 'SCL',  num: 10, x: 0.948, y: 0.498, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'SDA',  num: 9, x: 0.948, y: 0.54, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'A4',  num: 5, x: 0.948, y: 0.581, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A3',  num: 4, x: 0.948, y: 0.623, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A2',  num: 3, x: 0.948, y: 0.664, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'A1',  num: 2, x: 0.948, y: 0.706, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'D13',  num: 15, x: 0.948, y: 0.789, modes: ['off', 'input', 'output', 'pwm out'] },
            { name: 'D12',  num: 6, x: 0.948, y: 0.83, modes: ['off', 'input', 'output', 'pwm out', 'analog in'] },
            { name: 'D11',  num: 7, x: 0.948, y: 0.872, modes: ['off', 'input', 'output', 'pwm out'] },
        ],
    },

};
