// FramingUtils.js for SkyShare Framing Tool
// author: Ben Coull-Neveu

// -------------------------
// Helpers: geometry + FoV
// -------------------------

let plannerHoverIndex = -1;
let plannerCache = null;

const DEG = Math.PI / 180.0;
let raDecDisplayMode = 'sexagesimal';

const TIMEZONE = "America/Chicago";

function getLocalHM(date) {
    const hh = date.getHours().toString().padStart(2, "0");
    const mm = date.getMinutes().toString().padStart(2, "0");
    return { hh, mm };
}

function zonedTimeToUTC(year, month, day, hour, minute, tz) {
    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    const parts = Object.fromEntries(
        fmt.formatToParts(dt).map(p => [p.type, p.value])
    );

    const asUTC = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );

    // difference gives offset
    return new Date(dt.getTime() - (asUTC - dt.getTime()));
}

function getZonedHM(date, tz) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
    });

    const parts = Object.fromEntries(
        fmt.formatToParts(date).map(p => [p.type, p.value])
    );

    return {
        hh: parts.hour,
        mm: parts.minute
    };
}

function formatDurationHM(totalMinutes) {
    const rounded = Math.max(0, Math.round(totalMinutes));
    const hh = Math.floor(rounded / 60);
    const mm = rounded % 60;
    if (hh <= 0) return `${mm}m`;
    return `${hh}h ${mm.toString().padStart(2, '0')}m`;
}

function estimateImageableMinutes(points, minTargetAltDeg = 20, astroSunAltDeg = -18) {
    if (!Array.isArray(points) || points.length < 2) return 0;

    const positiveRange = (v0, v1) => {
        const eps = 1e-12;
        const a = v0 > eps;
        const b = v1 > eps;

        if (a && b) return [0, 1];
        if (!a && !b) return null;

        const denom = v1 - v0;
        if (Math.abs(denom) < eps) return null;
        const cross = clamp((-v0) / denom, 0, 1);
        return a ? [0, cross] : [cross, 1];
    };

    let minutes = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const dtMinutes = (p1.time.getTime() - p0.time.getTime()) / 60000;
        if (!(dtMinutes > 0)) continue;

        const targetRange = positiveRange(
            p0.alt - minTargetAltDeg,
            p1.alt - minTargetAltDeg
        );
        if (!targetRange) continue;

        const darkRange = positiveRange(
            astroSunAltDeg - p0.sunAlt,
            astroSunAltDeg - p1.sunAlt
        );
        if (!darkRange) continue;

        const overlapStart = Math.max(targetRange[0], darkRange[0]);
        const overlapEnd = Math.min(targetRange[1], darkRange[1]);
        if (overlapEnd > overlapStart) {
            minutes += (overlapEnd - overlapStart) * dtMinutes;
        }
    }

    return minutes;
}

function setPlannerInfoDefault(imageableMinutes) {
    const box = document.getElementById("altAzInfo");
    if (!box) return;
    box.textContent = `Imageable time: ${formatDurationHM(imageableMinutes)}`;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatSexagesimal(value, isHours) {
    const normalized = Number.isFinite(value) ? Math.abs(value) : 0;
    const totalUnits = isHours ? normalized / 15 : normalized;
    let first = Math.floor(totalUnits);
    let minutesFloat = (totalUnits - first) * 60;
    let second = (minutesFloat - Math.floor(minutesFloat)) * 60;
    let minutes = Math.floor(minutesFloat);

    second = Math.round(second * 100) / 100;
    if (second >= 60) {
        second -= 60;
        minutes += 1;
    }
    if (minutes >= 60) {
        minutes -= 60;
        first += 1;
    }

    const secondText = second.toFixed(2).padStart(5, '0');
    return `${pad2(first)}:${pad2(minutes)}:${secondText}`;
}

function formatRaForDisplay(raDeg) {
    return raDecDisplayMode === 'sexagesimal' ? formatSexagesimal(wrap360(raDeg), true) : Number(raDeg).toFixed(6);
}

function formatDecForDisplay(decDeg) {
    if (raDecDisplayMode !== 'sexagesimal') return Number(decDeg).toFixed(6);
    const sign = decDeg < 0 ? '-' : '+';
    return `${sign}${formatSexagesimal(decDeg, false)}`;
}

function parseAngleInput(text, kind) {
    const raw = String(text ?? '').trim();
    if (!raw) return NaN;

    const normalizedRaw = raw.replace(/\u2212/g, '-');
    const hasSexagesimalMarkers = /[:hms°'"′″]/i.test(normalizedRaw);
    const numericParts = normalizedRaw.match(/[+-]?\d+(?:\.\d+)?/g) || [];
    const hasSpaceSeparatedSexagesimal =
        numericParts.length >= 2 &&
        /^[\s+\-.\d]+$/.test(normalizedRaw) &&
        /\s+/.test(normalizedRaw);

    if (!hasSexagesimalMarkers && !hasSpaceSeparatedSexagesimal) {
        const numeric = Number.parseFloat(normalizedRaw);
        return Number.isFinite(numeric) ? numeric : NaN;
    }

    const negative = normalizedRaw.startsWith('-');
    const cleaned = normalizedRaw
        .toLowerCase()
        .replace(/[h°]/g, ':')
        .replace(/[m'′]/g, ':')
        .replace(/[s"″]/g, '')
        .replace(/\s+/g, ':')
        .replace(/\s+/g, '');

    const parts = cleaned.split(':').filter(Boolean);
    if (parts.length === 0) return NaN;

    const first = Math.abs(Number.parseFloat(parts[0])) || 0;
    const minutes = Math.abs(Number.parseFloat(parts[1])) || 0;
    const seconds = Math.abs(Number.parseFloat(parts[2])) || 0;

    let value = first + minutes / 60 + seconds / 3600;
    if (kind === 'ra') value *= 15;
    if (negative) value *= -1;
    return value;
}

function parsePastedRaDec(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;

    const cleaned = raw
        .replace(/\u2212/g, '-')
        .replace(/[，]/g, ',')
        .replace(/\r/g, '\n')
        .trim();

    const parsePair = (raText, decText) => {
        const ra = parseAngleInput(raText, 'ra');
        const dec = parseAngleInput(decText, 'dec');
        if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
        if (Math.abs(dec) > 90) return null;
        return { ra: wrap360(ra), dec };
    };

    const chunkSplit = cleaned.split(/[\t,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (chunkSplit.length === 2) {
        const parsed = parsePair(chunkSplit[0], chunkSplit[1]);
        if (parsed) return parsed;
    }

    const signedDecMatch = cleaned.match(/^(.+?)\s+([+-].+)$/);
    if (signedDecMatch) {
        const parsed = parsePair(signedDecMatch[1], signedDecMatch[2]);
        if (parsed) return parsed;
    }

    const numericOnlyParts = cleaned.match(/[+-]?\d+(?:\.\d+)?/g) || [];
    if (numericOnlyParts.length === 2 && /^[\s,;\t\n+\-.\d]+$/.test(cleaned)) {
        const parsed = parsePair(numericOnlyParts[0], numericOnlyParts[1]);
        if (parsed) return parsed;
    }

    if (numericOnlyParts.length >= 6) {
        const firstDecToken = numericOnlyParts[3] || '';
        if (firstDecToken.startsWith('+') || firstDecToken.startsWith('-')) {
            const raText = numericOnlyParts.slice(0, 3).join(' ');
            const decText = numericOnlyParts.slice(3, 6).join(' ');
            const parsed = parsePair(raText, decText);
            if (parsed) return parsed;
        }
    }

    return null;
}

function getRaDecInputs() {
    const raInput = document.getElementById('raDeg');
    const decInput = document.getElementById('decDeg');
    if (!raInput || !decInput) return null;

    const ra = parseAngleInput(raInput.value, 'ra');
    const dec = parseAngleInput(decInput.value, 'dec');
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;

    return { ra: wrap360(ra), dec };
}

function updateRaDecLabels() {
    const raLabel = document.querySelector('label[for="raDeg"]');
    const decLabel = document.querySelector('label[for="decDeg"]');
    const button = document.getElementById('btnToggleRaDecFormat');

    if (raLabel) raLabel.textContent = raDecDisplayMode === 'sexagesimal' ? 'RA (hms)' : 'RA (deg)';
    if (decLabel) decLabel.textContent = raDecDisplayMode === 'sexagesimal' ? 'Dec (dms)' : 'Dec (deg)';
    if (button) {
    button.title = raDecDisplayMode === 'sexagesimal' ? 'Switch to decimal degrees' : 'Switch to sexagesimal';
    button.setAttribute('aria-label', button.title);
    }
}

function syncRaDecInputsFromDegrees(raDeg, decDeg) {
    const raInput = document.getElementById('raDeg');
    const decInput = document.getElementById('decDeg');
    if (!raInput || !decInput) return;

    raInput.value = formatRaForDisplay(raDeg);
    decInput.value = formatDecForDisplay(decDeg);
    updateRaDecLabels();
}

function toggleRaDecDisplayMode() {
    const center = getRaDecInputs();
    if (!center) return;

    raDecDisplayMode = raDecDisplayMode === 'deg' ? 'sexagesimal' : 'deg';
    syncRaDecInputsFromDegrees(center.ra, center.dec);
}

function readRotationValue(source) {
    if (!source) return NaN;
    if (typeof source.value === 'string') return Number.parseFloat(source.value);
    return Number.parseFloat(String(source.textContent || source.innerText || '').replace('°', '').trim());
}

function syncRotationValue() {
    const slider = document.getElementById('rotationDeg');
    const field = document.getElementById('rotationValue');
    if (!slider || !field) return;

    const value = Number.parseFloat(slider.value);
    const displayValue = Number.isFinite(value) ? normalizeRotationDeg(value) : 0;
    slider.value = String(displayValue);
    field.value = String(displayValue);
}

function normalizeRotationDeg(value) {
    const normalized = Number.isFinite(value) ? value % 360 : 0;
    return normalized < 0 ? normalized + 360 : normalized;
}

function setRotationDeg(value) {
    const slider = document.getElementById('rotationDeg');
    const field = document.getElementById('rotationValue');
    if (!slider || !field) return;

    const normalized = normalizeRotationDeg(value);
    slider.value = String(normalized);
    field.value = String(normalized);
    syncRotationValue();
    refreshActiveFrame();
}

function adjustRotationDeg(delta) {
    const slider = document.getElementById('rotationDeg');
    if (!slider) return;

    const current = Number.parseFloat(slider.value);
    setRotationDeg((Number.isFinite(current) ? current : 0) + delta);
}

function getFallbackCenterFromInputs() {
    return getRaDecInputs();
}

function getAladinCenter() {
    const c = (aladin && typeof aladin.getRaDec === "function") ? aladin.getRaDec() : null;
    if (!c) return null;

    // {ra,dec}
    if (typeof c === "object" && !Array.isArray(c) && ("ra" in c) && ("dec" in c)) {
    const ra = Number(c.ra), dec = Number(c.dec);
    return (Number.isFinite(ra) && Number.isFinite(dec)) ? { ra, dec } : null;
    }

    // [ra,dec]
    if (Array.isArray(c) && c.length >= 2) {
    const ra = Number(c[0]), dec = Number(c[1]);
    return (Number.isFinite(ra) && Number.isFinite(dec)) ? { ra, dec } : null;
    }

    return null;
}


function fmtDegMaybe(x, ndp = 6) {
const v = Number(x);
return Number.isFinite(v) ? v.toFixed(ndp) + "°" : "(not ready)";
}


function getCameraParams() {
    const w = parseFloat(document.getElementById('sensorW').value);
    const h = parseFloat(document.getElementById('sensorH').value);
    const nx = parseInt(document.getElementById('nx').value, 10);
    const ny = parseInt(document.getElementById('ny').value, 10);
    const pix_um = parseFloat(document.getElementById('pixSize').value);
    
    return { sensorW_mm: w, sensorH_mm: h, nx: nx, ny: ny, pix_um: pix_um };
}

function computeFovDeg(focal_mm, sensorW_mm, sensorH_mm) {
    const fovW = 2 * Math.atan(sensorW_mm / (2 * focal_mm)) / DEG;
    const fovH = 2 * Math.atan(sensorH_mm / (2 * focal_mm)) / DEG;
    return { fovW_deg: fovW, fovH_deg: fovH };
}

function computePixelScaleArcsecPx(focal_mm, pix_um) {
    if (!(pix_um > 0)) return null;
    return 206.265 * (pix_um / focal_mm);
}

function formatArcmin(deg) { return (deg * 60).toFixed(2) + "′"; }
function formatDeg(deg) { return deg.toFixed(6) + "°"; }

function radecToVec(raDeg, decDeg) {
const ra = raDeg * DEG;
const dec = decDeg * DEG;
const cdec = Math.cos(dec);
return [
cdec * Math.cos(ra),
cdec * Math.sin(ra),
Math.sin(dec)
];
}

function vecToRaDec(v) {
const [x, y, z] = v;
const ra = Math.atan2(y, x);                 // [-pi, pi]
const dec = Math.asin(clamp(z, -1, 1));      // [-pi/2, pi/2]
let raDeg = ra / DEG;
if (raDeg < 0) raDeg += 360;
return { ra: raDeg, dec: dec / DEG };
}

function normalize(v) {
const n = Math.hypot(v[0], v[1], v[2]);
return [v[0]/n, v[1]/n, v[2]/n];
}

function cross(a, b) {
return [
a[1]*b[2] - a[2]*b[1],
a[2]*b[0] - a[0]*b[2],
a[0]*b[1] - a[1]*b[0]
];
}

function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

function createTangentBasis(raDeg, decDeg) {
    const center = radecToVec(raDeg, decDeg);
    const zAxis = [0, 0, 1];
    const xAxis = [1, 0, 0];
    const reference = (Math.abs(dot(center, zAxis)) > 0.99) ? xAxis : zAxis;

    let east = normalize(cross(reference, center));
    let north = normalize(cross(center, east));

    return { center, east, north };
}

function offsetRaDec(raDeg, decDeg, eastOffsetDeg, northOffsetDeg) {
    const basis = createTangentBasis(raDeg, decDeg);
    const eastOffsetRad = eastOffsetDeg * DEG;
    const northOffsetRad = northOffsetDeg * DEG;

    const vector = normalize([
        basis.center[0] + eastOffsetRad * basis.east[0] + northOffsetRad * basis.north[0],
        basis.center[1] + eastOffsetRad * basis.east[1] + northOffsetRad * basis.north[1],
        basis.center[2] + eastOffsetRad * basis.east[2] + northOffsetRad * basis.north[2],
    ]);

    return vecToRaDec(vector);
}

function toJulianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

function wrap360(x) {
    x = x % 360;
    return x < 0 ? x + 360 : x;
}

function wrap180(x) {
    x = wrap360(x);
    return x > 180 ? x - 360 : x;
}

function sind(x){ return Math.sin(x * DEG); }
function cosd(x){ return Math.cos(x * DEG); }
function tand(x){ return Math.tan(x * DEG); }
function asind(x){ return Math.asin(x) / DEG; }
function acosd(x){ return Math.acos(x) / DEG; }
function atan2d(y,x){ return Math.atan2(y,x) / DEG; }

function makeFovPolygon(ra0, dec0, fovW_deg, fovH_deg, rotation_deg, grid) {
// Half-sizes in radians in the tangent plane
const hx = (fovW_deg / 2) * DEG;
const hy = (fovH_deg / 2) * DEG;

// Center unit vector
const basis = createTangentBasis(ra0, dec0);
const c = basis.center;
const e = basis.east;
const n = basis.north;

// Apply rotation in tangent plane about the line of sight
const rot = rotation_deg * DEG;
const cr = Math.cos(rot), sr = Math.sin(rot);
const eR = [cr*e[0] + sr*n[0], cr*e[1] + sr*n[1], cr*e[2] + sr*n[2]];
const nR = [-sr*e[0] + cr*n[0], -sr*e[1] + cr*n[1], -sr*e[2] + cr*n[2]];

// Corners in tangent-plane coordinates (x east, y north)
const corners = [
[-hx, -hy],
[ hx, -hy],
[ hx,  hy],
[-hx,  hy]
];

// Gnomonic mapping: v ∝ c + x*eR + y*nR
const poly = corners.map(([x, y]) => {
const v = normalize([
    c[0] + x*eR[0] + y*nR[0],
    c[1] + x*eR[1] + y*nR[1],
    c[2] + x*eR[2] + y*nR[2],
]);
const radec = vecToRaDec(v);
return [radec.ra, radec.dec];
});

return poly;
}

function gmstDeg(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    let gmst =
        280.46061837 +
        360.98564736629 * (jd - 2451545.0) +
        0.000387933 * T*T -
        T*T*T / 38710000;
    return wrap360(gmst);
}

function radecToAltAz(raDeg, decDeg, latDeg, lonDeg, jd) {

    const lst = wrap360(gmstDeg(jd) + lonDeg);
    const H = wrap180(lst - raDeg);

    const sinAlt =
        sind(decDeg)*sind(latDeg) +
        cosd(decDeg)*cosd(latDeg)*cosd(H);

    const alt = asind(sinAlt);

    const y = -sind(H);
    const x =
        tand(decDeg)*cosd(latDeg) -
        sind(latDeg)*cosd(H);

    const az = wrap360(atan2d(y,x));

    return {alt, az};
}

function sunRaDec(jd) {
    const n = jd - 2451545.0;

    const L = wrap360(280.460 + 0.9856474*n);
    const g = wrap360(357.528 + 0.9856003*n);

    const lambda = L + 1.915*sind(g) + 0.020*sind(2*g);
    const eps = 23.439 - 0.0000004*n;

    const ra = wrap360(atan2d(cosd(eps)*sind(lambda), cosd(lambda)));
    const dec = asind(sind(eps)*sind(lambda));

    return {ra, dec};
}

function moonRaDec(jd) {
    const n = jd - 2451545.0;

    const L = wrap360(218.316 + 13.176396*n);
    const M = wrap360(134.963 + 13.064993*n);
    const F = wrap360(93.272 + 13.229350*n);

    const lon = L + 6.289*sind(M);
    const lat = 5.128*sind(F);

    const eps = 23.439;

    const ra = wrap360(
        atan2d(
            sind(lon)*cosd(eps) - tand(lat)*sind(eps),
            cosd(lon)
        )
    );

    const dec = asind(
        sind(lat)*cosd(eps) +
        cosd(lat)*sind(eps)*sind(lon)
    );

    return {ra, dec};
}

function drawAltAzPlanner() {

    const canvas = document.getElementById("altAzPlot");
    if (!canvas) return;

    // -------------------------------------------------
    // Responsive sizing
    // -------------------------------------------------
    const parent = canvas.parentElement;
    const cssWidth = Math.max(320, parent.clientWidth - 8);
    const cssHeight = Math.max(320, Math.round(cssWidth * 0.62));

    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = cssWidth;
    const h = cssHeight;

    ctx.clearRect(0, 0, w, h);

    // -------------------------------------------------
    // Inputs
    // -------------------------------------------------
    const lat = parseFloat(document.getElementById("obsLat").value);
    const lon = parseFloat(document.getElementById("obsLon").value);
    const dateStr = document.getElementById("obsDate").value;

    if (!dateStr) return;

    const centerInputs = getRaDecInputs();
    if (!centerInputs) return;
    const ra = centerInputs.ra;
    const dec = centerInputs.dec;

    const minutesPerStep = 15;
    const totalHours = 24;

    const [year, month, day] = dateStr.split("-").map(Number);
    const start = zonedTimeToUTC(
        year, month, day,
        12, 0,
        "America/Chicago"
    );
    
    const samples = Math.floor(totalHours * 60 / minutesPerStep) + 1;

    const targetPoints = [];

    // -------------------------------------------------
    // Layout
    // -------------------------------------------------
    const marginLeft   = 46;
    const marginRight  = 14;
    const marginTop    = 28;
    const marginBottom = 52;

    const pw = w - marginLeft - marginRight;
    const ph = h - marginTop - marginBottom;

    function X(i) {
        return marginLeft + pw * i / (samples - 1);
    }

    function Y(alt) {
        return h - marginBottom - ph * (alt / 90);
    }

    // -------------------------------------------------
    // Theme
    // -------------------------------------------------
    const bgGrid = "rgba(255,255,255,0.08)";
    const fgText = "rgba(255,255,255,0.82)";
    const moonCol = "#fafafa";
    const astroDark = "rgba(30,45,80,0.32)";
    const horizonFill = "rgba(0,0,0,0.18)";

    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "middle";

    // -------------------------------------------------
    // Astronomical darkness shading
    // -------------------------------------------------
    for (let i = 0; i < samples - 1; i++) {

        const d = new Date(start.getTime() + i * minutesPerStep * 60000);
        const jd = toJulianDate(d);

        const sun = sunRaDec(jd);
        const sunAlt = radecToAltAz(
            sun.ra, sun.dec, lat, lon, jd
        ).alt;

        if (sunAlt < -18) {
            const x0 = X(i);
            const x1 = X(i + 1);

            ctx.fillStyle = astroDark;
            ctx.fillRect(x0, marginTop, x1 - x0 + 1, ph);
        }
    }

    // -------------------------------------------------
    // Below horizon fill
    // -------------------------------------------------
    ctx.fillStyle = horizonFill;
    ctx.fillRect(marginLeft, Y(0), pw, h - marginBottom - Y(0));

    // -------------------------------------------------
    // Horizontal altitude grid
    // -------------------------------------------------
    ctx.strokeStyle = bgGrid;
    ctx.lineWidth = 1;

    for (let a = 0; a <= 90; a += 15) {

        const y = Y(a);

        ctx.beginPath();
        ctx.moveTo(marginLeft, y);
        ctx.lineTo(w - marginRight, y);
        ctx.stroke();

        ctx.fillStyle = fgText;
        ctx.textAlign = "right";
        ctx.fillText(a + "°", marginLeft - 8, y);
    }

    // -------------------------------------------------
    // Vertical time grid every 3 hours
    // -------------------------------------------------
    for (let hr = 0; hr <= 24; hr += 3) {

        const idx = Math.round(hr * 60 / minutesPerStep);
        const x = X(idx);

        ctx.beginPath();
        ctx.moveTo(x, marginTop);
        ctx.lineTo(x, h - marginBottom);
        ctx.stroke();
    }

    const mosaicEnabled = document.getElementById("mosaicMode")?.checked === true;
    const targetCol = mosaicEnabled ? "#ffb000" : "#17e2ff";

    // -------------------------------------------------
    // Target altitude curve
    // -------------------------------------------------
    ctx.beginPath();
    ctx.strokeStyle = targetCol;
    ctx.lineWidth = 3;

    let maxAlt = -999;
    let maxIdx = 0;

    for (let i = 0; i < samples; i++) {

        const d = new Date(start.getTime() + i * minutesPerStep * 60000);
        const jd = toJulianDate(d);

        const aa = radecToAltAz(ra, dec, lat, lon, jd);
        const sun = sunRaDec(jd);
        const sunAlt = radecToAltAz(sun.ra, sun.dec, lat, lon, jd).alt;

        const moon = moonRaDec(jd);
        const moonAA = radecToAltAz(moon.ra, moon.dec, lat, lon, jd);

        const cosSep =
            sind(aa.alt) * sind(moonAA.alt) +
            cosd(aa.alt) * cosd(moonAA.alt) *
            cosd(aa.az - moonAA.az);

        const moonAngle = acosd(clamp(cosSep, -1, 1)); // angular separation between target and moon in degrees

        const alt = Math.max(0, aa.alt);
        const x = X(i);
        const y = Y(alt);

        targetPoints.push({
            x, y,
            alt: aa.alt,
            az: aa.az,
            sunAlt,
            moonAngle,
            time: new Date(d)
        });

        if (aa.alt > maxAlt) {
            maxAlt = aa.alt;
            maxIdx = i;
        }

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.stroke();

    // -------------------------------------------------
    // Moon curve
    // -------------------------------------------------
    ctx.beginPath();
    ctx.strokeStyle = moonCol;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);

    for (let i = 0; i < samples; i++) {

        const d = new Date(start.getTime() + i * minutesPerStep * 60000);
        const jd = toJulianDate(d);

        const moon = moonRaDec(jd);
        const aa = radecToAltAz(
            moon.ra, moon.dec, lat, lon, jd
        );

        const alt = Math.max(0, aa.alt);

        if (i === 0) ctx.moveTo(X(i), Y(alt));
        else ctx.lineTo(X(i), Y(alt));
    }

    ctx.stroke();
    ctx.setLineDash([]);

    // -------------------------------------------------
    // Meridian transit marker
    // -------------------------------------------------
    if (maxAlt > 0) {

        const x = X(maxIdx);

        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);

        ctx.beginPath();
        ctx.moveTo(x, marginTop);
        ctx.lineTo(x, h - marginBottom);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    // -------------------------------------------------
    // 20 degree altitude line
    // -------------------------------------------------
    const alt20Y = Y(20);
    ctx.strokeStyle = "rgba(150,255,180,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(marginLeft, alt20Y);
    ctx.lineTo(w - marginRight, alt20Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // -------------------------------------------------
    // X-axis labels (dual axis)
    // -------------------------------------------------

    ctx.textAlign = "center";

    // spacing between axes
    const primaryY   = h - 20;  // Central Time
    const secondaryY = h - 6;   // Local machine time

    for (let hr = 6; hr < 24; hr += 6) {

        const idx = Math.round(hr * 60 / minutesPerStep);
        const x = X(idx);

        const d = new Date(start.getTime() + hr * 3600000);

        // --- Central Time (primary) ---
        const ct = getZonedHM(d, "America/Chicago");
        
        ctx.fillStyle = fgText;
        ctx.fillText(`${ct.hh}:${ct.mm}`, x, primaryY);

        // --- Local machine time (secondary) ---
        const lt = getLocalHM(d);

        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(`${lt.hh}:${lt.mm}`, x, secondaryY);
    }

    ctx.textAlign = "left";

    ctx.fillStyle = fgText;
    ctx.fillText("Obs.", marginLeft, primaryY);

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Local", marginLeft, secondaryY);

    // -------------------------------------------------
    // Legend
    // -------------------------------------------------
    ctx.textAlign = "left";

    ctx.fillStyle = targetCol;
    ctx.fillRect(marginLeft, 8, 16, 3);

    ctx.fillStyle = fgText;
    ctx.fillText(
        mosaicEnabled ? "Mosaic Center" : "Target",
        marginLeft + 22,
        10
    );

    ctx.strokeStyle = moonCol;
    ctx.setLineDash([7,5]);
    ctx.beginPath();
    ctx.moveTo(marginLeft + 115, 10);
    ctx.lineTo(marginLeft + 135, 10);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = fgText;
    ctx.fillText("Moon", marginLeft + 140, 10);

    // -------------------------------------------------
    // Title
    // -------------------------------------------------
    ctx.textAlign = "right";
    ctx.fillStyle = fgText;

    const imageableMinutes = estimateImageableMinutes(targetPoints, 20, -18);

    // --------------------------------------------------
    // Update readout with textual info about the planner
    // --------------------------------------------------
    plannerCache = {
        canvas, 
        ctx,
        points: targetPoints,
        marginTop, marginBottom,
        h, w,
        imageableMinutes
    };

    canvas.onmousemove = handlePlannerHover;
    canvas.onmouseleave = clearPlannerHover;
    setPlannerInfoDefault(imageableMinutes);
    // canvas.onclick = function(evt){

    // const rect = canvas.getBoundingClientRect();
    // const mx = evt.clientX - rect.left;
    // const my = evt.clientY - rect.top;

    // let best = null;
    // let bestDist = 1e9;

    // for (const p of targetPoints){

    //         const dx = p.x - mx;
    //         const dy = p.y - my;
    //         const d = Math.hypot(dx, dy);

    //         if (d < bestDist){
    //             bestDist = d;
    //             best = p;
    //         }
    //     }

    //     if (!best || bestDist > 25) return;

    //     const hh = best.time.getHours().toString().padStart(2,"0");
    //     const mm = best.time.getMinutes().toString().padStart(2,"0");

    //     document.getElementById("altAzInfo").textContent =
    // `alt: ${best.alt.toFixed(1)}°
    // az: ${best.az.toFixed(1)}°
    // time: ${hh}:${mm}
    // moon angle: ${best.moonAngle.toFixed(1)}°`;
    // };
}

function handlePlannerHover(evt) {
    if (!plannerCache) return;
    const {canvas, points } = plannerCache;

    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;

    let best = -1;
    let bestDist = 1e9;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const d = Math.hypot(p.x - mx, p.y - my);

        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }

    if (bestDist > 40) {
        clearPlannerHover();
        return;
    }

    plannerHoverIndex = best;
    drawAltAzPlanner();
    drawPlannerHoverOverlay();
}

function clearPlannerHover() {
    if (plannerHoverIndex === -1) return;
    plannerHoverIndex = -1;
    drawAltAzPlanner();
}

function drawPlannerHoverOverlay(){

    if (!plannerCache) return;
    if (plannerHoverIndex < 0) return;

    const {
        ctx,
        points,
        marginTop,
        marginBottom,
        h
    } = plannerCache;

    const p = points[plannerHoverIndex];

    // vertical marker
    ctx.save();

    ctx.strokeStyle = "rgba(120,150,255,0.70)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4,4]);

    ctx.beginPath();
    ctx.moveTo(p.x, marginTop);
    ctx.lineTo(p.x, h - marginBottom);
    ctx.stroke();

    ctx.setLineDash([]);

    // glow
    ctx.beginPath();
    ctx.fillStyle = "rgba(23,226,255,0.20)";
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fill();

    // core dot
    ctx.beginPath();
    ctx.fillStyle = "#17e2ff";
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    const {hh, mm} = getZonedHM(p.time, TIMEZONE);

    const box = document.getElementById("altAzInfo");

    if (box){
        box.textContent =
`alt: ${p.alt.toFixed(1)}°
az: ${p.az.toFixed(1)}°
time: ${hh}:${mm}
moon angle: ${p.moonAngle.toFixed(1)}°`;
    }
}

// -------------------------
// Survey management
// -------------------------
function applySurveySettings(key) {
    const survey = aladin.getBaseImageLayer();
    if (!survey) return;

    if (key === 'P/DSS2/color') {
    // DSS2 color: keep native colors, apply stretch if you want
    survey.setColormap("native", { stretch: "asinh", reversed: false });
    // Optional: layer.setCuts(...) if you want fixed cuts
    }

    if (key === "P/Halpha") {
    survey.setColormap("grayscale", { stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }

    if (key === "P/Halpha inversed") {
    survey.setColormap("grayscale", { stretch: "asinh", reversed: true });
    survey.setCuts(0, 100);
    }

    if (key === "P/DSS2/red") {
    survey.setImageFormat("jpeg")
    survey.setColormap("grayscale", { stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }

    if (key === "P/AKARI/FIS/Color") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/AKARI/FIS/N60") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/halpha8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/oiii8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/ohs8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/rgb8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/hbr8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }
    if (key === "P/NSNS/DR0_2/sii8") {
    survey.setColormap({ stretch: "asinh", reversed: false });
    survey.setCuts(0, 100);
    }

}

function selectSurvey() {
    const key = document.getElementById("surveySelect").value;
    const delay = parseInt(document.getElementById("delayedUpdate").value, 10) || 600;
    console.log("Selected survey:", key);
    if (!aladin) return;

    // 1) Switch base survey (this is async internally)
    if (key === "P/DSS2/color") {
    aladin.setImageLayer("P/DSS2/color");  
    } else if (key === "P/Halpha" || key === "P/Halpha inversed") {
    aladin.setImageLayer("P/Finkbeiner");   
    } else if (key === "P/DSS2/red") {
    aladin.setImageLayer("P/DSS2/red");  
    } else if (key === "P/AKARI/FIS/Color") {
    aladin.setImageLayer("P/AKARI/FIS/Color");  
    } else if (key === "P/AKARI/FIS/N60") {
    aladin.setImageLayer("P/AKARI/FIS/N60");  
    } else if (key === "P/NSNS/DR0_2/halpha8") {
    aladin.setImageLayer("P/NSNS/DR0_2/halpha8");  
    } else if (key === "P/NSNS/DR0_2/oiii8") {
    aladin.setImageLayer("P/NSNS/DR0_2/oiii8");  
    } else if (key === "P/NSNS/DR0_2/sii8") {
    aladin.setImageLayer("P/NSNS/DR0_2/sii8");  
    } else if (key === "P/NSNS/DR0_2/ohs8") {
    aladin.setImageLayer("P/NSNS/DR0_2/ohs8");  
    } else if (key === "P/NSNS/DR0_2/hbr8") {
    aladin.setImageLayer("P/NSNS/DR0_2/hbr8");
    } else if (key === "P/NSNS/DR0_2/rgb8") {
    aladin.setImageLayer("P/NSNS/DR0_2/rgb8");
    }
    else {
    console.warn("Unknown survey key:", key);
    return;
    }

    // 2) Apply settings AFTER the base layer has actually switched
    setTimeout(() => {
    applySurveySettings(key);
    }, delay);
}


// -------------------------
// Aladin init + overlay
// -------------------------
let aladin = null;
let overlay = null;
let mosaicOverlay = null;
let currentFrameMode = 'single';
let alignFramesEnabled = false;

function ensureOverlay() {
    if (!overlay) {
    overlay = A.graphicOverlay({ color: '#00e5ff', lineWidth: 3 });
    aladin.addOverlay(overlay);
    }
}

function ensureMosaicOverlay() {
    if (!mosaicOverlay) {
    mosaicOverlay = A.graphicOverlay({ color: '#ffb000', lineWidth: 2 });
    aladin.addOverlay(mosaicOverlay);
    }
}

function clearMosaicOverlay() {
    if (!mosaicOverlay) return;
    if (typeof mosaicOverlay.removeAll === 'function') {
    mosaicOverlay.removeAll();
    }
}

function syncAlignFramesButton() {
    const button = document.getElementById('btnAlignFrames');
    if (!button) return;

    button.setAttribute('aria-pressed', alignFramesEnabled ? 'true' : 'false');
    button.style.background = alignFramesEnabled ? 'rgba(0, 229, 255, 0.24)' : '';
    button.style.borderColor = alignFramesEnabled ? '#00e5ff' : '';
}

function getAlignedPaneRotation(baseCenter, paneCenter, baseRotationDeg) {
    if (!alignFramesEnabled) return baseRotationDeg;

    const baseBasis = createTangentBasis(baseCenter.ra, baseCenter.dec);
    const rot = baseRotationDeg * DEG;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const baseFrameX = [
    cr * baseBasis.east[0] + sr * baseBasis.north[0],
    cr * baseBasis.east[1] + sr * baseBasis.north[1],
    cr * baseBasis.east[2] + sr * baseBasis.north[2]
    ];

    const paneBasis = createTangentBasis(paneCenter.ra, paneCenter.dec);
    const paneCenterVec = paneBasis.center;

    // Parallel-transport center frame X direction onto pane tangent plane.
    const projectedX = [
    baseFrameX[0] - dot(baseFrameX, paneCenterVec) * paneCenterVec[0],
    baseFrameX[1] - dot(baseFrameX, paneCenterVec) * paneCenterVec[1],
    baseFrameX[2] - dot(baseFrameX, paneCenterVec) * paneCenterVec[2]
    ];

    const norm = Math.hypot(projectedX[0], projectedX[1], projectedX[2]);
    if (!(norm > 1e-12)) return baseRotationDeg;

    const dir = [projectedX[0] / norm, projectedX[1] / norm, projectedX[2] / norm];
    const xOnEast = dot(dir, paneBasis.east);
    const xOnNorth = dot(dir, paneBasis.north);
    return Math.atan2(xOnNorth, xOnEast) / DEG;
}

function updateOverlayCenteredOnView() {
    ensureOverlay();

    const focal_mm = parseFloat(document.getElementById('focalLength').value);
    if (!(focal_mm > 0)) throw new Error("Focal length must be > 0.");

    const cam = getCameraParams();
    const { fovW_deg, fovH_deg } = computeFovDeg(focal_mm, cam.sensorW_mm, cam.sensorH_mm);

    const rot = parseFloat(document.getElementById('rotationDeg').value) || 0;
    const lineWidth = parseInt(document.getElementById('lineWidth').value, 10) || 3;
    const color = (document.getElementById('color').value || '#00e5ff').trim();
    const opacity = clamp(parseFloat(document.getElementById('opacity').value), 0, 1);
    const gridmode = document.getElementById('gridMode').value || "none";

    const center = getAladinCenter() || getFallbackCenterFromInputs();
    if (!center) {
    // Show something friendly and *just skip drawing* for now.
    document.getElementById('readout').textContent =
        "Loading sky view… (center not ready yet)";
    return;
    }
    const ra0 = center.ra;
    const dec0 = center.dec;

    const poly = makeFovPolygon(ra0, dec0, fovW_deg, fovH_deg, rot, gridmode);

    // Update overlay style + clear previous shapes
    if (typeof overlay.setColor === 'function') overlay.setColor(color);
    if (typeof overlay.setLineWidth === 'function') overlay.setLineWidth(lineWidth);
    if (typeof overlay.removeAll === 'function') overlay.removeAll();

    const shapeOptions = { color, lineWidth, opacity, fill: false };

    // Add footprint polygon (official pattern: overlay.addFootprints([A.polygon(...)]) )
    overlay.addFootprints([A.polygon(poly, shapeOptions)]);

    // Update readout
    const pixScale = computePixelScaleArcsecPx(focal_mm, cam.pix_um);
    const lines = [];
    lines.push(`Sensor: ${cam.sensorW_mm.toFixed(3)} x ${cam.sensorH_mm.toFixed(3)} mm`);
    if (cam.nx && cam.ny) lines.push(`Resolution: ${cam.nx} x ${cam.ny} px  |  pixel: ${cam.pix_um} µm`);
    lines.push(`Focal length: ${focal_mm.toFixed(2)} mm`);
    lines.push(`FoV (W x H): ${formatDeg(fovW_deg)} x ${formatDeg(fovH_deg)}  (${formatArcmin(fovW_deg)} x ${formatArcmin(fovH_deg)})`);
    if (pixScale) lines.push(`Pixel scale: ${pixScale.toFixed(3)} arcsec/px`);
    lines.push(`Center (ICRS): RA ${fmtDegMaybe(ra0, 6)}, Dec ${fmtDegMaybe(dec0, 6)}`);
    lines.push(`Rotation: ${rot.toFixed(2)}°`);
    document.getElementById('readout').textContent = lines.join("\n");
    rotateView();
}

function updateRaDec() {
    const center = aladin.getRaDec();
    if (!center) return;
    syncRaDecInputsFromDegrees(center[0], center[1]);
    updateOverlayCenteredOnView();
}

function followView() {
    const checked = document.getElementById('followView').checked;
    if (!aladin) return;
    if (!checked) return;
    updateRaDec();
    refreshActiveFrame();
}

function rotateView() {
    const checked = document.getElementById('rotateView').checked;
    if (!aladin) return;

    const applyAladinRotation = (deg) => {
        if (!Number.isFinite(deg)) return;
        const normalized = ((deg % 360) + 360) % 360;
        // Aladin warns on 0 because it is treated as invalid internally.
        // 360° is visually equivalent to 0°.
        const safeDeg = (Math.abs(normalized) < 1e-12) ? 360 : normalized;
        aladin.setRotation(safeDeg);
    };

    if (!checked) {
    applyAladinRotation(0);
    return;
    }
    const rot = parseFloat(document.getElementById('rotationDeg').value) || 0;
    applyAladinRotation(rot);
}

function safeUpdate() {
    try {
    if (!aladin) return;
    if (document.getElementById('mosaicMode')?.checked) {
    updateMosaicOverlay();
    return;
    }
    updateOverlayCenteredOnView(); 
    } catch (e) { 
    document.getElementById('readout').textContent = "Error: " + (e?.message || String(e));
    }
    if (!document.getElementById("obsDate").value) {
        document.getElementById("obsDate").value =
            new Date().toISOString().slice(0,10);
    }
    drawAltAzPlanner();
}

function refreshActiveFrame() {
    if (currentFrameMode === 'mosaic' || document.getElementById('mosaicMode')?.checked) {
    currentFrameMode = 'mosaic';
    updateMosaicOverlay();
    return;
    }
    currentFrameMode = 'single';
    safeUpdate();
}

function clampMosaicInputValue(input) {
    if (!input) return;
    const parsed = parseInt(input.value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
    input.value = '1';
    return;
    }
    if (parsed > 10) {
    input.value = '10';
    return;
    }
    input.value = String(parsed);
}

function getMosaicDimensions() {
    const colsInput = document.getElementById('mosaicCols');
    const rowsInput = document.getElementById('mosaicRows');
    clampMosaicInputValue(colsInput);
    clampMosaicInputValue(rowsInput);
    const cols = parseInt(colsInput.value, 10) || 1;
    const rows = parseInt(rowsInput.value, 10) || 1;
    const verticalOverlap = clamp(parseFloat(document.getElementById('verticalOverlap').value) || 0, -100, 100);
    const horizontalOverlap = clamp(parseFloat(document.getElementById('horizontalOverlap').value) || 0, -100, 100);
    return { cols, rows, verticalOverlap, horizontalOverlap };
}

function computeMosaicPaneCenters(center, focal_mm, cam, rotationDeg, mosaic) {
    const { fovW_deg, fovH_deg } = computeFovDeg(focal_mm, cam.sensorW_mm, cam.sensorH_mm);

    const stepXDeg = fovW_deg * (1 - mosaic.horizontalOverlap / 100);
    const stepYDeg = fovH_deg * (1 - mosaic.verticalOverlap / 100);

    // Build the rotated tangent-plane basis at the mosaic center
    const basis = createTangentBasis(center.ra, center.dec);
    const rot = rotationDeg * DEG;
    const cr = Math.cos(rot), sr = Math.sin(rot);

    // Rotated east/north axes (same rotation convention as makeFovPolygon)
    const eR = [
        cr * basis.east[0] + sr * basis.north[0],
        cr * basis.east[1] + sr * basis.north[1],
        cr * basis.east[2] + sr * basis.north[2],
    ];
    const nR = [
        -sr * basis.east[0] + cr * basis.north[0],
        -sr * basis.east[1] + cr * basis.north[1],
        -sr * basis.east[2] + cr * basis.north[2],
    ];

    const panes = [];
    for (let row = 0; row < mosaic.rows; row++) {
        for (let col = 0; col < mosaic.cols; col++) {
            // Offset in the rotated frame (radians in tangent plane)
            const xOff = (col - (mosaic.cols - 1) / 2) * stepXDeg * DEG;
            const yOff = ((mosaic.rows - 1) / 2 - row) * stepYDeg * DEG;

            // Gnomonic offset from center along rotated axes
            const v = normalize([
                basis.center[0] + xOff * eR[0] + yOff * nR[0],
                basis.center[1] + xOff * eR[1] + yOff * nR[1],
                basis.center[2] + xOff * eR[2] + yOff * nR[2],
            ]);
            const paneCenter = vecToRaDec(v);
            const paneRotationDeg = getAlignedPaneRotation(center, paneCenter, rotationDeg);

            panes.push({
                row: row + 1,
                col: col + 1,
                center: paneCenter,
                rotationDeg: paneRotationDeg,
                polygon: makeFovPolygon(paneCenter.ra, paneCenter.dec, fovW_deg, fovH_deg, paneRotationDeg, 'none'),
                widthArcmin: fovW_deg * 60,
                heightArcmin: fovH_deg * 60,
            });
        }
    }
    return { panes, fovW_deg, fovH_deg };
}

function buildMosaicPaneData(center, focal_mm, cam, rotationDeg, mosaic) {
    return computeMosaicPaneCenters(center, focal_mm, cam, rotationDeg, mosaic).panes;
}

function buildMosaicFramingCsv(center, focal_mm, cam, rotationDeg, mosaic) {
    const { panes, fovW_deg, fovH_deg } = computeMosaicPaneCenters(center, focal_mm, cam, rotationDeg, mosaic);
    const lines = [];

    lines.push(`Pane, RA, DEC, Position Angle (East), Pane width (arcmins), Pane height (arcmins), Row, Column`);

    for (const pane of panes) {
        const paneIndex = (pane.row - 1) * mosaic.cols + pane.col;
        lines.push(
            `Pane ${paneIndex}, ${fmtDegMaybe(pane.center.ra)}, ${fmtDegMaybe(pane.center.dec)}, ${pane.rotationDeg.toFixed(2)}°, ${pane.widthArcmin.toFixed(2)}, ${pane.heightArcmin.toFixed(2)}, ${pane.row}, ${pane.col}`
        );
    }

    return lines.join('\n');
}

function updateMosaicOverlay() {
    ensureMosaicOverlay();
    if (overlay && typeof overlay.removeAll === 'function') {
    overlay.removeAll();
    }

    const center = getAladinCenter() || getFallbackCenterFromInputs();
    if (!center) {
    document.getElementById('readout').textContent = 'Loading sky view… (center not ready yet)';
    return;
    }

    const focal_mm = parseFloat(document.getElementById('focalLength').value);
    if (!(focal_mm > 0)) throw new Error('Focal length must be > 0.');

    const cam = getCameraParams();
    const rotationDeg = parseFloat(document.getElementById('rotationDeg').value) || 0;
    const mosaic = getMosaicDimensions();
    const panes = buildMosaicPaneData(center, focal_mm, cam, rotationDeg, mosaic);

    if (typeof mosaicOverlay.setColor === 'function') mosaicOverlay.setColor('#ffb000');
    if (typeof mosaicOverlay.setLineWidth === 'function') mosaicOverlay.setLineWidth(2);
    if (typeof mosaicOverlay.removeAll === 'function') mosaicOverlay.removeAll();

    const shapes = panes.map((pane) => A.polygon(pane.polygon, {
    color: '#ffb000',
    lineWidth: 2,
    opacity: 0.85,
    fill: false
    }));
    mosaicOverlay.addFootprints(shapes);

    const lines = [];
    lines.push(`Mosaic: ${mosaic.rows} rows x ${mosaic.cols} cols`);
    lines.push(`Alignment: ${alignFramesEnabled ? 'On' : 'Off'}`);
    lines.push(`Overlap: ${mosaic.horizontalOverlap.toFixed(1)}% H / ${mosaic.verticalOverlap.toFixed(1)}% V`);
    lines.push(`Pane size: ${(panes[0]?.widthArcmin || 0).toFixed(2)} x ${(panes[0]?.heightArcmin || 0).toFixed(2)} arcmin`);
    lines.push(`Total panes: ${panes.length}`);
    lines.push('');
    lines.push(buildMosaicFramingCsv(center, focal_mm, cam, rotationDeg, mosaic));
    document.getElementById('readout').textContent = lines.join('\n');

    if (!document.getElementById("obsDate").value) {
        document.getElementById("obsDate").value =
            new Date().toISOString().slice(0,10);
    }
    drawAltAzPlanner();
}

function buildFrameCsv() {
    const center = getAladinCenter() || getFallbackCenterFromInputs();
    if (!center) return;
    const focal_mm = parseFloat(document.getElementById('focalLength').value);
    if (focal_mm <= 0) return;
    const cam = getCameraParams();
    let framing;
    if (document.getElementById('mosaicMode')?.checked) {
        const rotationDeg = parseFloat(document.getElementById('rotationDeg').value) || 0;
        const mosaic = getMosaicDimensions();
        framing = buildMosaicFramingCsv(center, focal_mm, cam, rotationDeg, mosaic);
    } 
    else {
        const { fovW_deg, fovH_deg } = computeFovDeg(focal_mm, cam.sensorW_mm, cam.sensorH_mm);
        const rot = parseFloat(document.getElementById('rotationDeg').value) || 0;
        framing = // for a single pane
        `Pane, RA, DEC, Position Angle (East), Pane width (arcmins), Pane height (arcmins), Overlap, Row, Column
            Pane 1, ${fmtDegMaybe(center.ra)}, ${fmtDegMaybe(center.dec)}, ${rot.toFixed(2)}°, ${(fovW_deg*60).toFixed(2)}, ${(fovH_deg*60).toFixed(2)}, 0%, -, -`;   
    }
    return framing;
}

function copyTextToClipboard(text, desc) {
    return navigator.clipboard.writeText(text).then(() => {
        console.log(`${desc} copied to clipboard successfully.`);
    }).catch(err => {
        console.error(`Failed to copy ${desc} to clipboard:`, err);
        throw err;
    });
}

async function retrievePreview() {
    const center = getRaDecInputs();

    if (!center || !Number.isFinite(center.ra) || !Number.isFinite(center.dec)) {
        alert("Invalid coordinates.");
        return;
    }

    const focal_mm = parseFloat(document.getElementById('focalLength').value);
    const cam = getCameraParams();
    if (focal_mm <= 0 || !cam) {
        alert("Invalid camera parameters.");
        return;
    }

    const { fovW_deg, fovH_deg } =
        computeFovDeg(focal_mm, cam.sensorW_mm, cam.sensorH_mm);

    const viewFOV = Math.max(fovW_deg, fovH_deg) * 1.3;

    aladin.setFoV(viewFOV);
    aladin.gotoRaDec(center.ra, center.dec);

    // popup window to prevent user from moving the view before preview is generated
    const previewPopup = window.open('', '_blank','width=1200,height=800,resizable=yes');
    if (!previewPopup) {
        alert('Failed to open new tab for preview image. Please allow popups and try again.');
        return;
    }
    previewPopup.document.write(`
        <html>
            <head><title>Framing Preview</title></head>
            <body style="margin:0; display:flex; justify-content:center; align-items:center; height:100vh; background:#000; color:#fff; font-family:sans-serif;">
                <div style="text-align:center;">
                    <p>Generating preview...</p>
                    <p style="font-size:0.9em; color:#aaa;">If this takes too long, try moving the Aladin view slightly to trigger a refresh.</p>
                </div>
            </body>
        </html>
    `);

    await new Promise(r => setTimeout(r, 1000));

    const preview = await aladin.getViewDataURL();

    if (!preview?.startsWith("data:image")) {
        alert("Failed to generate preview.");
        return;
    }

    // first remove loading message:
    previewPopup.document.body.innerHTML = '';
    // writing image to window
    previewPopup.document.write(`
        <html>
            <head><title>Framing Preview</title></head>
            <body style="margin:0; display:flex; justify-content:center; align-items:center; height:100vh; background:#000;">
                <img src="${preview}" alt="Framing Preview" style="max-width:90%; max-height:90%; border: 2px solid #00e5ff; box-shadow: 0 0 20px #00e5ff;">
            </body>
        </html>
    `);

}

function applySimplifiedMode() {
    const simplifiedEl = document.getElementById('simplifiedView');
    const simplified = simplifiedEl ? simplifiedEl.checked : false;

    const toggleById = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = simplified ? 'none' : '';
    };

    // Hide whole groups that are not part of simplified UI (keep altitude chart visible)
    ['mosaicGroup', 'surveyGroup', 'overlayGroup', 'computedGroup'].forEach(toggleById);

    // Hide the extra actions in Target group (keep goto buttons)
    toggleById('targetActions');

    // Keep telescope setup select visible but hide parameters
    toggleById('telescopeParams');

    // Ensure altitude chart is visible and expanded in simplified mode
    const altitudeGroup = document.getElementById('altitudeGroup');
    if (altitudeGroup) {
        if (simplified) {
            altitudeGroup.style.display = '';
            altitudeGroup.classList.remove('collapsed');
        } else {
            // respect original collapsed state when leaving simplified mode
            altitudeGroup.classList.add('collapsed');
        }
    }

    // Hide mosaic-specific copy button if present
    const copyMosaic = document.getElementById('copyMosaic');
    if (copyMosaic) copyMosaic.style.display = simplified ? 'none' : '';

    // Force follow view to be enabled and hide its checkbox when simplified
    const followRow = document.getElementById('followRow');
    const followInput = document.getElementById('followView');
    if (followInput) {
        followInput.checked = true;
        followInput.disabled = simplified;
    }
    if (followRow) followRow.style.display = simplified ? 'none' : '';

    // When simplified is enabled, ensure the overlay is following right away
    if (simplified) {
        try { updateRaDec(); } catch (e) {}
        try { refreshActiveFrame(); } catch (e) {}
    }
}

function wireInputs() {
    const ids = [
    'focalLength','sensorW','sensorH','nx','ny','pixSize',
    'lineWidth','color','opacity','cameraMode', //'gridMode'
    ];

    ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return; // extra safety
    el.addEventListener('input', refreshActiveFrame);
    el.addEventListener('change', refreshActiveFrame);
    });

    const rotationSlider = document.getElementById('rotationDeg');
    const rotationValue = document.getElementById('rotationValue');
    const updateRotation = (source) => {
        const nextValue = readRotationValue(source);
        setRotationDeg(nextValue);
    };
    if (rotationSlider) {
    rotationSlider.addEventListener('input', () => updateRotation(rotationSlider));
    rotationSlider.addEventListener('change', () => updateRotation(rotationSlider));
    }
    if (rotationValue) {
    rotationValue.addEventListener('input', () => {
        updateRotation(rotationValue);
    });
    rotationValue.addEventListener('blur', () => {
        updateRotation(rotationValue);
    });
    }
    syncRotationValue();

    const rotationButtons = [
    ['btnRotateCcw30', -30],
    ['btnRotateCcw5', -5],
    ['btnRotateNearest0mod30', 0],
    ['btnRotateCw5', 5],
    ['btnRotateCw30', 30],
    ];

    rotationButtons.forEach(([id, delta]) => {
        const button = document.getElementById(id);
        if (!button) return;
        if (id === 'btnRotateNearest0mod30') {
            button.addEventListener('click', () => {
            const currentRotation = parseFloat(document.getElementById('rotationDeg').value) || 0;
            const nearest = Math.round(currentRotation / 30) * 30;
            document.getElementById('rotationDeg').value = nearest;
            syncRotationValue();
            refreshActiveFrame();
            });
        }
        button.addEventListener('click', () => adjustRotationDeg(delta));
    });
    
    ['mosaicCols', 'mosaicRows', 'horizontalOverlap', 'verticalOverlap'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        if (id === 'mosaicCols' || id === 'mosaicRows') clampMosaicInputValue(el);
        refreshActiveFrame();
        drawAltAzPlanner();
    });
    el.addEventListener('change', () => {
        if (id === 'mosaicCols' || id === 'mosaicRows') clampMosaicInputValue(el);
        refreshActiveFrame();
        drawAltAzPlanner();
    });
    });

    const mosaicModeCheckbox = document.getElementById('mosaicMode');
    mosaicModeCheckbox?.addEventListener("change", drawAltAzPlanner);
    if (mosaicModeCheckbox) {
    mosaicModeCheckbox.addEventListener('change', () => {
        currentFrameMode = mosaicModeCheckbox.checked ? 'mosaic' : 'single';
        if (!mosaicModeCheckbox.checked) {
        clearMosaicOverlay();
        }
        refreshActiveFrame();
    });
    }

    const alignFramesButton = document.getElementById('btnAlignFrames');
    if (alignFramesButton) {
    syncAlignFramesButton();
    alignFramesButton.addEventListener('click', () => {
        alignFramesEnabled = !alignFramesEnabled;
        syncAlignFramesButton();
        refreshActiveFrame();
    });
    }

    document.getElementById('btnUpdate').addEventListener('click', () => {
    currentFrameMode = 'single';
    const mosaicModeCheckbox = document.getElementById('mosaicMode');
    if (mosaicModeCheckbox) {
        mosaicModeCheckbox.checked = false;
        clearMosaicOverlay();
    }
    safeUpdate();
    });
    document.getElementById('btnRecenter').addEventListener('click', () => {
    currentFrameMode = 'single';
    const mosaicModeCheckbox = document.getElementById('mosaicMode');
    if (mosaicModeCheckbox) {
        mosaicModeCheckbox.checked = false;
        clearMosaicOverlay();
    }
    safeUpdate();
    });

    document.getElementById('btnGotoName').addEventListener('click', () => {
    const name = document.getElementById('targetName').value.trim();
    if (!name) return;
    aladin.gotoObject(name);
    setTimeout(updateRaDec, 250); // update RA/Dec after goto (with some delay to ensure it has updated)
    refreshActiveFrame();
    });

    // Shared RA/Dec goto action (used by button, change events, and Enter key)
    const gotoRaDecAction = () => {
        const center = getRaDecInputs();
        if (!center) return;
        const ra = center.ra;
        const dec = center.dec;
        try {
            aladin.gotoRaDec(ra, dec);
        } catch (e) {
            console.error('gotoRaDec failed', e);
        }
        setTimeout(refreshActiveFrame, 250);
    };

    const handleRaDecPaste = (event) => {
        const text = event.clipboardData?.getData('text');
        const parsed = parsePastedRaDec(text);
        if (!parsed) return;

        event.preventDefault();
        syncRaDecInputsFromDegrees(parsed.ra, parsed.dec);
        gotoRaDecAction();
    };

    // Wire change events
    ['raDeg', 'decDeg'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('paste', handleRaDecPaste);
        el.addEventListener('change', gotoRaDecAction);
        // also wire Enter key to trigger goto
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                gotoRaDecAction();
            }
        });
    });


    const toggleFormatButton = document.getElementById('btnToggleRaDecFormat');
    if (toggleFormatButton) {
    toggleFormatButton.addEventListener('click', () => {
        toggleRaDecDisplayMode();
        refreshActiveFrame();
    });
    }

    // Simplified view toggle wiring
    const simplifiedEl = document.getElementById('simplifiedView');
    if (simplifiedEl) {
    simplifiedEl.addEventListener('change', applySimplifiedMode);
    }

    // Apply mode on init
    applySimplifiedMode();

    // Enter key navigation
    document.getElementById('targetName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btnGotoName').click();
        }
    });

    // if CMD/CTRL + S, trigger the retrievePreview function
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            retrievePreview();
        }
    });
}

document.getElementById('updateRaDec').addEventListener('click', () => {
    updateRaDec();
    refreshActiveFrame();
});

document.getElementById('updateRaDecMosaic').addEventListener('click', () => {
    updateRaDec();
    refreshActiveFrame();
});


document.getElementById('rotateView').addEventListener('change', (evt) => {
    const checked = evt.target.checked;
    if (!aladin) return;
    rotateView();
});

document.getElementById('followView').addEventListener('change', (evt) => {
    const checked = evt.target.checked;
    if (!aladin) return;
    followView();
});

updateRaDecLabels();
syncRaDecInputsFromDegrees(parseAngleInput(document.getElementById('raDeg').value, 'ra') || 0, parseAngleInput(document.getElementById('decDeg').value, 'dec') || 0);

document.getElementById('obsLat').addEventListener('change', () => {
    drawAltAzPlanner();
});
document.getElementById('obsLon').addEventListener('change', () => {
    drawAltAzPlanner();
});
document.getElementById('obsDate').addEventListener('change', () => {
    drawAltAzPlanner();
});

document.getElementById("surveySelect").addEventListener("change", () => {
    if (!aladin) return;
    selectSurvey();
    });

document.getElementById('copyFraming').addEventListener('click', () => {
   copyTextToClipboard(buildFrameCsv(), "Framing info");
});

document.getElementById('copyMosaic').addEventListener('click', () => {
    copyTextToClipboard(buildFrameCsv(), "Mosaic framing info")
});

// -------------------------
// Boot
// -------------------------
A.init.then(() => {
    aladin = A.aladin('#aladin-lite-div', {
    survey: "P/DSS2/color", // default survey (restyle in selectSurvey)
    target: "M42",
    fov: 4.0,
    showCooGrid: false,
    showCooGridControl: true,
    showSimbadPointerControl: false,
    showFullscreenControl: true,
    expandLayersControl: false,
    showLayersControl: false,
    showFrameControl: false,
    showGotoPointerControl: true,
    showGotoControl: true,
    showSimbadPointer: true,
    showShare: true,
    });
    aladin.setProjection('SIN');

    selectSurvey(); // apply initial survey settings

    wireInputs();
    safeUpdate();

    // Keep overlay in sync when user drags/zooms (debounced)
    let t = null;
    aladin.on('positionChanged', () => {
    clearTimeout(t);
    t = setTimeout(() => {
        if (document.getElementById('followView')?.checked) updateRaDec();
        refreshActiveFrame();
    }, 120);
    });
}).catch(err => {
    const msg = String(err?.message || err || "Unknown error");
    const storageHint = msg.includes("localStorage")
    ? "\n\nThis browser context blocks localStorage. Open this page in a normal browser tab (Chrome/Safari/Firefox) via Live Server."
    : "";

    document.body.innerHTML =
    "<pre style='padding:16px;color:#fff;background:#000'>Failed to init Aladin Lite: " +
    msg + storageHint + "</pre>";
});