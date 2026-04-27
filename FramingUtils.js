// FramingUtils.js for SkyShare Framing Tool
// author: Ben Coull-Neveu

// -------------------------
// Helpers: geometry + FoV
// -------------------------
const DEG = Math.PI / 180.0;

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function getFallbackCenterFromInputs() {
    const ra = Number.parseFloat(document.getElementById('raDeg').value);
    const dec = Number.parseFloat(document.getElementById('decDeg').value);
    if (Number.isFinite(ra) && Number.isFinite(dec)) return { ra, dec };
    return null;
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

    const ra = parseFloat(document.getElementById("raDeg").value);
    const dec = parseFloat(document.getElementById("decDeg").value);

    const minutesPerStep = 15;
    const totalHours = 24;

    const start = new Date(dateStr + "T12:00:00");
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
    // X-axis labels every 6h
    // -------------------------------------------------
    ctx.textAlign = "center";
    ctx.fillStyle = fgText;

    for (let hr = 0; hr <= 24; hr += 6) {

        const idx = Math.round(hr * 60 / minutesPerStep);
        const x = X(idx);

        const d = new Date(start.getTime() + hr * 3600000);

        const hh = d.getHours().toString().padStart(2, "0");
        const mm = d.getMinutes().toString().padStart(2, "0");

        ctx.fillText(`${hh}:${mm}`, x, h - 20);
    }

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

    // --------------------------------------------------
    // Update readout with textual info about the planner
    // --------------------------------------------------
    canvas.onclick = function(evt){

    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;

    let best = null;
    let bestDist = 1e9;

    for (const p of targetPoints){

            const dx = p.x - mx;
            const dy = p.y - my;
            const d = Math.hypot(dx, dy);

            if (d < bestDist){
                bestDist = d;
                best = p;
            }
        }

        if (!best || bestDist > 25) return;

        const hh = best.time.getHours().toString().padStart(2,"0");
        const mm = best.time.getMinutes().toString().padStart(2,"0");

        document.getElementById("altAzInfo").textContent =
    `alt: ${best.alt.toFixed(1)}°
    az: ${best.az.toFixed(1)}°
    time: ${hh}:${mm}
    moon angle: ${best.moonAngle.toFixed(1)}°`;
    };
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
    } else {
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
    document.getElementById('raDeg').value = center[0];
    document.getElementById('decDeg').value = center[1];
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
    if (document.getElementById('mosaicMode')?.checked) {
        const rotationDeg = parseFloat(document.getElementById('rotationDeg').value) || 0;
        const mosaic = getMosaicDimensions();
        framing = buildMosaicFramingCsv(center, focal_mm, cam, rotationDeg, mosaic);
    } 
    else {
        const { fovW_deg, fovH_deg } = computeFovDeg(focal_mm, cam.sensorW_mm, cam.sensorH_mm);
        const rot = parseFloat(document.getElementById('rotationDeg').value) || 0;
        const framing = // for a single pane
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

function wireInputs() {
    const ids = [
    'focalLength','sensorW','sensorH','nx','ny','pixSize', 'rotationDeg',
    'lineWidth','color','opacity','cameraMode', //'gridMode'
    ];

    ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return; // extra safety
    el.addEventListener('input', refreshActiveFrame);
    el.addEventListener('change', refreshActiveFrame);
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

    document.getElementById('btnGotoRaDec').addEventListener('click', () => {
    const ra = parseFloat(document.getElementById('raDeg').value);
    const dec = parseFloat(document.getElementById('decDeg').value);
    if (!(isFinite(ra) && isFinite(dec))) return;
    aladin.gotoRaDec(ra, dec);
    setTimeout(refreshActiveFrame, 250);
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
    showGotoControl: false
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