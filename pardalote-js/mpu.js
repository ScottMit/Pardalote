// ==============================================================
// mpu.js
// Pardalote Generic MPU / IMU Extension
// Version v1.1
// by Scott Mitchell
// GPL-3.0 License
//
// Supports MPU-6050, MPU-6500, MPU-9250, MPU-9255,
//          LSM6DS3, LSM6DSOX (and future sensors added to
//          the SENSORS[] table in PardaloteMPU.h).
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('imu', new MPU('6050'));     // MPU-6050
//   arduino.add('imu', new MPU('LSM6DS3')); // STMicro LSM6DS3
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.imu.attach();               // uses model default address
//       arduino.imu.attach(0x69);           // override I2C address
//       arduino.imu.attach(0x68, 21, 22);   // ESP32 custom SDA/SCL pins
//
//       arduino.imu.onRead(({ accel, gyro, temp }) => {
//           console.log('accel:', accel);  // { x, y, z } in g
//           console.log('gyro:',  gyro);   // { x, y, z } in °/s
//           console.log('temp:',  temp);   // °C
//       });
//       arduino.imu.read(20);              // poll every 20 ms (50 Hz)
//   });
//
// The model name string is sent in the payload of CMD_MPU_ATTACH and
// matched against SENSORS[i].name on the firmware side. Row order in
// SENSORS[] does not affect anything — the two tables are coupled only
// by the name string, so adding or reordering sensors on either side
// is safe.
// ==============================================================

const DEVICE_MPU = 203;

const CMD_MPU_ATTACH          = 0x28;
const CMD_MPU_DETACH          = 0x29;
const CMD_MPU_READ            = 0x2A;
const CMD_MPU_SET_ACCEL_RANGE = 0x2B;
const CMD_MPU_SET_GYRO_RANGE  = 0x2C;
const CMD_MPU_CALIBRATE       = 0x2D;

// Human-readable range labels indexed by range setting (0–3)
const MPU_ACCEL_RANGES = [2, 4, 8, 16];          // ± g
const MPU_GYRO_RANGES  = [250, 500, 1000, 2000];  // ± °/s

// -------------------------------------------------------------------
// MPU_MODELS — maps model name string to its DOF and default I2C address.
//
// The key is the wire identifier sent in the payload of CMD_MPU_ATTACH.
// It must match a SENSORS[i].name on the firmware side.
//
// dof  — degrees of freedom (6 or 9), for display only.
// addr — default I2C address used when attach() is called without
//         an address argument.
// -------------------------------------------------------------------
const MPU_MODELS = {
    // InvenSense / TDK MPU family
    '6050':     { dof: 6, addr: 0x68 },
    '6500':     { dof: 6, addr: 0x68 },
    '9250':     { dof: 9, addr: 0x68 },
    '9255':     { dof: 9, addr: 0x68 },
    // STMicroelectronics LSM6 family
    'LSM6DS3':  { dof: 6, addr: 0x6A },
    'LSM6DSOX': { dof: 6, addr: 0x6A },
};

class MPU extends Extension {
    static deviceId = DEVICE_MPU;

    // -------------------------------------------------------------------
    // constructor(model?)
    //
    // model — model number or string key from MPU_MODELS.
    //         Default: 6050
    //
    // Examples:
    //   new MPU()            → MPU-6050  (default)
    //   new MPU('6050')      → MPU-6050
    //   new MPU('9250')      → MPU-9250  (9-DOF)
    //   new MPU('LSM6DS3')   → LSM6DS3
    //   new MPU('LSM6DSOX')  → LSM6DSOX
    // -------------------------------------------------------------------
    constructor(model = '6050') {
        super();

        const def = MPU_MODELS[model];
        if (!def) {
            throw new Error(
                `MPU: unknown model "${model}". ` +
                `Valid options: ${Object.keys(MPU_MODELS).join(', ')}`
            );
        }

        this.model    = model;
        this.dof      = def.dof;
        this._defAddr = def.addr;

        // Hardware state
        this.isAttached = false;
        this.address    = def.addr;
        this.accelRange = 0;  // 0=±2g,   1=±4g,   2=±8g,   3=±16g
        this.gyroRange  = 0;  // 0=±250°/s 1=±500°/s 2=±1000°/s 3=±2000°/s

        // Latest sensor reading
        this.accel = { x: 0, y: 0, z: 0 };  // g
        this.gyro  = { x: 0, y: 0, z: 0 };  // °/s
        this.temp  = 0;                       // °C

        // Calibration offsets (received from Arduino after calibrate())
        this.calibration  = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
        this.isCalibrated = false;

        // Periodic read
        this._readTimer    = null;
        this._readInterval = 0;

        // Set true when Arduino announces this MPU's attach state on connect.
        // _reRegister() uses this to skip re-sending CMD_MPU_ATTACH when the
        // Arduino is already in sync — only replay when it has reset.
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // attach(address?, sda?, scl?)
    //
    // address  — I2C address. Defaults to the model's standard address.
    //             MPU family: 0x68 (AD0 LOW) or 0x69 (AD0 HIGH)
    //             LSM6 family: 0x6A (SA0 LOW) or 0x6B (SA0 HIGH)
    // sda, scl — custom I2C pins for ESP32 (-1 = use board default).
    //             Only sent when both are ≥ 0.
    // -------------------------------------------------------------------
    attach(address, sda = -1, scl = -1) {
        address       = address ?? this._defAddr;
        this.address  = address;
        this.isAttached = true;

        // Model name travels in the payload; SDA/SCL (ESP32 only) are params 2/3.
        const params = [this.logicalId, address];
        if (sda >= 0 && scl >= 0) params.push(sda, scl);
        this.arduino.send(encodeFrame(CMD_MPU_ATTACH, DEVICE_MPU, params, this.model));
        return this;
    }

    // -------------------------------------------------------------------
    // detach()
    // -------------------------------------------------------------------
    detach() {
        this._stopRead();
        this.arduino.send(encodeFrame(CMD_MPU_DETACH, DEVICE_MPU, [this.logicalId]));
        this.isAttached = false;
        return this;
    }

    // -------------------------------------------------------------------
    // read(interval?)
    //
    // read()          — request one reading; 'read' event fires on response.
    // read(interval)  — poll every interval ms; 'read' fires each time.
    // read(END)       — stop any active periodic poll.
    //
    // Note: each read() call blocks the Arduino I2C bus for ~1 ms.
    // Keep the interval ≥ 10 ms for stable results; 20–50 ms is typical.
    // -------------------------------------------------------------------
    read(interval) {
        if (interval === END) {
            this._stopRead();
            return this;
        }
        if (this._readTimer && (interval === undefined || interval === this._readInterval)) {
            return this;
        }
        this._stopRead();
        this._sendReadRequest();
        if (interval !== undefined) {
            this._readInterval = interval;
            this._readTimer = setInterval(() => this._sendReadRequest(), interval);
        }
        return this;
    }

    _sendReadRequest() {
        if (!this.isAttached) return;
        this.arduino.send(encodeFrame(CMD_MPU_READ, DEVICE_MPU, [this.logicalId]));
    }

    _stopRead() {
        if (this._readTimer) { clearInterval(this._readTimer); this._readTimer = null; }
        this._readInterval = 0;
    }

    // -------------------------------------------------------------------
    // setAccelRange(g)
    //
    // g — one of 2, 4, 8, 16. Sets the accelerometer ±g range.
    //
    // Higher range → less sensitivity but handles larger accelerations.
    // Default ±2g gives the finest resolution for gentle motion.
    // Unknown values are rejected with a console warning; the current
    // range is left unchanged.
    // -------------------------------------------------------------------
    setAccelRange(g) {
        const idx = MPU_ACCEL_RANGES.indexOf(g);
        if (idx === -1) {
            console.warn(`MPU ${this.logicalId}: invalid accel range ±${g}g — valid values: ${MPU_ACCEL_RANGES.join(', ')}`);
            return this;
        }
        this.accelRange = idx;
        this.arduino.send(encodeFrame(CMD_MPU_SET_ACCEL_RANGE, DEVICE_MPU,
            [this.logicalId, idx]));
        return this;
    }

    // -------------------------------------------------------------------
    // setGyroRange(dps)
    //
    // dps — one of 250, 500, 1000, 2000. Sets the gyroscope ±°/s range.
    //
    // Default ±250°/s gives the finest resolution for slow rotation.
    // Use ±2000°/s for fast spins (e.g. RC vehicles, drones).
    // Unknown values are rejected with a console warning; the current
    // range is left unchanged.
    // -------------------------------------------------------------------
    setGyroRange(dps) {
        const idx = MPU_GYRO_RANGES.indexOf(dps);
        if (idx === -1) {
            console.warn(`MPU ${this.logicalId}: invalid gyro range ±${dps}°/s — valid values: ${MPU_GYRO_RANGES.join(', ')}`);
            return this;
        }
        this.gyroRange = idx;
        this.arduino.send(encodeFrame(CMD_MPU_SET_GYRO_RANGE, DEVICE_MPU,
            [this.logicalId, idx]));
        return this;
    }

    // -------------------------------------------------------------------
    // calibrate(samples?)
    //
    // Place the sensor flat with Z pointing UP and call this once.
    // The Arduino collects `samples` readings (default 200) and computes
    // offset corrections applied to all subsequent reads.
    //
    // After calibration:
    //   accel: x ≈ 0g, y ≈ 0g, z ≈ +1g  (gravity preserved on Z axis)
    //   gyro:  x ≈ 0,  y ≈ 0,  z ≈ 0
    //
    // The 'calibrate' event fires when the Arduino finishes (~400 ms at
    // 200 samples). The WebSocket will be unresponsive during this time.
    //
    // Calibration offsets are re-sent during announce so a reconnecting
    // browser receives the current offsets without re-running the process.
    // -------------------------------------------------------------------
    calibrate(samples = 200) {
        if (!this.isAttached) {
            console.warn(`MPU ${this.logicalId}: not attached`);
            return this;
        }
        this.arduino.send(encodeFrame(CMD_MPU_CALIBRATE, DEVICE_MPU,
            [this.logicalId, samples]));
        return this;
    }

    // -------------------------------------------------------------------
    // Callback shortcuts
    // -------------------------------------------------------------------
    onRead(fn)      { return this.on('read',      fn); }
    onCalibrate(fn) { return this.on('calibrate', fn); }

    // -------------------------------------------------------------------
    // Convenience getters
    // -------------------------------------------------------------------
    get accelRangeG()  { return MPU_ACCEL_RANGES[this.accelRange]; }
    get gyroRangeDps() { return MPU_GYRO_RANGES[this.gyroRange]; }

    // -------------------------------------------------------------------
    // Board switch — called by Arduino.connect() to wipe per-board state.
    // Identity fields (model, _defAddr, dof) are constructor-set
    // and preserved; the announce-drift handler in handleMessage refreshes
    // them if the new board reports a different sensor.
    // -------------------------------------------------------------------
    _reset() {
        this._stopRead();
        this.isAttached          = false;
        this.address             = this._defAddr;
        this.accelRange          = 0;
        this.gyroRange           = 0;
        this.accel               = { x: 0, y: 0, z: 0 };
        this.gyro                = { x: 0, y: 0, z: 0 };
        this.temp                = 0;
        this.calibration         = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
        this.isCalibrated        = false;
        this._announcedByArduino = false;
    }

    // -------------------------------------------------------------------
    // Reconnect — restores attach and range state on Arduino reset.
    // Calibration offsets are stored on the Arduino and re-sent during
    // announce — they do not need to be replayed from JS.
    // -------------------------------------------------------------------
    _reRegister() {
        if (!this.isAttached) {
            this._announcedByArduino = false;
            return;
        }

        // Only replay attach/ranges if the Arduino didn't announce us — i.e.
        // it has reset and lost state. If announce did sync us, skip the
        // replay (avoids duplicate Serial output and redundant I2C init).
        if (!this._announcedByArduino) {
            // Model name in payload so the firmware re-initialises the correct sensor.
            this.arduino.send(encodeFrame(CMD_MPU_ATTACH, DEVICE_MPU,
                [this.logicalId, this.address], this.model));
            if (this.accelRange !== 0)
                this.arduino.send(encodeFrame(CMD_MPU_SET_ACCEL_RANGE, DEVICE_MPU,
                    [this.logicalId, this.accelRange]));
            if (this.gyroRange !== 0)
                this.arduino.send(encodeFrame(CMD_MPU_SET_GYRO_RANGE, DEVICE_MPU,
                    [this.logicalId, this.gyroRange]));
        }

        // Periodic read state lives on the Arduino's WebSocket-client tracking
        // (cleared on disconnect), so always re-start polling if it was active.
        if (this._readInterval > 0) {
            this._sendReadRequest();
        }

        this._announcedByArduino = false;  // reset for next reconnect cycle
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            // State sync during announce — update local state silently.
            // Params: [id, addr], payload: model name string.
            case CMD_MPU_ATTACH:
                this.address             = frame.params[1];
                this.isAttached          = true;
                this._announcedByArduino = true;
                // If the firmware reports a different model than this instance
                // was constructed with (different firmware build, board swap,
                // multi-client race), refresh model/dof to match. Range and
                // calibration settings are intentionally preserved.
                if (frame.payload) {
                    const newModel = new TextDecoder().decode(frame.payload);
                    if (newModel !== this.model) {
                        const entry = MPU_MODELS[newModel];
                        if (entry) {
                            this.model = newModel;
                            this.dof   = entry.dof;
                        } else {
                            console.warn(
                                `MPU ${this.logicalId}: firmware reports unknown model "${newModel}" — add it to MPU_MODELS in mpu.js`
                            );
                            this.model = newModel;
                            this.dof   = 0;
                        }
                    }
                }
                break;

            case CMD_MPU_SET_ACCEL_RANGE:
                this.accelRange = frame.params[1];
                break;

            case CMD_MPU_SET_GYRO_RANGE:
                this.gyroRange = frame.params[1];
                break;

            // Poll response — update readings and fire 'read' event.
            // Params: [id, ax, ay, az, gx, gy, gz, temp]  (floats)
            case CMD_MPU_READ:
                this.accel.x = frame.params[1];
                this.accel.y = frame.params[2];
                this.accel.z = frame.params[3];
                this.gyro.x  = frame.params[4];
                this.gyro.y  = frame.params[5];
                this.gyro.z  = frame.params[6];
                this.temp    = frame.params[7];
                this._emit('read', {
                    accel: { ...this.accel },
                    gyro:  { ...this.gyro },
                    temp:  this.temp,
                });
                break;

            // Calibration complete (or announce sync of existing offsets).
            // Params: [id, ax, ay, az, gx, gy, gz]  (floats)
            case CMD_MPU_CALIBRATE:
                this.calibration = {
                    ax: frame.params[1], ay: frame.params[2], az: frame.params[3],
                    gx: frame.params[4], gy: frame.params[5], gz: frame.params[6],
                };
                this.isCalibrated = true;
                this._emit('calibrate', { ...this.calibration });
                break;
        }
    }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        const modelName = this.model;
        return {
            logicalId:    this.logicalId,
            model:        modelName,
            dof:          this.dof,
            address:      `0x${this.address.toString(16).toUpperCase()}`,
            attached:     this.isAttached,
            accelRange:   `±${this.accelRangeG}g`,
            gyroRange:    `±${this.gyroRangeDps}°/s`,
            accel:        { ...this.accel },
            gyro:         { ...this.gyro },
            temp:         this.temp,
            calibrated:   this.isCalibrated,
            calibration:  { ...this.calibration },
        };
    }
}

// Let the core materialise an MPU when the SKETCH creates one
// (PardaloteMPU.attach("imu", "6050") → CMD_SHARE → arduino.imu).
registerExtensionType(MPU);
