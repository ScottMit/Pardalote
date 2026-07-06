title: MPU / IMU
lede: Up to 2 inertial measurement units — accelerometer, gyroscope and temperature at up to 50 Hz, with on-board calibration. No third-party library required.
---
Requires `<PardaloteMPU.h>` in the sketch. One extension covers multiple InvenSense MPU and STMicroelectronics LSM6 families — it reads sensor registers directly over I2C.

## Supported sensors

| Model string | Chip | DOF | Default address |
|---|---|---|---|
| `'6050'` | InvenSense MPU-6050 | 6 | 0x68 |
| `'6500'` | InvenSense MPU-6500 | 6 | 0x68 |
| `'9250'` | InvenSense MPU-9250 | 9 | 0x68 |
| `'9255'` | InvenSense MPU-9255 | 9 | 0x68 |
| `'LSM6DS3'`  | STMicro LSM6DS3  | 6 | 0x6A |
| `'LSM6DSOX'` | STMicro LSM6DSOX | 6 | 0x6A |

## new MPU()

The constructor takes the model string.

<div class="sig">arduino.<span class="fn">add</span>('imu', new <span class="fn">MPU</span>(model))</div>

| Parameter | Type | Description |
|---|---|---|
| `model` | string | One of the model strings above. Wrong model → `WHO_AM_I mismatch` in the Serial Monitor. |

```javascript Example — choose the model
arduino.add('imu', new MPU('6050'));
```

## attach()

Connects to the sensor over I2C. Call inside `on('ready')`.

<div class="sig">arduino.imu.<span class="fn">attach</span>([address], [sda], [scl])</div>

| Parameter | Type | Description |
|---|---|---|
| `address` | number | Optional. I2C address — `0x68` default, `0x69` with AD0 high (LSM6: `0x6A`/`0x6B`). |
| `sda`, `scl` | number \| string | Optional. Custom I2C pins (ESP32 only). |

```javascript Example — attach over I2C
arduino.imu.attach(0x68);
arduino.imu.attach(0x68, 21, 22);   // ESP32 custom SDA/SCL
```

## read()

Starts polling the sensor. Handlers receive each sample.

<div class="sig">arduino.imu.<span class="fn">read</span>([interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |

```javascript Example — stream at 50 Hz
arduino.imu.onRead(({ accel, gyro, temp }) => {
    // accel: { x, y, z } in g
    // gyro:  { x, y, z } in °/s
    // temp:  °C
});
arduino.imu.read(20);   // 50 Hz
```

The original ESP32 chip's I²C peripheral can stall under sustained high-rate reads — on ESP32-WROVER and other older ESP32 boards keep the interval at 50 ms or higher. Newer ESP32 boards (S3, C3, …) and the UNO R4 poll reliably at 20 ms.

## setAccelRange() / setGyroRange()

Measurement ranges. Higher range handles bigger motion but reduces resolution. Unknown values are rejected with a console warning; the current range is left unchanged.

<div class="sig">arduino.imu.<span class="fn">setAccelRange</span>(g) · arduino.imu.<span class="fn">setGyroRange</span>(dps)</div>

| Parameter | Type | Description |
|---|---|---|
| `g` | number | Accel range as ±g: `2` (default), `4`, `8`, or `16`. |
| `dps` | number | Gyro range as ±°/s: `250` (default), `500`, `1000`, or `2000`. |

## calibrate()

Measures and applies zero offsets. Place the sensor flat with Z pointing up first. Offsets are stored **on the Arduino** and re-sent to any browser that reconnects — no need to recalibrate after a page reload.

<div class="sig">arduino.imu.<span class="fn">calibrate</span>(samples)</div>

| Parameter | Type | Description |
|---|---|---|
| `samples` | number | Number of samples to average, e.g. `200` (≈ 400 ms). |

```javascript Example — calibrate flat
arduino.imu.calibrate(200);
arduino.imu.onCalibrate(offsets => {
    // { ax, ay, az, gx, gy, gz } — applied automatically
    // afterwards: accel.z ≈ +1g, gyro ≈ 0
});
```

## Events

<div class="sig">arduino.imu.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'read'` | `{ accel, gyro, temp }` | A sample arrives. |
| `'calibrate'` | `{ ax, ay, az, gx, gy, gz }` | Calibration completes. |

Shorthand: `onRead(fn)`, `onCalibrate(fn)`.

## State snapshot

<div class="sig">arduino.imu.<span class="fn">getState</span>()</div>

**Returns** `{ logicalId, model, dof, address, attached, accelRange, gyroRange, accel, gyro, temp, calibrated, calibration }`.

See also: [MPU example](../examples/mpu-example.html) · [Troubleshooting](troubleshooting.html)
