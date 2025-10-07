// ==============================================================
// servo.js
// Servo Extension for Arduino WebSocket
// Implements Arduino Servo library functions in JavaScript
// Works with UNO R4 WiFi and ESP32
// Version v0.3 (with threshold check for angle + microseconds)
// by Scott Mitchell, modified with threshold by ChatGPT
// GPL-3.0 License
// ==============================================================

const SERVO_CONTROL = 201;
const SERVO_ATTACH      = 20;
const SERVO_DETACH      = 21;
const SERVO_WRITE       = 22;
const SERVO_WRITE_MICROSECONDS = 23;
const SERVO_READ        = 24;
const SERVO_ATTACHED    = 25;

class Servo {
    constructor(arduino) {
        this.arduino = arduino;
        this.deviceId = SERVO_CONTROL;
        this.logicalId = null;

        // State tracking
        this.pin = -1;
        this.isAttached = false;
        this.currentAngle = 90;
        this.currentMicros = 1500; // approx center
        this.minPulse = 544;
        this.maxPulse = 2400;

        // Throttling
        this.lastWriteTime = 0;
        this.writeThrottle = 20; // ms
        this.pendingWrite = null;

        // Threshold
        this.defaultThreshold = 1; // degrees

        // Sweep cancellation
        this.sweepAbort = false;
    }

    attach(pin, min = 544, max = 2400) {
        this.pin = pin;
        this.minPulse = min;
        this.maxPulse = max;

        this.arduino.send({
            id: this.deviceId,
            action: SERVO_ATTACH,
            params: [this.logicalId, pin, min, max]
        });

        this.isAttached = true;
        console.log(`Servo ${this.logicalId} attached to pin ${pin}`);
        return this;
    }

    detach() {
        this.arduino.send({
            id: this.deviceId,
            action: SERVO_DETACH,
            params: [this.logicalId]
        });

        this.isAttached = false;
        this.pin = -1;
        console.log(`Servo ${this.logicalId} detached`);
        return this;
    }

    write(angle) {
        this.sweepAbort = true;   // cancel any running sweep
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId} not attached`);
            return this;
        }

        angle = Math.max(0, Math.min(180, Math.round(angle)));

        // Skip if below threshold
        if (Math.abs(angle - this.currentAngle) < this.defaultThreshold) {
            return this;
        }

        const now = Date.now();
        if (now - this.lastWriteTime < this.writeThrottle) {
            if (this.pendingWrite) clearTimeout(this.pendingWrite);

            this.pendingWrite = setTimeout(() => {
                this._sendWrite(angle);
                this.pendingWrite = null;
            }, this.writeThrottle - (now - this.lastWriteTime));
        } else {
            this._sendWrite(angle);
        }
        return this;
    }

    _sendWrite(angle) {
        this.arduino.send({
            id: this.deviceId,
            action: SERVO_WRITE,
            params: [this.logicalId, angle]
        });

        this.currentAngle = angle;
        // keep microsecond state in sync
        this.currentMicros = this.angleToMicros(angle);
        this.lastWriteTime = Date.now();
        console.log(`Servo ${this.logicalId} angle set to ${angle}°`);
    }

    writeMicroseconds(microseconds) {
        this.sweepAbort = true;   // cancel any running sweep
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId} not attached`);
            return this;
        }

        microseconds = Math.max(this.minPulse, Math.min(this.maxPulse, Math.round(microseconds)));

        // Convert threshold (degrees → µs)
        const microsPerDegree = (this.maxPulse - this.minPulse) / 180;
        const microThreshold = this.defaultThreshold * microsPerDegree;

        // Skip if below threshold
        if (Math.abs(microseconds - this.currentMicros) < microThreshold) {
            return this;
        }

        this.arduino.send({
            id: this.deviceId,
            action: SERVO_WRITE_MICROSECONDS,
            params: [this.logicalId, microseconds]
        });

        this.currentMicros = microseconds;
        this.currentAngle = this.microsToAngle(microseconds);
        this.lastWriteTime = Date.now();
        console.log(`Servo ${this.logicalId} microseconds set to ${microseconds}μs`);
        return this;
    }

    angleToMicros(angle) {
        return this.minPulse + (angle / 180) * (this.maxPulse - this.minPulse);
    }

    microsToAngle(microseconds) {
        return ((microseconds - this.minPulse) / (this.maxPulse - this.minPulse)) * 180;
    }

    read() {
        return this.currentAngle;
    }

    attached() {
        this.arduino.send({
            id: this.deviceId,
            action: SERVO_ATTACHED,
            params: [this.logicalId]
        });

        return this.isAttached;
    }

    center() { this.sweepAbort = true; return this.write(90); }
    min()    { this.sweepAbort = true; return this.write(0); }
    max()    { this.sweepAbort = true; return this.write(180); }

    // sequential sweep that respects writeThrottle and pendingWrite
// sequential sweep that respects user timing, but also keeps message order
    async sweep(startAngle = 0, endAngle = 180, duration = 2000, steps = 50) {
        if (!this.isAttached) {
            console.warn(`Servo ${this.logicalId} not attached`);
            return Promise.resolve();
        }

        // reset abort flag at start
        this.sweepAbort = false;

        steps = Math.max(1, Math.round(steps));
        const stepDelay = duration / steps;
        const angleStep = (endAngle - startAngle) / steps;

        // clear any scheduled write
        if (this.pendingWrite) {
            clearTimeout(this.pendingWrite);
            this.pendingWrite = null;
        }

        for (let i = 0; i <= steps; i++) {
            if (this.sweepAbort) {
                console.log(`Servo ${this.logicalId} sweep aborted`);
                break;
            }

            const angle = startAngle + (angleStep * i);

            // send immediately (bypasses threshold/throttle)
            this._sendWrite(angle);

            // wait the stepDelay
            await new Promise(resolve => setTimeout(resolve, stepDelay));

            // make sure previous send has cleared before next step
            while (this.pendingWrite) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
    }

    setWriteThrottle(ms) {
        this.writeThrottle = Math.max(0, ms);
        return this;
    }

    setThreshold(threshold) {
        this.defaultThreshold = Math.max(0, Math.round(threshold));
        return this;
    }

    getState() {
        return {
            logicalId: this.logicalId,
            pin: this.pin,
            attached: this.isAttached,
            currentAngle: this.currentAngle,
            currentMicros: this.currentMicros,
            minPulse: this.minPulse,
            maxPulse: this.maxPulse,
            threshold: this.defaultThreshold
        };
    }

    handleMessage(msg) {
        switch (msg.type) {
            case SERVO_READ:
                this.currentAngle = msg.value;
                this.currentMicros = this.angleToMicros(msg.value);
                console.log(`Servo ${this.logicalId} read angle: ${msg.value}°`);
                break;

            case SERVO_ATTACHED:
                this.isAttached = msg.value === 1;
                console.log(`Servo ${this.logicalId} attached status: ${this.isAttached}`);
                break;
        }
    }
}
