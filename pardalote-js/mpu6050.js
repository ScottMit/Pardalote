// ==============================================================
// mpu6050.js
// Pardalote MPU-6050 Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Supports up to 2 MPU-6050 sensors on the same I2C bus
// (addresses 0x68 and 0x69).
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('imu', new MPU6050());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.imu.attach(0x68);
//       arduino.imu.onRead(({ accel, gyro, temp }) => {
//           console.log('accel:', accel);  // { x, y, z } in g
//           console.log('gyro:',  gyro);   // { x, y, z } in °/s
//           console.log('temp:',  temp);   // °C
//       });
//       arduino.imu.read(50);  // poll every 50 ms
//   });
//
// To adapt for a different IMU, only MPUExtension.h needs to change.
// This JS file works with any sensor that uses the same command set.
// ==============================================================

const DEVICE_MPU = 203;

const CMD_MPU_ATTACH          = 0x28;
const CMD_MPU_DETACH          = 0x29;
const CMD_MPU_READ            = 0x2A;
const CMD_MPU_SET_ACCEL_RANGE = 0x2B;
const CMD_MPU_SET_GYRO_RANGE  = 0x2C;
const CMD_MPU_CALIBRATE       = 0x2D;

// Human-readable range labels indexed by range setting (0–3)
const MPU_ACCEL_RANGES = [2, 4, 8, 16];         // ± g
const MPU_GYRO_RANGES  = [250, 500, 1000, 2000]; // ± °/s

class MPU6050 extends Extension {
    static deviceId = DEVICE_MPU;

    constructor() {
        super();

        // Hardware state
        this.isAttached = false;
        this.address    = 0x68;
        this.accelRange = 0;  // 0=±2g, 1=±4g, 2=±8g, 3=±16g
        this.gyroRange  = 0;  // 0=±250, 1=±500, 2=±1000, 3=±2000 °/s

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
    }

    // -------------------------------------------------------------------
    // attach(address?, sda?, scl?)
    //
    // address  — I2C address: 0x68 (default) or 0x69 (AD0 pin HIGH)
    // sda, scl — custom I2C pins for ESP32 (-1 = use board default)
    // -------------------------------------------------------------------
    attach(address = 0x68, sda = -1, scl = -1) {
        this.address    = address;
        this.isAttached = true;
        const params = [this.logicalId, address];
        if (sda >= 0 && scl >= 0) params.push(sda, scl);
        this.arduino.send(encodeFrame(CMD_MPU_ATTACH, DEVICE_MPU, params));
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
    // setAccelRange(range)
    //
    // range — 0=±2g, 1=±4g, 2=±8g, 3=±16g
    //         or pass the ±g value directly: 2, 4, 8, or 16
    //
    // Higher range → less sensitivity but handles larger accelerations.
    // Default ±2g gives the finest resolution for gentle motion.
    // -------------------------------------------------------------------
    setAccelRange(range) {
        if (range > 3) range = MPU_ACCEL_RANGES.indexOf(range);
        range = Math.max(0, Math.min(3, range));
        this.accelRange = range;
        this.arduino.send(encodeFrame(CMD_MPU_SET_ACCEL_RANGE, DEVICE_MPU,
            [this.logicalId, range]));
        return this;
    }

    // -------------------------------------------------------------------
    // setGyroRange(range)
    //
    // range — 0=±250°/s, 1=±500°/s, 2=±1000°/s, 3=±2000°/s
    //         or pass the °/s value directly: 250, 500, 1000, or 2000
    //
    // Default ±250°/s gives the finest resolution for slow rotation.
    // Use ±2000°/s for fast spins (e.g. RC vehicles, drones).
    // -------------------------------------------------------------------
    setGyroRange(range) {
        if (range > 3) range = MPU_GYRO_RANGES.indexOf(range);
        range = Math.max(0, Math.min(3, range));
        this.gyroRange = range;
        this.arduino.send(encodeFrame(CMD_MPU_SET_GYRO_RANGE, DEVICE_MPU,
            [this.logicalId, range]));
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
    // Reconnect — restores attach and range state on Arduino reset.
    // Calibration offsets are stored on the Arduino and re-sent during
    // announce — they do not need to be replayed from JS.
    // -------------------------------------------------------------------
    _reRegister() {
        if (!this.isAttached) return;
        this.arduino.send(encodeFrame(CMD_MPU_ATTACH, DEVICE_MPU,
            [this.logicalId, this.address]));
        if (this.accelRange !== 0)
            this.arduino.send(encodeFrame(CMD_MPU_SET_ACCEL_RANGE, DEVICE_MPU,
                [this.logicalId, this.accelRange]));
        if (this.gyroRange !== 0)
            this.arduino.send(encodeFrame(CMD_MPU_SET_GYRO_RANGE, DEVICE_MPU,
                [this.logicalId, this.gyroRange]));
        // Re-start periodic read if one was active
        if (this._readInterval > 0) {
            this._sendReadRequest();
        }
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino
    // -------------------------------------------------------------------
    handleMessage(frame) {
        switch (frame.cmd) {

            // State sync during announce — update local state silently.
            case CMD_MPU_ATTACH:
                this.address    = frame.params[1];
                this.isAttached = true;
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
        return {
            logicalId:    this.logicalId,
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
