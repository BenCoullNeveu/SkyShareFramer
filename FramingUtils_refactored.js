// REFACTORED ROTATION FUNCTIONS - Replace in FramingUtils.js

// At top of file, add to globals:
let currentRotationDeg = 0; // Canonical NINA-convention rotation angle [0, 360)

// Replace these functions:

function normalizeRotationDeg(value) {
    const v = Number.isFinite(value) ? value : 0;
    return ((v % 360) + 360) % 360; // Wrap to [0, 360)
}

function updateRotationDOMDisplay() {
    const slider = document.getElementById('rotationDeg');
    const field = document.getElementById('rotationValue');
    const displayStr = String(currentRotationDeg);
    if (slider) slider.value = displayStr;
    if (field) field.value = displayStr;
}

function setRotationDeg(value) {
    currentRotationDeg = normalizeRotationDeg(value);
    updateRotationDOMDisplay();
    refreshActiveFrame();
}

function adjustRotationDeg(delta) {
    setRotationDeg(currentRotationDeg + delta);
}

function getRotationFromDOM() {
    const slider = document.getElementById('rotationDeg');
    const field = document.getElementById('rotationValue');
    const source = slider || field;
    if (!source) return currentRotationDeg;
    
    const parsed = Number.parseFloat(
        typeof source.value === 'string' 
            ? source.value 
            : String(source.textContent || source.innerText || '').replace('°', '').trim()
    );
    return Number.isFinite(parsed) ? parsed : currentRotationDeg;
}

// REMOVE THESE FUNCTIONS (they're no longer needed):
// - readRotationValue()
// - syncRotationValue()
