// ==============================================================
// ultrasonic.js
// Ultrasonic Sensor Extension for Arduino WebSocket
// Supports 3-wire and 4-wire ultrasonic sensors (HC-SR04, etc.)
// Works with UNO R4 WiFi and ESP32
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

const ULTRASONIC_CONTROL = 202;
const ULTRASONIC_ATTACH      = 30;
const ULTRASONIC_DETACH      = 31;
const ULTRASONIC_READ        = 32;
const ULTRASONIC_SET_TIMEOUT = 33;

// Unit constants
const CM = 0;
const INCH = 1;

class Ultrasonic {
    constructor(arduino) {
        this.arduino = arduino;
        this.deviceId = ULTRASONIC_CONTROL;
        this.logicalId = null;

        // State tracking
        this.trigPin = -1;
        this.echoPin = -1;
        this.isAttached = false;
        this.timeout = 20; // Default timeout in milliseconds
        this.lastDistance = -1;
        this.is3Wire = false;

        // Reading cache
        this.lastReadTime = 0;
        this.readThrottle = 50; // Minimum time between reads (ms)
    }

    attach(trigPin, echoPin = null) {
        this.trigPin = trigPin;
        this.echoPin = echoPin;
        this.is3Wire = (echoPin === null || echoPin === undefined);

        const params = this.is3Wire ?
            [this.logicalId, trigPin] :
            [this.logicalId, trigPin, echoPin];

        this.arduino.send({
            id: this.deviceId,
            action: ULTRASONIC_ATTACH,
            params: params
        });

        this.isAttached = true;
        console.log(`Ultrasonic sensor ${this.logicalId} attached to pin ${trigPin}${this.is3Wire ? ' (3-wire mode)' : ` and ${echoPin} (4-wire mode)`}`);
        return this;
    }

    detach() {
        this.arduino.send({
            id: this.deviceId,
            action: ULTRASONIC_DETACH,
            params: [this.logicalId]
        });

        this.isAttached = false;
        this.trigPin = -1;
        this.echoPin = -1;
        this.is3Wire = false;
        console.log(`Ultrasonic sensor ${this.logicalId} detached`);
        return this;
    }

    read(arg1 = CM, arg2 = this.arduino.defaultReadingInterval) {
        if (!this.isAttached) {
            console.warn(`Ultrasonic sensor ${this.logicalId} not attached`);
            return -1;
        }

        // Handle END (-1)
        if (arg1 === END) {
            this.stop();
            return this.lastDistance;
        }

        let unit, interval;

        // Detect whether first arg is a unit or an interval
        if (arg1 === CM || arg1 === INCH) {
            unit = arg1;
            interval = arg2;
        } else {
            // First arg is actually an interval
            unit = CM;
            interval = arg1;
        }

        // If interval = 0 → one-shot read
        if (interval === 0) {
            this.arduino.send({
                id: this.deviceId,
                action: ULTRASONIC_READ,
                params: [this.logicalId, unit]
            });
            return this.lastDistance;
        }

        // Otherwise, periodic registered read
        let event = this.arduino.registerEvent(this.logicalId, ULTRASONIC_READ, interval);
        if (event.lastUpdate === 0) {
            this.arduino.send({
                id: this.deviceId,
                action: ULTRASONIC_READ,
                params: [this.logicalId, unit, interval]
            });
            event.lastUpdate = Date.now();
        }

        return this.lastDistance;
    }

    readCM() {
        return this.read(CM);
    }

    readInches() {
        return this.read(INCH);
    }

    stop() {
        this.arduino.send({
            id: this.deviceId,
            action: 6, // protocol END
            params: [this.logicalId]
        });
        console.log(`Ultrasonic sensor ${this.logicalId} stopped periodic reads`);
        return this;
    }

    setTimeout(milliseconds) {
        if (!this.isAttached) {
            console.warn(`Ultrasonic sensor ${this.logicalId} not attached`);
            return this;
        }

        milliseconds = Math.max(1, Math.min(milliseconds, 1000)); // Limit between 1ms and 1000ms
        this.timeout = milliseconds;

        this.arduino.send({
            id: this.deviceId,
            action: ULTRASONIC_SET_TIMEOUT,
            params: [this.logicalId, milliseconds]
        });

        console.log(`Ultrasonic sensor ${this.logicalId} timeout set to ${milliseconds}ms`);
        return this;
    }

    setReadThrottle(milliseconds) {
        this.readThrottle = Math.max(10, milliseconds);
        console.log(`Ultrasonic sensor ${this.logicalId} read throttle set to ${this.readThrottle}ms`);
        return this;
    }

    getDistance() {
        return this.lastDistance;
    }

    isInRange(maxDistance, unit = CM) {
        const distance = this.lastDistance;
        return distance > 0 && distance <= maxDistance;
    }

    getState() {
        return {
            logicalId: this.logicalId,
            trigPin: this.trigPin,
            echoPin: this.echoPin,
            is3Wire: this.is3Wire,
            attached: this.isAttached,
            timeout: this.timeout,
            lastDistance: this.lastDistance,
            readThrottle: this.readThrottle
        };
    }

    handleMessage(msg) {
        switch (msg.type) {
            case ULTRASONIC_READ:
                this.lastDistance = msg.value;
                console.log(`Ultrasonic sensor ${this.logicalId} distance: ${msg.value >= 0 ? msg.value.toFixed(1) : 'timeout'}`);
                break;
        }
    }
}

// Helper constants for backward compatibility and convenience
const ULTRASONIC = {
    CM: CM,
    INCH: INCH,
    CENTIMETERS: CM,
    INCHES: INCH
};