// =============================================
// control-panel.js
// Pinout-diagram style layout:
//   left cards  |  board image  |  right cards
// Cards are absolutely positioned to align with
// their physical pin location on the board PNG.
// =============================================

const CARD_H = 26;   // px — height of each pin card
const CARD_W = 310;  // px — width of each card column

function buildControlPanel(arduino, boardName, boards) {
    const board = boards[boardName];
    if (!board) { console.error('Unknown board:', boardName); return; }

    const { image, imageW, pins } = board;

    // ---------------------------------------------------------------
    // DOM helper
    // ---------------------------------------------------------------
    function el(tag, className) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        return e;
    }

    // Per-pin runtime state (one entry per num — the hardware truth)
    const pinState = new Map();

    // All card UIs sharing a given pin num (for alias reset)
    // num → [{ select, controls }, ...]
    const cardRegistry = new Map();

    // ---------------------------------------------------------------
    // Apply a mode to a pin — rebuild controls and wire Arduino
    // ---------------------------------------------------------------
    function applyMode(pin, mode, controlsEl) {
        const prev = pinState.get(pin);
        if (prev?.timerId) clearInterval(prev.timerId);
        arduino.end(pin);
        controlsEl.innerHTML = '';

        const state = { mode, timerId: null, controlsEl };
        pinState.set(pin, state);

        // Reset all alias cards that are NOT the one being activated
        if (mode !== 'off') {
            (cardRegistry.get(pin) || []).forEach(({ select, controls }) => {
                if (controls !== controlsEl) {
                    select.value = 'off';
                    controls.innerHTML = '';
                }
            });
        }

        if (mode === 'off') return;

        const isLeft = !!controlsEl.closest('.left-card');

        switch (mode) {

            case 'input': {
                arduino.pinMode(pin, INPUT_PULLUP);
                const ind = el('span', 'h-indicator');
                ind.textContent = '—';
                controlsEl.appendChild(ind);
                arduino.onChange(pin, val => {
                    ind.textContent = val ? 'HIGH' : 'LOW';
                    ind.className = 'h-indicator ' + (val ? 'h-high' : 'h-low');
                });
                break;
            }

            case 'output': {
                arduino.pinMode(pin, OUTPUT);
                const hiBtn = el('button', 'h-btn h-btn-hi'); hiBtn.textContent = 'HI';
                const loBtn = el('button', 'h-btn h-btn-lo'); loBtn.textContent = 'LO';
                const ind   = el('span',  'h-state');          ind.textContent = '—';
                hiBtn.onclick = () => { arduino.digitalWrite(pin, HIGH); ind.textContent = 'HIGH'; ind.className = 'h-state h-st-hi'; };
                loBtn.onclick = () => { arduino.digitalWrite(pin, LOW);  ind.textContent = 'LOW';  ind.className = 'h-state h-st-lo'; };
                // LHS: value → buttons (reads away from board: label | mode | buttons | value)
                isLeft ? controlsEl.append(ind, hiBtn, loBtn)
                       : controlsEl.append(hiBtn, loBtn, ind);
                break;
            }

            case 'pwm out': {
                arduino.pinMode(pin, OUTPUT);
                const slider = document.createElement('input');
                slider.type = 'range'; slider.min = 0; slider.max = 255; slider.value = 0;
                slider.className = 'h-slider';
                const val = el('span', 'h-val'); val.textContent = '0';
                slider.oninput = () => { arduino.analogWrite(pin, +slider.value); val.textContent = slider.value; };
                isLeft ? controlsEl.append(val, slider)
                       : controlsEl.append(slider, val);
                break;
            }

            case 'analog in': {
                const bar  = el('div', 'h-bar');
                const fill = el('div', 'h-fill');
                bar.appendChild(fill);
                const val = el('span', 'h-val'); val.textContent = '0';
                isLeft ? controlsEl.append(val, bar)
                       : controlsEl.append(bar, val);
                arduino.analogRead(pin, 50);
                state.timerId = setInterval(() => {
                    const v = arduino.analogRead(pin, 50);
                    fill.style.width = (v / arduino.analogMax * 100).toFixed(1) + '%';
                    val.textContent = v;
                }, 100);
                break;
            }
        }
    }

    // ---------------------------------------------------------------
    // Build a single horizontal pin card
    //
    // Label-only (no modes):
    //   side = 'left'  → [name]   right-aligned, flush to board
    //   side = 'right' → [name]   left-aligned,  flush to board
    //
    // Interactive (has modes):
    //   side = 'left'  → [controls][mode▼][name]
    //   side = 'right' → [name][mode▼][controls]
    // ---------------------------------------------------------------
    function buildCard(pinDef, side) {
        const { name, num, modes } = pinDef;
        const isLabel = !modes || modes.length === 0;

        const card = el('div', `h-card ${side}-card${isLabel ? ' label-card' : ''}`);
        if (num !== undefined) card.dataset.pin = num;

        const label = el('span', 'h-pin-name');
        label.textContent = name;

        if (isLabel) {
            card.append(label);
            return card;
        }

        const select = el('select', 'h-mode-select');
        modes.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            select.appendChild(opt);
        });

        const controls = el('div', 'h-controls');
        select.onchange = () => applyMode(num, select.value, controls);

        // Register this card UI under its pin num (duplicates accumulate here)
        if (!cardRegistry.has(num)) cardRegistry.set(num, []);
        cardRegistry.get(num).push({ select, controls });

        // Only initialise pinState once per num (first card wins)
        if (!pinState.has(num)) pinState.set(num, { mode: 'off', timerId: null, controlsEl: null });

        const numLabel = el('span', 'h-pin-num');
        numLabel.textContent = 'IO' + String(num).padStart(2, '0');

        if (side === 'left') {
            card.append(controls, select, numLabel, label);
        } else {
            card.append(label, numLabel, select, controls);
        }

        return card;
    }

    // ---------------------------------------------------------------
    // Load board image, then build the full layout
    // ---------------------------------------------------------------
    // Wrapper returned immediately so the caller can remove it on board change
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    const img = new Image();
    img.src = image;
    img.onload = () => {
        const naturalRatio = img.naturalHeight / img.naturalWidth;

        // Find the smallest vertical gap between any two pins on the same side.
        // We use fractional y values, so the gap in pixels = fraction * imageH.
        // We need that gap >= CARD_H + CARD_GAP, so derive a minimum imageH.
        const CARD_GAP = 3;  // px breathing room between adjacent cards

        function minYGap(ys) {
            const sorted = [...new Set(ys)].sort((a, b) => a - b);
            let min = Infinity;
            for (let i = 1; i < sorted.length; i++) min = Math.min(min, sorted[i] - sorted[i - 1]);
            return min;
        }

        const leftYs  = pins.filter(p => p.x <  0.5).map(p => p.y);
        const rightYs = pins.filter(p => p.x >= 0.5).map(p => p.y);
        const minFrac = Math.min(
            leftYs.length  > 1 ? minYGap(leftYs)  : Infinity,
            rightYs.length > 1 ? minYGap(rightYs) : Infinity,
        );

        // Scale up if the natural image height would pack cards too tightly
        const minImageH = isFinite(minFrac) ? Math.ceil((CARD_H + CARD_GAP) / minFrac) : 0;
        let imgH = Math.round(imageW * naturalRatio);
        let imgW = imageW;
        if (imgH < minImageH) {
            imgH = minImageH;
            imgW = Math.round(imgH / naturalRatio);
        }

        const totalW = CARD_W + imgW + CARD_W;

        // Outer container (inside the wrapper)
        const container = el('div', 'pinout-container');
        container.style.cssText =
            `position:relative;width:${totalW}px;height:${imgH}px;margin-top:10px;`;
        wrapper.appendChild(container);

        // Board image, centred between the two card columns
        img.style.cssText =
            `position:absolute;left:${CARD_W}px;top:0;width:${imgW}px;height:${imgH}px;`;
        container.appendChild(img);

        // SVG overlay — connector lines + pin dots (above image, below cards)
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width',   totalW);
        svg.setAttribute('height',  imgH);
        svg.setAttribute('viewBox', `0 0 ${totalW} ${imgH}`);
        svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
        container.appendChild(svg);

        function addSVG(tag, attrs) {
            const e = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
            svg.appendChild(e);
            return e;
        }

        // Pin cards + connector lines + dots
        pins.forEach(pinDef => {
            const side    = pinDef.x < 0.5 ? 'left' : 'right';
            const pinX    = CARD_W + pinDef.x * imgW;   // container-space x of pin
            const pinY    = pinDef.y * imgH;             // container-space y of pin
            const cardTop = Math.round(pinY - CARD_H / 2);

            // Horizontal connector line: card edge → pin
            const lineX = side === 'left' ? CARD_W : CARD_W + imgW;
            addSVG('line', {
                x1: lineX, y1: pinY, x2: pinX, y2: pinY,
                stroke: '#4a4a4a', 'stroke-width': 1,
            });

            // Pin dot — ring + filled centre
            addSVG('circle', { cx: pinX, cy: pinY, r: 4.5,
                fill: 'none', stroke: '#fa0', 'stroke-width': 1.5 });
            addSVG('circle', { cx: pinX, cy: pinY, r: 2,
                fill: '#fa0' });

            // Card
            const card = buildCard(pinDef, side);
            if (side === 'left') {
                card.style.cssText =
                    `position:absolute;left:0;top:${cardTop}px;width:${CARD_W}px;height:${CARD_H}px;`;
            } else {
                card.style.cssText =
                    `position:absolute;left:${CARD_W + imgW}px;top:${cardTop}px;width:${CARD_W}px;height:${CARD_H}px;`;
            }
            container.appendChild(card);
        });

        // Re-apply active modes after Arduino reconnects.
        // controlsEl is stored in pinState so we don't need a DOM query
        // (which would be ambiguous for aliased pins sharing the same num).
        arduino.on('ready', () => {
            pinState.forEach(({ mode, controlsEl: ce }, pin) => {
                if (mode === 'off' || !ce) return;
                applyMode(pin, mode, ce);
            });
        });
    };

    img.onerror = () => console.error('Could not load board image:', image);

    return wrapper;
}
