// ==============================================================
// arduinoComs.js
// P5js to Arduino WebSocket communication
// Works with UNO R4 WiFi and ESP32
// Version v0.14 (with strict FIFO + batching)
// by Scott Mitchell, modified with batching by ChatGPT
// GPL-3.0 License
// ==============================================================

// ---------------------------
// Protocol enums
// ---------------------------

// ==============================================================
// defs.js
// Protocol IDs and Action Codes (match defs.h on Arduino)
// ==============================================================

// -------------------------------------------------------------------
// Core Actions
// -------------------------------------------------------------------
const PIN_MODE       = 1;
const DIGITAL_WRITE  = 2;
const DIGITAL_READ   = 3;
const ANALOG_WRITE   = 4;
const ANALOG_READ    = 5;
// Special JS-only constant
const END = -1;  // Stop a registered action

const INPUT = 0;
const OUTPUT = 1;
const INPUT_PULLUP = 2;
const INPUT_PULLDOWN = 3;
const OUTPUT_OPENDRAIN = 4;
const ANALOG_INPUT = 8;
const ANALOG_OUTPUT = 10;

const LOW = 0;
const HIGH = 1;

// Arduino UNO R4 pin numbers
const D0 = 0, D1 = 1, D2 = 2, D3 = 3, D4 = 4, D5 = 5, D6 = 6, D7 = 7,
    D8 = 8, D9 = 9, D10 = 10, D11 = 11, D12 = 12, D13 = 13,
    A0 = 14, A1 = 15, A2 = 16, A3 = 17, A4 = 18, A5 = 19;

// ---------------------------
// Arduino wrapper
// ---------------------------

class Arduino {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.registeredEvents = [];
        this.messageTimes = [];
        this.messageOutInterval = 100;
        this.defaultReadingInterval = 200;
        this.messageQueue = [];
        this.flushing = false;

        // Reconnection properties
        this.deviceIP = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds
        this.reconnectTimeout = null;
        this.isReconnecting = false;

        this.extensions = {}; // container for attached extensions
        this.nextLogicalId = 0; // Starting logical ID for extensions
    }

    connect(deviceIP) {
        this.deviceIP = `ws://${deviceIP}:81/`;
        this.reconnectAttempts = 0;
        this._connect();
    }

    _connect() {
        if (this.isReconnecting) return;

        console.log(`Attempting to connect to ${this.deviceIP}...`);

        try {
            this.socket = new WebSocket(this.deviceIP);

            this.socket.onopen = () => {
                console.log("WebSocket connected successfully");
                this.connected = true;
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000; // Reset delay

                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }

                // Flush any queued messages in correct order
                this._flushQueue();
            };

            this.socket.onclose = (event) => {
                console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
                this.connected = false;
                this._handleDisconnection();
            };

            this.socket.onerror = (error) => {
                console.error("WebSocket error:", error);
                this.connected = false;
            };

            this.socket.onmessage = (evt) => {
                const msg = JSON.parse(evt.data);
                this.messageIn(msg);
            };

        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            this._handleDisconnection();
        }
    }

    _handleDisconnection() {
        if (this.isReconnecting) return;

        this.connected = false;
        this.isReconnecting = true;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            this.isReconnecting = false;
            return;
        }

        this.reconnectAttempts++;

        const delay = Math.min(
            this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

        this.reconnectTimeout = setTimeout(() => {
            this.isReconnecting = false;
            this._connect();
        }, delay);
    }

    reconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.isReconnecting = false;
        this.reconnectAttempts = 0;

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close();
        }

        this._connect();
    }

    disconnect() {
        this.reconnectAttempts = this.maxReconnectAttempts;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.isReconnecting = false;

        if (this.socket) {
            this.socket.close();
        }

        console.log("Manually disconnected - auto-reconnection disabled");
    }

    getStatus() {
        return {
            connected: this.connected,
            isReconnecting: this.isReconnecting,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts,
            deviceIP: this.deviceIP
        };
    }

    // ---------------------------
    // Core send method (strict FIFO + batching)
    // ---------------------------
    send(data) {
        const payload = Array.isArray(data) ? data : [data];
        this.messageQueue.push(...payload);

        if (this.connected && !this.flushing) {
            this._flushQueue();
        }
    }

    _flushQueue() {
        if (!this.connected || this.flushing || this.messageQueue.length === 0) return;
        this.flushing = true;

        try {
            const batched = {
                header: { version: 1 },
                data: this.messageQueue.splice(0, this.messageQueue.length)
            };

            this.socket.send(JSON.stringify(batched));
            console.log('Batched message sent:', JSON.stringify(batched));
        } catch (error) {
            console.error('Failed to send batched message:', error);
            // leave queue intact for retry
        } finally {
            this.flushing = false;
        }
    }

    registerEvent(pin, type, interval, value = null, threshold = 0) {
        let event = this.registeredEvents.find(e => e.id === pin && e.type === type);

        if (!event) {
            event = {
                id: pin,
                type: type,
                interval: interval,
                lastUpdate: 0,
                value: value,
                lastSentValue: null,
                threshold: threshold
            };
            this.registeredEvents.push(event);
        } else {
            event.interval = interval;
            event.threshold = threshold;
        }

        return event;
    }

    shouldSend(event, newValue) {
        const now = Date.now();
        const timePassed = now - event.lastUpdate >= event.interval;

        if (!timePassed) return false;

        if (event.type === DIGITAL_WRITE || event.type === ANALOG_WRITE) {
            if (event.lastSentValue === null) return true;

            if (event.type === DIGITAL_WRITE) {
                return newValue !== event.lastSentValue;
            } else {
                return Math.abs(newValue - event.lastSentValue) > event.threshold;
            }
        }

        return true;
    }

    add(id, extension) {
        extension.logicalId = this.nextLogicalId++;
        this.extensions[id] = extension;
        this[id] = extension;

        console.log(`Extension '${id}' added with logical ID ${extension.logicalId} (device type: ${extension.deviceId})`);

        return this;
    }

    getExtension(id) {
        return this.extensions[id];
    }

    listExtensions() {
        return Object.keys(this.extensions).map(id => ({
            id: id,
            logicalId: this.extensions[id].logicalId,
            deviceId: this.extensions[id].deviceId,
            type: this.extensions[id].constructor.name
        }));
    }

    pinMode(pin, mode, interval = this.defaultReadingInterval) {
        this.registeredEvents = this.registeredEvents.filter(e => e.id !== pin);

        this.send({
            id: pin,
            action: PIN_MODE,
            params: [mode]
        });

        return this;
    }

    digitalWrite(pin, value, interval = this.messageOutInterval, threshold = 0) {
        const event = this.registerEvent(pin, DIGITAL_WRITE, interval, value, threshold);

        if (event.lastUpdate === 0 || this.shouldSend(event, value)) {
            this.send({ id: pin, action: DIGITAL_WRITE, params: [value] });
            event.lastUpdate = Date.now();
            event.lastSentValue = value;
        }
    }

    analogWrite(pin, value, interval = this.messageOutInterval, threshold = 2) {
        const intValue = Math.round(value);
        const event = this.registerEvent(pin, ANALOG_WRITE, interval, intValue, threshold);

        if (event.lastUpdate === 0 || this.shouldSend(event, intValue)) {
            this.send({ id: pin, action: ANALOG_WRITE, params: [intValue] });
            event.lastUpdate = Date.now();
            event.lastSentValue = intValue;
        }
    }

    digitalRead(pin, interval = this.defaultReadingInterval) {
        if (interval === END) {
            this.end(pin); // wrapper method
            return 0;
        }
        const event = this.registerEvent(pin, DIGITAL_READ, interval);

        if (event.lastUpdate === 0) {
            this.send({ id: pin, action: DIGITAL_READ, params: [interval] });
            event.lastUpdate = Date.now();
        }

        return event.value ?? 0;
    }

    analogRead(pin, interval = this.defaultReadingInterval) {
        if (interval === END) {
            this.end(pin); // wrapper method
            return 0;
        }
        const event = this.registerEvent(pin, ANALOG_READ, interval);

        if (event.lastUpdate === 0) {
            this.send({ id: pin, action: ANALOG_READ, params: [interval] });
            event.lastUpdate = Date.now();
        }

        return event.value ?? 0;
    }

    end(pin) {
        this.registeredEvents = this.registeredEvents.filter(e => e.id !== pin);
        this.send({ id: pin, action: 6, params: [] }); // protocol END = 6
        console.log(`Stopped periodic actions on pin ${pin}`);
        return this;
    }

    _modeToType(mode) {
        switch (mode) {
            case INPUT:
            case INPUT_PULLUP:
            case INPUT_PULLDOWN: return DIGITAL_READ;
            case OUTPUT:
            case OUTPUT_OPENDRAIN: return DIGITAL_WRITE;
            case ANALOG_INPUT: return ANALOG_READ;
            default: return null;
        }
    }

    messageIn(msg) {
        if (!msg.data) return;

        msg.data.forEach(item => {
            // Check if this is an extension message (ID >= 1000)
            if (item.id >= 1000) {
                // Route to appropriate extension
                this.routeExtensionMessage(item);
            } else {
                // Handle regular pin-based messages
                let event = this.registeredEvents.find(e => e.id === item.id);
                if (event) {
                    event.value = item.value;
                } else {
                    this.registeredEvents.push({
                        id: item.id,
                        type: item.type,
                        value: item.value
                    });
                }
            }
        });
    }

    routeExtensionMessage(item) {
        // Determine extension type based on ID ranges
        let extension = null;
        let adjustedId = item.id;

        if (item.id >= 2000 && item.id < 3000) {
            // Ultrasonic sensor messages (ID 2000-2999)
            adjustedId = item.id - 2000; // Get logical ID
            extension = Object.values(this.extensions).find(ext =>
                ext.deviceId === 202 && ext.logicalId === adjustedId
            );
        } else if (item.id >= 1000 && item.id < 2000) {
            // Servo messages (ID 1000-1999)
            adjustedId = item.id - 1000;
            extension = Object.values(this.extensions).find(ext =>
                ext.deviceId === 201 && ext.logicalId === adjustedId
            );
        }

        if (extension && typeof extension.handleMessage === 'function') {
            extension.handleMessage({
                id: adjustedId,
                type: item.type,
                value: item.value
            });
        } else {
            console.warn('No extension found for message:', item);
        }
    }
}
