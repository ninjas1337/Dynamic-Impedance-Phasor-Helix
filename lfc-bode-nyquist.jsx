import { useState, useRef, useEffect, useCallback } from "react";

// Complex number helpers
const cx = (re, im) => ({ re, im });
const cxMul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cxInv = (a) => {
  const d = a.re * a.re + a.im * a.im;
  return cx(a.re / d, -a.im / d);
};
const cxMag = (a) => Math.sqrt(a.re * a.re + a.im * a.im);
const cxPhase = (a) => (Math.atan2(a.im, a.re) * 180) / Math.PI;
const cxAdd = (a, b) => cx(a.re + b.re, a.im + b.im);

function evalOpenLoop(w, params) {
  const { H, D, R, Tg, Tt, Ki, showSecondary } = params;
  const droop = cx(1 / R, 0);
  const agcTerm = showSecondary ? cx(0, -Ki / w) : cx(0, 0);
  const controller = cxAdd(droop, agcTerm);
  const gov = cxInv(cx(1, w * Tg));
  const turb = cxInv(cx(1, w * Tt));
  const plant = cxInv(cx(D, 2 * H * w));
  return cxMul(cxMul(cxMul(controller, gov), turb), plant);
}

function logspace(start, end, n) {
  const arr = [];
  const logStart = Math.log10(start);
  const logEnd = Math.log10(end);
  for (let i = 0; i < n; i++) {
    arr.push(Math.pow(10, logStart + (i / (n - 1)) * (logEnd - logStart)));
  }
  return arr;
}

function findMargins(freqs, mags, phases) {
  let gainCrossoverFreq = null;
  let phaseAtGainCrossover = null;
  let phaseCrossoverFreq = null;
  let gainAtPhaseCrossover = null;
  for (let i = 1; i < freqs.length; i++) {
    if ((mags[i - 1] >= 0 && mags[i] < 0) || (mags[i - 1] < 0 && mags[i] >= 0)) {
      if (!gainCrossoverFreq) {
        const t = (0 - mags[i - 1]) / (mags[i] - mags[i - 1]);
        gainCrossoverFreq = freqs[i - 1] * Math.pow(freqs[i] / freqs[i - 1], t);
        phaseAtGainCrossover = phases[i - 1] + t * (phases[i] - phases[i - 1]);
      }
    }
    if ((phases[i - 1] >= -180 && phases[i] < -180) || (phases[i - 1] < -180 && phases[i] >= -180)) {
      if (!phaseCrossoverFreq) {
        const t = (-180 - phases[i - 1]) / (phases[i] - phases[i - 1]);
        phaseCrossoverFreq = freqs[i - 1] * Math.pow(freqs[i] / freqs[i - 1], t);
        gainAtPhaseCrossover = mags[i - 1] + t * (mags[i] - mags[i - 1]);
      }
    }
  }
  const phaseMargin = phaseAtGainCrossover !== null ? 180 + phaseAtGainCrossover : null;
  const gainMargin = gainAtPhaseCrossover !== null ? -gainAtPhaseCrossover : null;
  return { phaseMargin, gainMargin, gainCrossoverFreq, phaseCrossoverFreq };
}

const FREQ_MIN = 0.0005;
const FREQ_MAX = 50;
const N_POINTS = 800;

const C = {
  bg: "#0a0e17",
  panel: "#111827",
  grid: "#1e2a3a",
  gridMinor: "#141e2d",
  text: "#8899aa",
  textBright: "#c8d8e8",
  accent: "#00e5ff",
  accentDim: "rgba(0,229,255,0.15)",
  warn: "#ff5252",
  warnDim: "rgba(255,82,82,0.15)",
  safe: "#69f0ae",
  safeDim: "rgba(105,240,174,0.15)",
  secondary: "#ffab40",
  secondaryDim: "rgba(255,171,64,0.15)",
  reference: "#5c6bc0",
  referenceDim: "rgba(92,107,192,0.3)",
  zeroline: "#2a3a4f",
  nyqCurve: "#00e5ff",
  nyqRef: "rgba(92,107,192,0.4)",
  critical: "#ff5252",
  unitCircle: "rgba(255,255,255,0.08)",
  reProj: "#69f0ae",
  imProj: "#ffab40",
};

// ─── Bode Plot Component ───
function BodePlot({ freqs, mags, phases, refMags, refPhases, margins }) {
  const magRef = useRef(null);
  const phaseRef = useRef(null);

  const draw = useCallback(() => {
    const magCanvas = magRef.current;
    const phaseCanvas = phaseRef.current;
    if (!magCanvas || !phaseCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = magCanvas.parentElement.clientWidth;
    const Hc = 200;

    for (const cv of [magCanvas, phaseCanvas]) {
      cv.width = W * dpr; cv.height = Hc * dpr;
      cv.style.width = W + "px"; cv.style.height = Hc + "px";
    }

    const pad = { l: 56, r: 16, t: 12, b: 28 };
    const pw = W - pad.l - pad.r;
    const ph = Hc - pad.t - pad.b;
    const logMin = Math.log10(FREQ_MIN), logMax = Math.log10(FREQ_MAX);
    const xOf = (f) => pad.l + ((Math.log10(f) - logMin) / (logMax - logMin)) * pw;

    // ── Magnitude ──
    const mc = magCanvas.getContext("2d");
    mc.setTransform(dpr, 0, 0, dpr, 0, 0);
    mc.clearRect(0, 0, W, Hc);
    const magMin = -80, magMax = 60;
    const yM = (db) => pad.t + ((magMax - db) / (magMax - magMin)) * ph;

    // Grid
    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      const x = xOf(Math.pow(10, e));
      if (x >= pad.l && x <= W - pad.r) {
        mc.strokeStyle = C.grid; mc.lineWidth = 0.6;
        mc.beginPath(); mc.moveTo(x, pad.t); mc.lineTo(x, Hc - pad.b); mc.stroke();
      }
    }
    for (let db = magMin; db <= magMax; db += 20) {
      const y = yM(db);
      mc.strokeStyle = db === 0 ? C.zeroline : C.grid;
      mc.lineWidth = db === 0 ? 1.2 : 0.5;
      mc.beginPath(); mc.moveTo(pad.l, y); mc.lineTo(W - pad.r, y); mc.stroke();
      mc.fillStyle = C.text; mc.font = "9px monospace"; mc.textAlign = "right";
      mc.fillText(db + "", pad.l - 5, y + 3);
    }

    // Reference
    if (refMags) {
      mc.strokeStyle = C.referenceDim; mc.lineWidth = 1.5; mc.setLineDash([4, 4]);
      mc.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = xOf(freqs[i]), y = yM(Math.max(magMin, Math.min(magMax, refMags[i])));
        i === 0 ? mc.moveTo(x, y) : mc.lineTo(x, y);
      }
      mc.stroke(); mc.setLineDash([]);
    }

    // Main curve
    mc.strokeStyle = C.accent; mc.lineWidth = 2; mc.shadowColor = C.accent; mc.shadowBlur = 5;
    mc.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = xOf(freqs[i]), y = yM(Math.max(magMin, Math.min(magMax, mags[i])));
      i === 0 ? mc.moveTo(x, y) : mc.lineTo(x, y);
    }
    mc.stroke(); mc.shadowBlur = 0;

    // GM marker
    if (margins.phaseCrossoverFreq && margins.gainMargin !== null) {
      const x = xOf(margins.phaseCrossoverFreq);
      if (x >= pad.l && x <= W - pad.r) {
        mc.strokeStyle = margins.gainMargin > 0 ? C.safe : C.warn;
        mc.lineWidth = 1.2; mc.setLineDash([3, 3]);
        mc.beginPath(); mc.moveTo(x, yM(0)); mc.lineTo(x, yM(-margins.gainMargin)); mc.stroke();
        mc.setLineDash([]);
        mc.fillStyle = margins.gainMargin > 0 ? C.safe : C.warn;
        mc.font = "bold 9px monospace"; mc.textAlign = "center";
        mc.fillText("GM", x, Math.min(yM(0), yM(-margins.gainMargin)) - 5);
      }
    }

    // Crossover dot
    if (margins.gainCrossoverFreq) {
      const x = xOf(margins.gainCrossoverFreq);
      if (x >= pad.l && x <= W - pad.r) {
        mc.fillStyle = C.accent;
        mc.beginPath(); mc.arc(x, yM(0), 3.5, 0, Math.PI * 2); mc.fill();
      }
    }

    mc.save(); mc.translate(10, pad.t + ph / 2); mc.rotate(-Math.PI / 2);
    mc.fillStyle = C.textBright; mc.font = "10px monospace"; mc.textAlign = "center";
    mc.fillText("|L(jω)| dB", 0, 0); mc.restore();

    // Timescale labels
    const ann = [
      { label: "Tertiary", w: 0.003, c: "#7e57c2" },
      { label: "Secondary", w: 0.03, c: C.secondary },
      { label: "Primary", w: 0.5, c: C.accent },
      { label: "Inertia", w: 8, c: "#ef5350" },
    ];
    mc.font = "8px monospace"; mc.textAlign = "center";
    for (const a of ann) {
      const x = xOf(a.w);
      if (x >= pad.l + 10 && x <= W - pad.r - 10) {
        mc.fillStyle = a.c; mc.globalAlpha = 0.6; mc.fillText(a.label, x, pad.t + 10); mc.globalAlpha = 1;
      }
    }

    // ── Phase ──
    const pc = phaseCanvas.getContext("2d");
    pc.setTransform(dpr, 0, 0, dpr, 0, 0);
    pc.clearRect(0, 0, W, Hc);
    const phMin = -270, phMax = 0;
    const yP = (deg) => pad.t + ((phMax - deg) / (phMax - phMin)) * ph;

    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      const x = xOf(Math.pow(10, e));
      if (x >= pad.l && x <= W - pad.r) {
        pc.strokeStyle = C.grid; pc.lineWidth = 0.6;
        pc.beginPath(); pc.moveTo(x, pad.t); pc.lineTo(x, Hc - pad.b); pc.stroke();
        pc.fillStyle = C.text; pc.font = "9px monospace"; pc.textAlign = "center";
        const freq = Math.pow(10, e);
        pc.fillText(freq >= 1 ? freq.toFixed(0) : freq < 0.01 ? freq.toExponential(0) : freq.toFixed(freq < 0.1 ? 2 : 1), x, Hc - pad.b + 12);
      }
    }
    for (let deg = phMin; deg <= phMax; deg += 45) {
      const y = yP(deg);
      pc.strokeStyle = deg === -180 ? C.zeroline : C.grid;
      pc.lineWidth = deg === -180 ? 1.2 : 0.5;
      pc.beginPath(); pc.moveTo(pad.l, y); pc.lineTo(W - pad.r, y); pc.stroke();
      pc.fillStyle = C.text; pc.font = "9px monospace"; pc.textAlign = "right";
      pc.fillText(deg + "°", pad.l - 5, y + 3);
    }

    if (refPhases) {
      pc.strokeStyle = C.referenceDim; pc.lineWidth = 1.5; pc.setLineDash([4, 4]);
      pc.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = xOf(freqs[i]), y = yP(Math.max(phMin, Math.min(phMax, refPhases[i])));
        i === 0 ? pc.moveTo(x, y) : pc.lineTo(x, y);
      }
      pc.stroke(); pc.setLineDash([]);
    }

    pc.strokeStyle = C.secondary; pc.lineWidth = 2; pc.shadowColor = C.secondary; pc.shadowBlur = 5;
    pc.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = xOf(freqs[i]), y = yP(Math.max(phMin, Math.min(phMax, phases[i])));
      i === 0 ? pc.moveTo(x, y) : pc.lineTo(x, y);
    }
    pc.stroke(); pc.shadowBlur = 0;

    // PM marker
    if (margins.gainCrossoverFreq && margins.phaseMargin !== null) {
      const x = xOf(margins.gainCrossoverFreq);
      if (x >= pad.l && x <= W - pad.r) {
        pc.strokeStyle = margins.phaseMargin > 0 ? C.safe : C.warn;
        pc.lineWidth = 1.2; pc.setLineDash([3, 3]);
        pc.beginPath(); pc.moveTo(x, yP(-180)); pc.lineTo(x, yP(-180 + margins.phaseMargin)); pc.stroke();
        pc.setLineDash([]);
        pc.fillStyle = margins.phaseMargin > 0 ? C.safe : C.warn;
        pc.font = "bold 9px monospace"; pc.textAlign = "center";
        pc.fillText("PM", x, Math.min(yP(-180), yP(-180 + margins.phaseMargin)) - 5);
      }
    }

    pc.save(); pc.translate(10, pad.t + ph / 2); pc.rotate(-Math.PI / 2);
    pc.fillStyle = C.textBright; pc.font = "10px monospace"; pc.textAlign = "center";
    pc.fillText("∠L(jω) deg", 0, 0); pc.restore();

    pc.fillStyle = C.textBright; pc.font = "10px monospace"; pc.textAlign = "center";
    pc.fillText("ω [rad/s]", pad.l + pw / 2, Hc - 2);
  }, [freqs, mags, phases, refMags, refPhases, margins]);

  useEffect(() => {
    draw();
    const h = () => draw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw]);

  return (
    <div>
      <canvas ref={magRef} style={{ display: "block", width: "100%" }} />
      <canvas ref={phaseRef} style={{ display: "block", width: "100%", marginTop: 2 }} />
    </div>
  );
}

// ─── Nyquist Plot Component ───
function NyquistPlot({ freqs, complexPts, refComplexPts, margins, hoverFreq, onHover }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const Hc = 420;
    canvas.width = W * dpr; canvas.height = Hc * dpr;
    canvas.style.width = W + "px"; canvas.style.height = Hc + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hc);

    const pad = { l: 50, r: 20, t: 20, b: 36 };
    const pw = W - pad.l - pad.r;
    const ph = Hc - pad.t - pad.b;

    // Auto-scale based on data
    let reMin = -3, reMax = 2, imMin = -4, imMax = 2;
    for (const pt of complexPts) {
      if (Math.abs(pt.re) < 50 && Math.abs(pt.im) < 50) {
        reMin = Math.min(reMin, pt.re * 1.1);
        reMax = Math.max(reMax, pt.re * 1.1);
        imMin = Math.min(imMin, pt.im * 1.1);
        imMax = Math.max(imMax, pt.im * 1.1);
      }
    }
    // Ensure critical point (-1, 0) is visible with margin
    reMin = Math.min(reMin, -1.8);
    reMax = Math.max(reMax, 1);
    imMin = Math.min(imMin, -2);
    imMax = Math.max(imMax, 1);

    // Keep aspect ratio roughly equal
    const reRange = reMax - reMin;
    const imRange = imMax - imMin;
    const aspect = pw / ph;
    if (reRange / imRange > aspect) {
      const mid = (imMax + imMin) / 2;
      const half = (reRange / aspect) / 2;
      imMin = mid - half; imMax = mid + half;
    } else {
      const mid = (reMax + reMin) / 2;
      const half = (imRange * aspect) / 2;
      reMin = mid - half; reMax = mid + half;
    }

    const xOf = (re) => pad.l + ((re - reMin) / (reMax - reMin)) * pw;
    const yOf = (im) => pad.t + ((imMax - im) / (imMax - imMin)) * ph;

    // Grid lines
    ctx.strokeStyle = C.gridMinor; ctx.lineWidth = 0.4;
    for (let v = Math.ceil(reMin); v <= Math.floor(reMax); v++) {
      const x = xOf(v);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, Hc - pad.b); ctx.stroke();
    }
    for (let v = Math.ceil(imMin); v <= Math.floor(imMax); v++) {
      const y = yOf(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }

    // Axes
    const x0 = xOf(0), y0 = yOf(0);
    ctx.strokeStyle = C.zeroline; ctx.lineWidth = 1;
    if (x0 >= pad.l && x0 <= W - pad.r) {
      ctx.beginPath(); ctx.moveTo(x0, pad.t); ctx.lineTo(x0, Hc - pad.b); ctx.stroke();
    }
    if (y0 >= pad.t && y0 <= Hc - pad.b) {
      ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(W - pad.r, y0); ctx.stroke();
    }

    // Unit circle
    const ucx = xOf(0), ucy = yOf(0);
    const ucr = Math.abs(xOf(1) - xOf(0));
    ctx.strokeStyle = C.unitCircle; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ucx, ucy, ucr, 0, Math.PI * 2); ctx.stroke();

    // Axis labels
    ctx.fillStyle = C.text; ctx.font = "9px monospace"; ctx.textAlign = "center";
    for (let v = Math.ceil(reMin); v <= Math.floor(reMax); v++) {
      if (v === 0) continue;
      ctx.fillText(v.toString(), xOf(v), Hc - pad.b + 14);
    }
    ctx.textAlign = "right";
    for (let v = Math.ceil(imMin); v <= Math.floor(imMax); v++) {
      if (v === 0) continue;
      ctx.fillText(v + "j", pad.l - 5, yOf(v) + 3);
    }

    // Critical point (-1, 0)
    const cpx = xOf(-1), cpy = yOf(0);
    ctx.fillStyle = C.critical;
    ctx.beginPath(); ctx.arc(cpx, cpy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.beginPath(); ctx.arc(cpx, cpy, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.critical; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
    ctx.fillText("(-1, 0)", cpx + 10, cpy - 8);

    // Reference curve
    if (refComplexPts) {
      ctx.strokeStyle = C.nyqRef; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      let started = false;
      for (const pt of refComplexPts) {
        if (Math.abs(pt.re) > 50 || Math.abs(pt.im) > 50) { started = false; continue; }
        const x = xOf(pt.re), y = yOf(pt.im);
        if (x < pad.l - 10 || x > W - pad.r + 10 || y < pad.t - 10 || y > Hc - pad.b + 10) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Main Nyquist curve with frequency-based color gradient
    ctx.lineWidth = 2;
    for (let i = 1; i < complexPts.length; i++) {
      const p0 = complexPts[i - 1], p1 = complexPts[i];
      if (Math.abs(p0.re) > 50 || Math.abs(p0.im) > 50 || Math.abs(p1.re) > 50 || Math.abs(p1.im) > 50) continue;
      const x0p = xOf(p0.re), y0p = yOf(p0.im);
      const x1p = xOf(p1.re), y1p = yOf(p1.im);
      if (x0p < pad.l - 20 || x1p < pad.l - 20 || x0p > W - pad.r + 20 || x1p > W - pad.r + 20) continue;

      const t = i / complexPts.length;
      const r = Math.round(0 + t * 255);
      const g = Math.round(229 - t * 150);
      const b = Math.round(255 - t * 100);
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.moveTo(x0p, y0p); ctx.lineTo(x1p, y1p); ctx.stroke();
    }

    // Direction arrows along curve
    const arrowIndices = [Math.floor(complexPts.length * 0.15), Math.floor(complexPts.length * 0.4), Math.floor(complexPts.length * 0.65)];
    for (const idx of arrowIndices) {
      if (idx < 1 || idx >= complexPts.length) continue;
      const p0 = complexPts[idx - 1], p1 = complexPts[idx];
      if (Math.abs(p1.re) > 50 || Math.abs(p1.im) > 50) continue;
      const ax = xOf(p1.re), ay = yOf(p1.im);
      const dx = xOf(p1.re) - xOf(p0.re), dy = yOf(p1.im) - yOf(p0.im);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const ux = dx / len, uy = dy / len;
      const sz = 7;
      ctx.fillStyle = C.textBright;
      ctx.beginPath();
      ctx.moveTo(ax + ux * sz, ay + uy * sz);
      ctx.lineTo(ax - ux * sz / 2 - uy * sz, ay - uy * sz / 2 + ux * sz);
      ctx.lineTo(ax - ux * sz / 2 + uy * sz, ay - uy * sz / 2 - ux * sz);
      ctx.closePath(); ctx.fill();
    }

    // Hover interaction - show phasor and projections
    if (hoverFreq !== null) {
      const L = evalOpenLoop(hoverFreq, window.__lfc_params || {});
      if (Math.abs(L.re) < 50 && Math.abs(L.im) < 50) {
        const px = xOf(L.re), py = yOf(L.im);
        const ox = xOf(0), oy = yOf(0);

        // Phasor line from origin
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.stroke();

        // Re projection (damping axis)
        ctx.strokeStyle = C.reProj; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, oy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, oy); ctx.stroke();
        ctx.setLineDash([]);

        // Im projection (quadrature axis)
        ctx.strokeStyle = C.imProj; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ox, py); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, py); ctx.stroke();
        ctx.setLineDash([]);

        // Dot
        ctx.fillStyle = "#ffffff"; ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // Labels
        ctx.font = "10px monospace"; ctx.textAlign = "left";
        ctx.fillStyle = C.textBright;
        ctx.fillText(`ω = ${hoverFreq.toFixed(3)} rad/s`, px + 12, py - 24);
        ctx.fillStyle = C.reProj;
        ctx.fillText(`Re = ${L.re.toFixed(3)}`, px + 12, py - 10);
        ctx.fillStyle = C.imProj;
        ctx.fillText(`Im = ${L.im.toFixed(3)}`, px + 12, py + 4);

        const mag = cxMag(L);
        const phaseDeg = cxPhase(L);
        ctx.fillStyle = C.accent;
        ctx.fillText(`|L| = ${mag.toFixed(3)}`, px + 12, py + 18);
        ctx.fillStyle = C.secondary;
        ctx.fillText(`∠ = ${phaseDeg.toFixed(1)}°`, px + 12, py + 32);

        // Re projection label at axis
        ctx.fillStyle = C.reProj; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText("damping", px, oy + 14);

        // Im projection label at axis
        ctx.fillStyle = C.imProj; ctx.textAlign = "right";
        ctx.fillText("quadrature", ox - 5, py + 3);
      }
    }

    // Axis titles
    ctx.fillStyle = C.textBright; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("Re{L(jω)} — damping axis", pad.l + pw / 2, Hc - 4);
    ctx.save(); ctx.translate(10, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("Im{L(jω)} — quadrature", 0, 0); ctx.restore();

    // Color bar legend
    const barX = W - pad.r - 80, barY = pad.t + 6, barW = 70, barH = 8;
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, "rgb(0,229,255)"); grad.addColorStop(1, "rgb(255,79,155)");
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = C.text; ctx.font = "8px monospace";
    ctx.textAlign = "left"; ctx.fillText("ω low", barX, barY + 18);
    ctx.textAlign = "right"; ctx.fillText("ω high", barX + barW, barY + 18);

  }, [freqs, complexPts, refComplexPts, margins, hoverFreq]);

  useEffect(() => {
    draw();
    const h = () => draw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !complexPts.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const W = rect.width, Hc = rect.height;
    const pad = { l: 50, r: 20, t: 20, b: 36 };
    const pw = W - pad.l - pad.r;
    const ph = Hc - pad.t - pad.b;

    // Find nearest point on curve
    let bestDist = Infinity, bestIdx = 0;

    let reMin = -3, reMax = 2, imMin = -4, imMax = 2;
    for (const pt of complexPts) {
      if (Math.abs(pt.re) < 50 && Math.abs(pt.im) < 50) {
        reMin = Math.min(reMin, pt.re * 1.1); reMax = Math.max(reMax, pt.re * 1.1);
        imMin = Math.min(imMin, pt.im * 1.1); imMax = Math.max(imMax, pt.im * 1.1);
      }
    }
    reMin = Math.min(reMin, -1.8); reMax = Math.max(reMax, 1);
    imMin = Math.min(imMin, -2); imMax = Math.max(imMax, 1);
    const reRange = reMax - reMin, imRange = imMax - imMin;
    const aspect = pw / ph;
    if (reRange / imRange > aspect) {
      const mid = (imMax + imMin) / 2, half = (reRange / aspect) / 2;
      imMin = mid - half; imMax = mid + half;
    } else {
      const mid = (reMax + reMin) / 2, half = (imRange * aspect) / 2;
      reMin = mid - half; reMax = mid + half;
    }

    for (let i = 0; i < complexPts.length; i++) {
      const pt = complexPts[i];
      if (Math.abs(pt.re) > 50 || Math.abs(pt.im) > 50) continue;
      const px = pad.l + ((pt.re - reMin) / (reMax - reMin)) * pw;
      const py = pad.t + ((imMax - pt.im) / (imMax - imMin)) * ph;
      const d = (mx - px) * (mx - px) + (my - py) * (my - py);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (bestDist < 2500) {
      onHover(freqs[bestIdx]);
    } else {
      onHover(null);
    }
  }, [complexPts, freqs, onHover]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover(null)}
    />
  );
}

// ─── Slider ───
function Slider({ label, value, min, max, step, onChange, unit, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: C.text, fontSize: 10, fontFamily: "monospace" }}>{label}</span>
        <span style={{ color: color || C.accent, fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
          {typeof value === "number" ? (value < 0.01 ? value.toExponential(1) : value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)) : value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color || C.accent }} />
    </div>
  );
}

// ─── Main ───
export default function PowerSystemLFC() {
  const [H, setH] = useState(6.0);
  const [D, setD] = useState(1.0);
  const [R, setR] = useState(0.05);
  const [Tg, setTg] = useState(0.3);
  const [Tt, setTt] = useState(0.5);
  const [Ki, setKi] = useState(0.05);
  const [showSecondary, setShowSecondary] = useState(true);
  const [showReference, setShowReference] = useState(true);
  const [activeTab, setActiveTab] = useState("both");
  const [hoverFreq, setHoverFreq] = useState(null);

  const freqs = logspace(FREQ_MIN, FREQ_MAX, N_POINTS);
  const params = { H, D, R, Tg, Tt, Ki, showSecondary };

  // Store params globally for hover eval
  if (typeof window !== "undefined") window.__lfc_params = params;

  const mags = [], phases = [], rawPhases = [], complexPts = [];
  for (const w of freqs) {
    const L = evalOpenLoop(w, params);
    mags.push(20 * Math.log10(cxMag(L)));
    rawPhases.push(cxPhase(L));
    complexPts.push(L);
  }
  let prevPhase = rawPhases[0];
  phases.push(prevPhase);
  for (let i = 1; i < rawPhases.length; i++) {
    let p = rawPhases[i];
    while (p - prevPhase > 180) p -= 360;
    while (p - prevPhase < -180) p += 360;
    phases.push(p); prevPhase = p;
  }
  const margins = findMargins(freqs, mags, phases);

  // Reference
  const refParams = { H: 6, D: 1.0, R: 0.05, Tg: 0.3, Tt: 0.5, Ki: 0.05, showSecondary };
  let refMags = null, refPhases = null, refComplexPts = null;
  if (showReference) {
    refMags = []; const refRaw = []; refPhases = []; refComplexPts = [];
    for (const w of freqs) {
      const L = evalOpenLoop(w, refParams);
      refMags.push(20 * Math.log10(cxMag(L)));
      refRaw.push(cxPhase(L));
      refComplexPts.push(L);
    }
    let prev = refRaw[0]; refPhases.push(prev);
    for (let i = 1; i < refRaw.length; i++) {
      let p = refRaw[i];
      while (p - prev > 180) p -= 360;
      while (p - prev < -180) p += 360;
      refPhases.push(p); prev = p;
    }
  }

  const pmColor = margins.phaseMargin !== null ? (margins.phaseMargin > 30 ? C.safe : margins.phaseMargin > 0 ? C.secondary : C.warn) : C.text;
  const gmColor = margins.gainMargin !== null ? (margins.gainMargin > 6 ? C.safe : margins.gainMargin > 0 ? C.secondary : C.warn) : C.text;
  const status = margins.phaseMargin !== null && margins.phaseMargin > 30 && margins.gainMargin !== null && margins.gainMargin > 6
    ? { text: "STABLE", color: C.safe }
    : margins.phaseMargin !== null && margins.phaseMargin > 0 && margins.gainMargin !== null && margins.gainMargin > 0
    ? { text: "MARGINAL", color: C.secondary }
    : { text: "UNSTABLE", color: C.warn };

  const tabStyle = (t) => ({
    padding: "6px 14px", fontSize: 10, fontFamily: "monospace", fontWeight: activeTab === t ? 700 : 400,
    background: activeTab === t ? C.panel : "transparent",
    color: activeTab === t ? C.textBright : C.text,
    border: `1px solid ${activeTab === t ? C.grid : "transparent"}`,
    borderBottom: activeTab === t ? `1px solid ${C.panel}` : `1px solid ${C.grid}`,
    borderRadius: "4px 4px 0 0", cursor: "pointer", letterSpacing: 0.5,
  });

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.textBright, fontFamily: "monospace", padding: "12px 10px" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet" />

      <div style={{ marginBottom: 12, borderBottom: `1px solid ${C.grid}`, paddingBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.5, color: C.accent, textTransform: "uppercase" }}>
          Power System LFC — Bode & Nyquist
        </div>
        <div style={{ fontSize: 9, color: C.text, marginTop: 3 }}>
          L(jω) = [1/R + K_i/(jω)] · 1/(1+jωT_g) · 1/(1+jωT_t) · 1/(2Hjω+D)
          <span style={{ marginLeft: 8, color: C.reference }}>Kundur Ch.11</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {/* Controls */}
        <div style={{ width: 200, flexShrink: 0, background: C.panel, borderRadius: 5, padding: "10px 12px", border: `1px solid ${C.grid}` }}>
          <div style={{
            textAlign: "center", padding: "6px 0", marginBottom: 10, borderRadius: 4,
            background: status.color === C.safe ? C.safeDim : status.color === C.secondary ? C.secondaryDim : C.warnDim,
            border: `1px solid ${status.color}`,
          }}>
            <div style={{ fontSize: 9, color: C.text, letterSpacing: 1 }}>LOOP STATUS</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: status.color }}>{status.text}</div>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>Phase Margin</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: pmColor }}>
                {margins.phaseMargin !== null ? margins.phaseMargin.toFixed(1) + "°" : "—"}
              </div>
            </div>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>Gain Margin</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: gmColor }}>
                {margins.gainMargin !== null ? margins.gainMargin.toFixed(1) + " dB" : "—"}
              </div>
            </div>
          </div>

          <div style={{ background: C.bg, borderRadius: 3, padding: "3px 6px", marginBottom: 10, textAlign: "center" }}>
            <span style={{ fontSize: 8, color: C.text }}>ω_gc = </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>
              {margins.gainCrossoverFreq ? margins.gainCrossoverFreq.toFixed(3) : "—"} rad/s
            </span>
          </div>

          <div style={{ fontSize: 9, color: "#ef5350", letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" }}>System</div>
          <Slider label="H (inertia)" value={H} min={0.3} max={9} step={0.1} onChange={setH} unit="s" color="#ef5350" />
          <Slider label="D (damping)" value={D} min={0.1} max={3} step={0.1} onChange={setD} unit="pu" />

          <div style={{ fontSize: 9, color: C.accent, letterSpacing: 1, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Primary</div>
          <Slider label="R (droop)" value={R} min={0.01} max={0.1} step={0.005} onChange={setR} />
          <Slider label="Tg (governor)" value={Tg} min={0.05} max={1.0} step={0.05} onChange={setTg} unit="s" color={C.accent} />
          <Slider label="Tt (turbine)" value={Tt} min={0.1} max={5.0} step={0.1} onChange={setTt} unit="s" color={C.accent} />

          <div style={{ fontSize: 9, color: C.secondary, letterSpacing: 1, marginBottom: 4, marginTop: 8, textTransform: "uppercase" }}>Secondary</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <input type="checkbox" checked={showSecondary} onChange={(e) => setShowSecondary(e.target.checked)} style={{ accentColor: C.secondary }} />
            <span style={{ fontSize: 9, color: C.text }}>AGC integral</span>
          </div>
          <Slider label="Ki (AGC)" value={Ki} min={0.001} max={0.3} step={0.001} onChange={setKi} color={C.secondary} />

          <div style={{ borderTop: `1px solid ${C.grid}`, marginTop: 10, paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} style={{ accentColor: C.reference }} />
              <span style={{ fontSize: 9, color: C.text }}>Reference H=6s</span>
            </div>
          </div>
        </div>

        {/* Plots */}
        <div style={{ flex: 1, minWidth: 300 }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.grid}`, marginBottom: 0 }}>
            <button onClick={() => setActiveTab("both")} style={tabStyle("both")}>BOTH</button>
            <button onClick={() => setActiveTab("bode")} style={tabStyle("bode")}>BODE</button>
            <button onClick={() => setActiveTab("nyquist")} style={tabStyle("nyquist")}>NYQUIST</button>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.grid}`, borderTop: "none", borderRadius: "0 0 5px 5px", padding: 6 }}>
            {(activeTab === "both" || activeTab === "bode") && (
              <div>
                <BodePlot freqs={freqs} mags={mags} phases={phases}
                  refMags={showReference ? refMags : null} refPhases={showReference ? refPhases : null} margins={margins} />
              </div>
            )}

            {(activeTab === "both" || activeTab === "nyquist") && (
              <div style={{ marginTop: activeTab === "both" ? 6 : 0 }}>
                <NyquistPlot freqs={freqs} complexPts={complexPts}
                  refComplexPts={showReference ? refComplexPts : null} margins={margins}
                  hoverFreq={hoverFreq} onHover={setHoverFreq} />
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 12, marginTop: 6, padding: "5px 10px", background: C.panel, borderRadius: 3, fontSize: 9, flexWrap: "wrap" }}>
            <span><span style={{ color: C.accent }}>━</span> |L| magnitude</span>
            <span><span style={{ color: C.secondary }}>━</span> ∠L phase</span>
            <span><span style={{ color: C.critical }}>◉</span> critical (-1,0)</span>
            <span style={{ color: C.reProj }}>━ Re (damping)</span>
            <span style={{ color: C.imProj }}>━ Im (quadrature)</span>
            {showReference && <span><span style={{ color: C.referenceDim }}>╌</span> ref H=6s</span>}
          </div>

          {/* Explanation */}
          <div style={{ marginTop: 8, padding: "8px 10px", background: C.panel, borderRadius: 3, border: `1px solid ${C.grid}`, fontSize: 9, lineHeight: 1.6, color: C.text }}>
            <span style={{ color: C.accent, fontWeight: 700 }}>NYQUIST: </span>
            Hover over the curve to see the phasor decomposed into its orthogonal projections.
            <span style={{ color: C.reProj }}> Green (Re)</span> is the damping axis — negative means
            the correction opposes the error. <span style={{ color: C.imProj }}>Orange (Im)</span> is
            the quadrature axis — it shifts frequency but doesn't damp.
            When the curve passes through <span style={{ color: C.critical }}>(-1, 0)</span> the
            entire correction vector is pure reinforcement at unity gain. Two opposing vectors stop canceling.
            <br /><br />
            <span style={{ color: C.secondary, fontWeight: 700 }}>TRY: </span>
            Drag H from 6 → 0.5 and watch the Nyquist curve approach the critical point.
            The phasor tip creeps toward (-1, 0) — that's your stability margin vanishing in
            the complex plane.
          </div>
        </div>
      </div>
    </div>
  );
}
