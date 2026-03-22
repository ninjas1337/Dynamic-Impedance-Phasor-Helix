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

/*
  Single-area LFC open-loop transfer function (Kundur Ch.11-12):
  
  L(jω) = H_controller(jω) · G_gov(jω) · G_turb(jω) · G_plant(jω)
  
  where:
    H_controller = 1/R + K_i/(jω)           [droop + AGC integral]
    G_gov        = 1/(1 + jωT_g)            [governor]
    G_turb       = 1/(1 + jωT_t)            [turbine]
    G_plant      = 1/(2H·jω + D)            [swing equation]
*/
function evalOpenLoop(w, params) {
  const { H, D, R, Tg, Tt, Ki, showSecondary } = params;

  // Controller: droop + optional AGC
  const droop = cx(1 / R, 0);
  const agcTerm = showSecondary ? cx(0, -Ki / w) : cx(0, 0);
  const controller = cxAdd(droop, agcTerm);

  // Governor: 1/(1 + jwTg)
  const gov = cxInv(cx(1, w * Tg));

  // Turbine: 1/(1 + jwTt)
  const turb = cxInv(cx(1, w * Tt));

  // Plant (swing eq): 1/(2Hjw + D)
  const plant = cxInv(cx(D, 2 * H * w));

  return cxMul(cxMul(cxMul(controller, gov), turb), plant);
}

// Generate log-spaced frequencies
function logspace(start, end, n) {
  const arr = [];
  const logStart = Math.log10(start);
  const logEnd = Math.log10(end);
  for (let i = 0; i < n; i++) {
    arr.push(Math.pow(10, logStart + (i / (n - 1)) * (logEnd - logStart)));
  }
  return arr;
}

// Find gain crossover (0 dB) and phase crossover (-180°) by interpolation
function findMargins(freqs, mags, phases) {
  let gainCrossoverFreq = null;
  let phaseAtGainCrossover = null;
  let phaseCrossoverFreq = null;
  let gainAtPhaseCrossover = null;

  for (let i = 1; i < freqs.length; i++) {
    // Gain crossover: magnitude crosses 0 dB
    if ((mags[i - 1] >= 0 && mags[i] < 0) || (mags[i - 1] < 0 && mags[i] >= 0)) {
      if (!gainCrossoverFreq) {
        const t = (0 - mags[i - 1]) / (mags[i] - mags[i - 1]);
        gainCrossoverFreq = freqs[i - 1] * Math.pow(freqs[i] / freqs[i - 1], t);
        phaseAtGainCrossover = phases[i - 1] + t * (phases[i] - phases[i - 1]);
      }
    }
    // Phase crossover: phase crosses -180°
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
const N_POINTS = 600;

const COLORS = {
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
  ghost: "rgba(0,229,255,0.25)",
  reference: "#5c6bc0",
  referenceDim: "rgba(92,107,192,0.3)",
  zeroline: "#2a3a4f",
};

function BodePlot({ freqs, mags, phases, refMags, refPhases, margins, refMargins, params }) {
  const magRef = useRef(null);
  const phaseRef = useRef(null);

  const drawPlot = useCallback(() => {
    const magCanvas = magRef.current;
    const phaseCanvas = phaseRef.current;
    if (!magCanvas || !phaseCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = magCanvas.parentElement.clientWidth;
    const H_canvas = 240;

    for (const canvas of [magCanvas, phaseCanvas]) {
      canvas.width = W * dpr;
      canvas.height = H_canvas * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H_canvas + "px";
    }

    const pad = { l: 62, r: 20, t: 14, b: 32 };
    const pw = W - pad.l - pad.r;
    const ph = H_canvas - pad.t - pad.b;

    const logMin = Math.log10(FREQ_MIN);
    const logMax = Math.log10(FREQ_MAX);
    const xOf = (f) => pad.l + ((Math.log10(f) - logMin) / (logMax - logMin)) * pw;

    // Magnitude plot
    const magCtx = magCanvas.getContext("2d");
    magCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    magCtx.clearRect(0, 0, W, H_canvas);

    const magMin = -80;
    const magMax = 60;
    const yMag = (db) => pad.t + ((magMax - db) / (magMax - magMin)) * ph;

    // Grid
    magCtx.strokeStyle = COLORS.gridMinor;
    magCtx.lineWidth = 0.5;
    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      for (let m = 2; m <= 9; m++) {
        const x = xOf(m * Math.pow(10, e));
        if (x >= pad.l && x <= W - pad.r) {
          magCtx.beginPath();
          magCtx.moveTo(x, pad.t);
          magCtx.lineTo(x, H_canvas - pad.b);
          magCtx.stroke();
        }
      }
    }
    magCtx.strokeStyle = COLORS.grid;
    magCtx.lineWidth = 0.8;
    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      const x = xOf(Math.pow(10, e));
      if (x >= pad.l && x <= W - pad.r) {
        magCtx.beginPath();
        magCtx.moveTo(x, pad.t);
        magCtx.lineTo(x, H_canvas - pad.b);
        magCtx.stroke();
      }
    }
    for (let db = magMin; db <= magMax; db += 20) {
      const y = yMag(db);
      magCtx.strokeStyle = db === 0 ? COLORS.zeroline : COLORS.grid;
      magCtx.lineWidth = db === 0 ? 1.5 : 0.8;
      magCtx.beginPath();
      magCtx.moveTo(pad.l, y);
      magCtx.lineTo(W - pad.r, y);
      magCtx.stroke();
    }

    // 0 dB line label
    magCtx.fillStyle = COLORS.text;
    magCtx.font = "10px 'JetBrains Mono', 'Fira Code', monospace";
    magCtx.textAlign = "right";
    magCtx.textBaseline = "middle";
    for (let db = magMin; db <= magMax; db += 20) {
      magCtx.fillText(db + "", pad.l - 6, yMag(db));
    }

    // Reference curve (high H)
    if (refMags) {
      magCtx.strokeStyle = COLORS.referenceDim;
      magCtx.lineWidth = 1.8;
      magCtx.setLineDash([4, 4]);
      magCtx.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = xOf(freqs[i]);
        const y = yMag(Math.max(magMin, Math.min(magMax, refMags[i])));
        i === 0 ? magCtx.moveTo(x, y) : magCtx.lineTo(x, y);
      }
      magCtx.stroke();
      magCtx.setLineDash([]);
    }

    // Main curve
    magCtx.strokeStyle = COLORS.accent;
    magCtx.lineWidth = 2.2;
    magCtx.shadowColor = COLORS.accent;
    magCtx.shadowBlur = 6;
    magCtx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = xOf(freqs[i]);
      const y = yMag(Math.max(magMin, Math.min(magMax, mags[i])));
      i === 0 ? magCtx.moveTo(x, y) : magCtx.lineTo(x, y);
    }
    magCtx.stroke();
    magCtx.shadowBlur = 0;

    // Gain margin marker
    if (margins.phaseCrossoverFreq && margins.gainMargin !== null) {
      const x = xOf(margins.phaseCrossoverFreq);
      const y0 = yMag(0);
      const yGm = yMag(-margins.gainMargin);
      if (x >= pad.l && x <= W - pad.r) {
        magCtx.strokeStyle = margins.gainMargin > 0 ? COLORS.safe : COLORS.warn;
        magCtx.lineWidth = 1.5;
        magCtx.setLineDash([3, 3]);
        magCtx.beginPath();
        magCtx.moveTo(x, y0);
        magCtx.lineTo(x, yGm);
        magCtx.stroke();
        magCtx.setLineDash([]);
        magCtx.fillStyle = margins.gainMargin > 0 ? COLORS.safe : COLORS.warn;
        magCtx.font = "bold 10px 'JetBrains Mono', monospace";
        magCtx.textAlign = "center";
        magCtx.fillText("GM", x, Math.min(y0, yGm) - 6);
      }
    }

    // Gain crossover marker
    if (margins.gainCrossoverFreq) {
      const x = xOf(margins.gainCrossoverFreq);
      if (x >= pad.l && x <= W - pad.r) {
        magCtx.fillStyle = COLORS.accent;
        magCtx.beginPath();
        magCtx.arc(x, yMag(0), 4, 0, Math.PI * 2);
        magCtx.fill();
      }
    }

    // Y-axis label
    magCtx.save();
    magCtx.translate(12, pad.t + ph / 2);
    magCtx.rotate(-Math.PI / 2);
    magCtx.fillStyle = COLORS.textBright;
    magCtx.font = "11px 'JetBrains Mono', monospace";
    magCtx.textAlign = "center";
    magCtx.fillText("|L(jω)| [dB]", 0, 0);
    magCtx.restore();

    // Phase plot
    const phCtx = phaseCanvas.getContext("2d");
    phCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phCtx.clearRect(0, 0, W, H_canvas);

    const phMin = -270;
    const phMax = 0;
    const yPh = (deg) => pad.t + ((phMax - deg) / (phMax - phMin)) * ph;

    // Grid
    phCtx.strokeStyle = COLORS.gridMinor;
    phCtx.lineWidth = 0.5;
    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      for (let m = 2; m <= 9; m++) {
        const x = xOf(m * Math.pow(10, e));
        if (x >= pad.l && x <= W - pad.r) {
          phCtx.beginPath();
          phCtx.moveTo(x, pad.t);
          phCtx.lineTo(x, H_canvas - pad.b);
          phCtx.stroke();
        }
      }
    }
    phCtx.strokeStyle = COLORS.grid;
    phCtx.lineWidth = 0.8;
    for (let e = Math.ceil(Math.log10(FREQ_MIN)); e <= Math.floor(Math.log10(FREQ_MAX)); e++) {
      const x = xOf(Math.pow(10, e));
      phCtx.beginPath();
      phCtx.moveTo(x, pad.t);
      phCtx.lineTo(x, H_canvas - pad.b);
      phCtx.stroke();

      phCtx.fillStyle = COLORS.text;
      phCtx.font = "10px 'JetBrains Mono', monospace";
      phCtx.textAlign = "center";
      const freq = Math.pow(10, e);
      phCtx.fillText(freq >= 1 ? freq.toFixed(0) : freq < 0.01 ? freq.toExponential(0) : freq.toFixed(freq < 0.1 ? 2 : 1), x, H_canvas - pad.b + 14);
    }
    for (let deg = phMin; deg <= phMax; deg += 45) {
      const y = yPh(deg);
      phCtx.strokeStyle = deg === -180 ? COLORS.zeroline : COLORS.grid;
      phCtx.lineWidth = deg === -180 ? 1.5 : 0.8;
      phCtx.beginPath();
      phCtx.moveTo(pad.l, y);
      phCtx.lineTo(W - pad.r, y);
      phCtx.stroke();
    }

    phCtx.fillStyle = COLORS.text;
    phCtx.font = "10px 'JetBrains Mono', monospace";
    phCtx.textAlign = "right";
    for (let deg = phMin; deg <= phMax; deg += 45) {
      phCtx.fillText(deg + "°", pad.l - 6, yPh(deg));
    }

    // Reference phase
    if (refPhases) {
      phCtx.strokeStyle = COLORS.referenceDim;
      phCtx.lineWidth = 1.8;
      phCtx.setLineDash([4, 4]);
      phCtx.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = xOf(freqs[i]);
        const y = yPh(Math.max(phMin, Math.min(phMax, refPhases[i])));
        i === 0 ? phCtx.moveTo(x, y) : phCtx.lineTo(x, y);
      }
      phCtx.stroke();
      phCtx.setLineDash([]);
    }

    // Main phase curve
    phCtx.strokeStyle = COLORS.secondary;
    phCtx.lineWidth = 2.2;
    phCtx.shadowColor = COLORS.secondary;
    phCtx.shadowBlur = 6;
    phCtx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = xOf(freqs[i]);
      const y = yPh(Math.max(phMin, Math.min(phMax, phases[i])));
      i === 0 ? phCtx.moveTo(x, y) : phCtx.lineTo(x, y);
    }
    phCtx.stroke();
    phCtx.shadowBlur = 0;

    // Phase margin marker
    if (margins.gainCrossoverFreq && margins.phaseMargin !== null) {
      const x = xOf(margins.gainCrossoverFreq);
      const yTarget = yPh(-180);
      const yActual = yPh(-180 + margins.phaseMargin);
      if (x >= pad.l && x <= W - pad.r) {
        phCtx.strokeStyle = margins.phaseMargin > 0 ? COLORS.safe : COLORS.warn;
        phCtx.lineWidth = 1.5;
        phCtx.setLineDash([3, 3]);
        phCtx.beginPath();
        phCtx.moveTo(x, yTarget);
        phCtx.lineTo(x, yActual);
        phCtx.stroke();
        phCtx.setLineDash([]);
        phCtx.fillStyle = margins.phaseMargin > 0 ? COLORS.safe : COLORS.warn;
        phCtx.font = "bold 10px 'JetBrains Mono', monospace";
        phCtx.textAlign = "center";
        phCtx.fillText("PM", x, Math.min(yTarget, yActual) - 6);
      }
    }

    // Phase crossover marker
    if (margins.gainCrossoverFreq) {
      const x = xOf(margins.gainCrossoverFreq);
      const ph_at = -180 + (margins.phaseMargin || 0);
      if (x >= pad.l && x <= W - pad.r) {
        phCtx.fillStyle = COLORS.secondary;
        phCtx.beginPath();
        phCtx.arc(x, yPh(ph_at), 4, 0, Math.PI * 2);
        phCtx.fill();
      }
    }

    // Y-axis label
    phCtx.save();
    phCtx.translate(12, pad.t + ph / 2);
    phCtx.rotate(-Math.PI / 2);
    phCtx.fillStyle = COLORS.textBright;
    phCtx.font = "11px 'JetBrains Mono', monospace";
    phCtx.textAlign = "center";
    phCtx.fillText("∠L(jω) [deg]", 0, 0);
    phCtx.restore();

    // X-axis label
    phCtx.fillStyle = COLORS.textBright;
    phCtx.font = "11px 'JetBrains Mono', monospace";
    phCtx.textAlign = "center";
    phCtx.fillText("ω [rad/s]", pad.l + pw / 2, H_canvas - 2);

    // Timescale annotations on magnitude plot
    const annotations = [
      { label: "Tertiary", wCenter: 0.003, color: "#7e57c2" },
      { label: "Secondary (AGC)", wCenter: 0.03, color: COLORS.secondary },
      { label: "Primary (Gov)", wCenter: 0.5, color: COLORS.accent },
      { label: "Inertia", wCenter: 8, color: "#ef5350" },
    ];
    magCtx.font = "9px 'JetBrains Mono', monospace";
    magCtx.textAlign = "center";
    for (const a of annotations) {
      const x = xOf(a.wCenter);
      if (x >= pad.l + 10 && x <= W - pad.r - 10) {
        magCtx.fillStyle = a.color;
        magCtx.globalAlpha = 0.7;
        magCtx.fillText(a.label, x, pad.t + 12);
        magCtx.globalAlpha = 1;
      }
    }
  }, [freqs, mags, phases, refMags, refPhases, margins]);

  useEffect(() => {
    drawPlot();
    const handleResize = () => drawPlot();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawPlot]);

  return (
    <div>
      <canvas ref={magRef} style={{ display: "block", width: "100%" }} />
      <canvas ref={phaseRef} style={{ display: "block", width: "100%", marginTop: 4 }} />
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, unit, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: COLORS.text, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </span>
        <span style={{ color: color || COLORS.accent, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: "bold" }}>
          {typeof value === "number" ? (value < 0.01 ? value.toExponential(1) : value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)) : value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color || COLORS.accent }}
      />
    </div>
  );
}

export default function PowerSystemBode() {
  const [H, setH] = useState(6.0);
  const [D, setD] = useState(1.0);
  const [R, setR] = useState(0.05);
  const [Tg, setTg] = useState(0.3);
  const [Tt, setTt] = useState(0.5);
  const [Ki, setKi] = useState(0.05);
  const [showSecondary, setShowSecondary] = useState(true);
  const [showReference, setShowReference] = useState(true);

  const freqs = logspace(FREQ_MIN, FREQ_MAX, N_POINTS);

  // Current params
  const params = { H, D, R, Tg, Tt, Ki, showSecondary };
  const mags = [];
  const phases = [];
  const rawPhases = [];

  for (const w of freqs) {
    const L = evalOpenLoop(w, params);
    mags.push(20 * Math.log10(cxMag(L)));
    rawPhases.push(cxPhase(L));
  }

  // Unwrap phase
  let prevPhase = rawPhases[0];
  phases.push(prevPhase);
  for (let i = 1; i < rawPhases.length; i++) {
    let p = rawPhases[i];
    while (p - prevPhase > 180) p -= 360;
    while (p - prevPhase < -180) p += 360;
    phases.push(p);
    prevPhase = p;
  }

  const margins = findMargins(freqs, mags, phases);

  // Reference: H=6 conventional system
  let refMags = null;
  let refPhases = null;
  let refMargins = null;
  if (showReference) {
    const refParams = { H: 6, D: 1.0, R: 0.05, Tg: 0.3, Tt: 0.5, Ki: 0.05, showSecondary };
    refMags = [];
    const refRawPhases = [];
    refPhases = [];
    for (const w of freqs) {
      const L = evalOpenLoop(w, refParams);
      refMags.push(20 * Math.log10(cxMag(L)));
      refRawPhases.push(cxPhase(L));
    }
    let prev = refRawPhases[0];
    refPhases.push(prev);
    for (let i = 1; i < refRawPhases.length; i++) {
      let p = refRawPhases[i];
      while (p - prev > 180) p -= 360;
      while (p - prev < -180) p += 360;
      refPhases.push(p);
      prev = p;
    }
    refMargins = findMargins(freqs, refMags, refPhases);
  }

  const pmColor = margins.phaseMargin !== null ? (margins.phaseMargin > 30 ? COLORS.safe : margins.phaseMargin > 0 ? COLORS.secondary : COLORS.warn) : COLORS.text;
  const gmColor = margins.gainMargin !== null ? (margins.gainMargin > 6 ? COLORS.safe : margins.gainMargin > 0 ? COLORS.secondary : COLORS.warn) : COLORS.text;

  const stabilityStatus = margins.phaseMargin !== null && margins.phaseMargin > 30 && margins.gainMargin !== null && margins.gainMargin > 6
    ? { text: "STABLE", color: COLORS.safe }
    : margins.phaseMargin !== null && margins.phaseMargin > 0 && margins.gainMargin !== null && margins.gainMargin > 0
    ? { text: "MARGINAL", color: COLORS.secondary }
    : { text: "UNSTABLE", color: COLORS.warn };

  return (
    <div style={{
      background: COLORS.bg,
      minHeight: "100vh",
      color: COLORS.textBright,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      padding: "16px 12px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ marginBottom: 16, borderBottom: `1px solid ${COLORS.grid}`, paddingBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.5, color: COLORS.accent, textTransform: "uppercase" }}>
          Power System LFC — Open-Loop Bode
        </div>
        <div style={{ fontSize: 10, color: COLORS.text, marginTop: 4, lineHeight: 1.5 }}>
          L(jω) = [1/R + K<sub>i</sub>/(jω)] · 1/(1+jωT<sub>g</sub>) · 1/(1+jωT<sub>t</sub>) · 1/(2Hjω+D)
          <span style={{ marginLeft: 12, color: COLORS.reference }}>
            — Kundur Ch.11, Single-area model
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {/* Controls */}
        <div style={{
          width: 220,
          flexShrink: 0,
          background: COLORS.panel,
          borderRadius: 6,
          padding: "14px 14px",
          border: `1px solid ${COLORS.grid}`,
        }}>
          {/* Status */}
          <div style={{
            textAlign: "center",
            padding: "8px 0",
            marginBottom: 12,
            borderRadius: 4,
            background: stabilityStatus.color === COLORS.safe ? COLORS.safeDim
              : stabilityStatus.color === COLORS.secondary ? COLORS.secondaryDim
              : COLORS.warnDim,
            border: `1px solid ${stabilityStatus.color}`,
          }}>
            <div style={{ fontSize: 10, color: COLORS.text, letterSpacing: 1 }}>LOOP STATUS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: stabilityStatus.color }}>{stabilityStatus.text}</div>
          </div>

          {/* Margins */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, background: COLORS.bg, borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: COLORS.text }}>Phase Margin</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: pmColor }}>
                {margins.phaseMargin !== null ? margins.phaseMargin.toFixed(1) + "°" : "—"}
              </div>
            </div>
            <div style={{ flex: 1, background: COLORS.bg, borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: COLORS.text }}>Gain Margin</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: gmColor }}>
                {margins.gainMargin !== null ? margins.gainMargin.toFixed(1) + " dB" : "—"}
              </div>
            </div>
          </div>

          {/* ωgc */}
          <div style={{ background: COLORS.bg, borderRadius: 4, padding: "4px 8px", marginBottom: 14, textAlign: "center" }}>
            <span style={{ fontSize: 9, color: COLORS.text }}>ω<sub>gc</sub> = </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.accent }}>
              {margins.gainCrossoverFreq ? margins.gainCrossoverFreq.toFixed(3) : "—"} rad/s
            </span>
          </div>

          {/* Sliders */}
          <div style={{ fontSize: 10, color: COLORS.secondary, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>
            System Inertia
          </div>
          <Slider label="H (inertia constant)" value={H} min={0.3} max={9} step={0.1} onChange={setH} unit="s" color="#ef5350" />

          <div style={{ fontSize: 10, color: COLORS.text, letterSpacing: 1, marginBottom: 6, marginTop: 10, textTransform: "uppercase" }}>
            Plant
          </div>
          <Slider label="D (load damping)" value={D} min={0.1} max={3} step={0.1} onChange={setD} unit="pu" />
          <Slider label="R (droop)" value={R} min={0.01} max={0.1} step={0.005} onChange={setR} />

          <div style={{ fontSize: 10, color: COLORS.text, letterSpacing: 1, marginBottom: 6, marginTop: 10, textTransform: "uppercase" }}>
            Governor / Turbine
          </div>
          <Slider label="T_g (governor τ)" value={Tg} min={0.05} max={1.0} step={0.05} onChange={setTg} unit="s" color={COLORS.accent} />
          <Slider label="T_t (turbine τ)" value={Tt} min={0.1} max={5.0} step={0.1} onChange={setTt} unit="s" color={COLORS.accent} />

          <div style={{ fontSize: 10, color: COLORS.secondary, letterSpacing: 1, marginBottom: 6, marginTop: 10, textTransform: "uppercase" }}>
            AGC (Secondary)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input type="checkbox" checked={showSecondary} onChange={(e) => setShowSecondary(e.target.checked)}
              style={{ accentColor: COLORS.secondary }} />
            <span style={{ fontSize: 10, color: COLORS.text }}>Enable integral action</span>
          </div>
          <Slider label="K_i (AGC gain)" value={Ki} min={0.001} max={0.3} step={0.001} onChange={setKi} unit="" color={COLORS.secondary} />

          <div style={{ borderTop: `1px solid ${COLORS.grid}`, marginTop: 12, paddingTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)}
                style={{ accentColor: COLORS.reference }} />
              <span style={{ fontSize: 10, color: COLORS.text }}>Show reference (H=6s conventional)</span>
            </div>
          </div>
        </div>

        {/* Bode Plots */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <BodePlot
            freqs={freqs}
            mags={mags}
            phases={phases}
            refMags={showReference ? refMags : null}
            refPhases={showReference ? refPhases : null}
            margins={margins}
            refMargins={refMargins}
            params={params}
          />

          {/* Legend */}
          <div style={{
            display: "flex",
            gap: 16,
            marginTop: 8,
            padding: "6px 12px",
            background: COLORS.panel,
            borderRadius: 4,
            fontSize: 10,
            flexWrap: "wrap",
          }}>
            <span><span style={{ color: COLORS.accent }}>━━</span> |L(jω)| current</span>
            <span><span style={{ color: COLORS.secondary }}>━━</span> ∠L(jω) current</span>
            {showReference && <span><span style={{ color: COLORS.referenceDim }}>╌╌</span> Reference H=6s</span>}
            <span><span style={{ color: COLORS.safe }}>┊</span> PM</span>
            <span><span style={{ color: COLORS.safe }}>┊</span> GM</span>
          </div>

          {/* Physics note */}
          <div style={{
            marginTop: 10,
            padding: "10px 14px",
            background: COLORS.panel,
            borderRadius: 4,
            border: `1px solid ${COLORS.grid}`,
            fontSize: 10,
            lineHeight: 1.6,
            color: COLORS.text,
          }}>
            <span style={{ color: COLORS.accent, fontWeight: 700 }}>OBSERVATION: </span>
            Decreasing H shifts the plant pole (at ω ≈ D/2H) to higher frequency, 
            collapsing the natural low-pass filtering that rotating mass provides. 
            The gain crossover frequency increases, but phase lag from governor and turbine 
            dynamics erodes phase margin. At low H with aggressive AGC gain, 
            the system approaches instability — this is the fundamental Bode stability 
            limit that makes high-renewable grids harder to control.
            <br /><br />
            <span style={{ color: COLORS.secondary, fontWeight: 700 }}>TRY: </span>
            Drag H from 6s → 0.5s and watch the phase margin collapse. 
            Then increase K_i — the AGC integral action that should help at low frequency 
            adds additional phase lag near crossover, making things worse.
          </div>
        </div>
      </div>
    </div>
  );
}
