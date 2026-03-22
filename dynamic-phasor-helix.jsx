import { useState, useRef, useEffect, useCallback } from "react";

const C = {
  bg: "#0a0e17", panel: "#111827", grid: "#1e2a3a", text: "#8899aa",
  textBright: "#c8d8e8", accent: "#00e5ff", warn: "#ff5252", safe: "#69f0ae",
  secondary: "#ffab40", reference: "#5c6bc0", safeDim: "rgba(105,240,174,0.15)",
  secondaryDim: "rgba(255,171,64,0.15)", warnDim: "rgba(255,82,82,0.15)",
  envelope: "rgba(105,240,174,0.12)", envelopeEdge: "rgba(105,240,174,0.35)",
  helixStable: "#00e5ff", helixUnstable: "#ff5252",
};

// ── RK4 Step Response Simulation ──
function simulate(params, dt, tMax) {
  const { H, D, R, Tg, Tt, Ki, showSecondary } = params;
  const PL = 0.1;
  let x = [0, 0, 0, 0]; // [Δf, P_gov, P_turb, ∫Δf]
  const out = [];

  const f = (x) => {
    const kiTerm = showSecondary ? Ki * x[3] : 0;
    return [
      (x[2] - PL - D * x[0]) / (2 * H),
      (-(1 / R) * x[0] - kiTerm - x[1]) / Tg,
      (x[1] - x[2]) / Tt,
      x[0],
    ];
  };

  for (let t = 0; t <= tMax; t += dt) {
    out.push({ t, df: x[0], pg: x[1], pt: x[2] });
    const k1 = f(x);
    const x2 = x.map((v, i) => v + 0.5 * dt * k1[i]);
    const k2 = f(x2);
    const x3 = x.map((v, i) => v + 0.5 * dt * k2[i]);
    const k3 = f(x3);
    const x4 = x.map((v, i) => v + dt * k3[i]);
    const k4 = f(x4);
    x = x.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  return out;
}

// ── Closed-loop pole computation ──
// Characteristic equation: 1 + L(s) = 0
// Without AGC: (1+sTg)(1+sTt)(2Hs+D) + 1/R = 0
//   => 2H·Tg·Tt·s³ + (D·Tg·Tt + 2H(Tg+Tt))s² + (D(Tg+Tt) + 2H)s + (D + 1/R) = 0
// With AGC: s(1+sTg)(1+sTt)(2Hs+D) + s/R + Ki = 0
//   => 2H·Tg·Tt·s⁴ + (D·Tg·Tt + 2H(Tg+Tt))s³ + (D(Tg+Tt) + 2H)s² + (D + 1/R)s + Ki = 0

function charPolyCoeffs(params) {
  const { H, D, R, Tg, Tt, Ki, showSecondary } = params;
  if (showSecondary && Ki > 0) {
    // 4th order: a4·s⁴ + a3·s³ + a2·s² + a1·s + a0 = 0
    return [
      Ki,                                         // a0 (constant)
      D + 1 / R,                                  // a1
      D * (Tg + Tt) + 2 * H,                     // a2
      D * Tg * Tt + 2 * H * (Tg + Tt),           // a3
      2 * H * Tg * Tt,                            // a4
    ];
  } else {
    // 3rd order: a3·s³ + a2·s² + a1·s + a0 = 0
    return [
      D + 1 / R,                                  // a0
      D * (Tg + Tt) + 2 * H,                     // a1
      D * Tg * Tt + 2 * H * (Tg + Tt),           // a2
      2 * H * Tg * Tt,                            // a3
    ];
  }
}

// Durand-Kerner method for polynomial root finding
// poly = [a0, a1, ..., an] where p(s) = a0 + a1*s + ... + an*s^n
function findRoots(poly) {
  const n = poly.length - 1;
  if (n <= 0) return [];

  // Normalize
  const an = poly[n];
  const c = poly.map((v) => v / an);

  // Complex arithmetic helpers
  const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
  const cdiv = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    if (d < 1e-30) return { re: 0, im: 0 };
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  };

  // Evaluate polynomial at complex s
  const evalPoly = (s) => {
    let result = { re: c[n], im: 0 };
    for (let i = n - 1; i >= 0; i--) {
      result = { re: result.re * s.re - result.im * s.im + c[i], im: result.re * s.im + result.im * s.re };
    }
    return result;
  };

  // Better initial guesses - spread asymmetrically to avoid symmetric convergence
  let roots = [];
  const r0 = Math.pow(Math.abs(c[0]) + 1, 1 / n);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * (i + 0.5)) / n + 0.7;
    const ri = r0 * (0.8 + 0.4 * (i / n));
    roots.push({ re: ri * Math.cos(angle), im: ri * Math.sin(angle) });
  }

  // Iterate
  for (let iter = 0; iter < 500; iter++) {
    let maxDelta = 0;
    const newRoots = [...roots];

    for (let i = 0; i < n; i++) {
      const pi = evalPoly(roots[i]);
      let denom = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) {
        if (j !== i) {
          denom = cmul(denom, csub(roots[i], roots[j]));
        }
      }
      const delta = cdiv(pi, denom);
      newRoots[i] = csub(roots[i], delta);
      maxDelta = Math.max(maxDelta, Math.sqrt(delta.re * delta.re + delta.im * delta.im));
    }

    roots = newRoots;
    if (maxDelta < 1e-14) break;
  }

  return roots;
}

// Find dominant poles - separately identify oscillatory and real modes
function getDominantPole(params) {
  const poly = charPolyCoeffs(params);
  const roots = findRoots(poly);

  // Separate into oscillatory (complex) and real poles
  const complexPoles = [];
  const realPoles = [];
  const imThreshold = 0.01;

  for (const r of roots) {
    if (Math.abs(r.im) > imThreshold) {
      complexPoles.push(r);
    } else {
      realPoles.push({ re: r.re, im: 0 }); // Clean up tiny imaginary parts
    }
  }

  // Find dominant complex pole (least negative real part among oscillatory)
  let dominantComplex = null;
  let maxReComplex = -Infinity;
  for (const r of complexPoles) {
    if (r.re > maxReComplex) {
      maxReComplex = r.re;
      dominantComplex = r;
    }
  }

  // Find dominant real pole
  let dominantReal = null;
  let maxReReal = -Infinity;
  for (const r of realPoles) {
    if (r.re > maxReReal) {
      maxReReal = r.re;
      dominantReal = r;
    }
  }

  // Overall dominant = the one closest to imaginary axis
  let dominant;
  if (dominantComplex && dominantReal) {
    dominant = dominantComplex.re > dominantReal.re ? dominantComplex : dominantReal;
  } else {
    dominant = dominantComplex || dominantReal || (roots.length > 0 ? roots[0] : { re: -0.1, im: 0 });
  }

  return { roots, dominant, dominantComplex, dominantReal };
}

// Estimate oscillation frequency from zero crossings
function estimateOmega(data, dt) {
  const crossings = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].df * data[i].df < 0) crossings.push(i * dt);
  }
  if (crossings.length < 2) return 1;
  const periods = [];
  for (let i = 2; i < crossings.length; i += 2) {
    periods.push(crossings[i] - crossings[i - 2]);
  }
  if (periods.length === 0) {
    if (crossings.length >= 2) return Math.PI / (crossings[1] - crossings[0]);
    return 1;
  }
  const avgPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;
  return (2 * Math.PI) / avgPeriod;
}

// Compute helix coordinates from phase portrait
function computeHelix(data, dt) {
  const omega = estimateOmega(data, dt);
  const scale = omega > 0.01 ? 1 / omega : 1;
  const pts = [];

  for (let i = 0; i < data.length; i++) {
    const x = data[i].df;
    let y;
    if (i === 0) y = (data[1].df - data[0].df) / dt * scale;
    else if (i === data.length - 1) y = (data[i].df - data[i - 1].df) / dt * scale;
    else y = (data[i + 1].df - data[i - 1].df) / (2 * dt) * scale;

    const r = Math.sqrt(x * x + y * y);
    pts.push({ x, y, z: data[i].t, r, t: data[i].t });
  }
  return pts;
}

// ── 3D Projection ──
function rotatePoint(x, y, z, thetaX, thetaY) {
  // Rotate around Y
  let x1 = x * Math.cos(thetaY) + z * Math.sin(thetaY);
  let z1 = -x * Math.sin(thetaY) + z * Math.cos(thetaY);
  let y1 = y;
  // Rotate around X
  let y2 = y1 * Math.cos(thetaX) - z1 * Math.sin(thetaX);
  let z2 = y1 * Math.sin(thetaX) + z1 * Math.cos(thetaX);
  return { x: x1, y: y2, z: z2 };
}

function project(x, y, z, rot, W, Hc, viewDist) {
  const r = rotatePoint(x, y, z, rot.rx, rot.ry);
  const d = viewDist + r.z;
  const s = d > 10 ? viewDist / d : viewDist / 10;
  return { sx: W / 2 + r.x * s, sy: Hc / 2 - r.y * s, depth: r.z };
}

// ── 3D Canvas Component ──
function HelixView({ currentHelix, refHelix, refEnvelope, params, tMax, sigma }) {
  const canvasRef = useRef(null);
  const rotRef = useRef({ rx: -0.5, ry: 0.5 });
  const dragRef = useRef(null);
  const animRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth;
    const Hc = 600;
    canvas.width = W * dpr;
    canvas.height = Hc * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = Hc + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hc);

    const rot = rotRef.current;
    const viewDist = 500;

    // Scale factors
    const spatialScale = 3200;
    const tScale = 300 / tMax;
    const tOffset = -150;

    const p = (x, y, z) => project(
      x * spatialScale, z * tScale + tOffset, y * spatialScale,
      rot, W, Hc, viewDist
    );

    // ── Draw grid floor (at t=0) ──
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.4;
    const gridRange = 0.05;
    const gridStep = 0.0125;
    for (let v = -gridRange; v <= gridRange + 0.001; v += gridStep) {
      const p1 = p(v, -gridRange, 0);
      const p2 = p(v, gridRange, 0);
      ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
      const p3 = p(-gridRange, v, 0);
      const p4 = p(gridRange, v, 0);
      ctx.beginPath(); ctx.moveTo(p3.sx, p3.sy); ctx.lineTo(p4.sx, p4.sy); ctx.stroke();
    }

    // ── Draw axes ──
    const o = p(0, 0, 0);
    const axLen = 0.055;

    // Δf axis (x)
    const ax = p(axLen, 0, 0);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(ax.sx, ax.sy); ctx.stroke();
    ctx.fillStyle = C.accent; ctx.font = "11px monospace"; ctx.textAlign = "left";
    ctx.fillText("Δf", ax.sx + 4, ax.sy);

    // dΔf/dt axis (y)
    const ay = p(0, axLen, 0);
    ctx.strokeStyle = C.secondary; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(ay.sx, ay.sy); ctx.stroke();
    ctx.fillStyle = C.secondary;
    ctx.fillText("dΔf/dt", ay.sx + 4, ay.sy);

    // Time axis (z)
    const az = p(0, 0, tMax);
    ctx.strokeStyle = C.textBright; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(az.sx, az.sy); ctx.stroke();
    ctx.fillStyle = C.textBright; ctx.font = "10px monospace";
    ctx.fillText("t", az.sx + 4, az.sy);

    // Time tick marks
    for (let t = 5; t < tMax; t += 5) {
      const tp = p(0, 0, t);
      ctx.fillStyle = C.text; ctx.font = "8px monospace"; ctx.textAlign = "center";
      ctx.fillText(t + "s", tp.sx - 12, tp.sy + 3);
    }

    // ── Draw fixed reference envelope (H=6s conventional) ──
    if (refEnvelope && refEnvelope.length > 0) {
      const envSegments = 48;
      const envTimeStep = Math.max(1, Math.floor(refEnvelope.length / 40));

      for (let ti = 0; ti < refEnvelope.length; ti += envTimeStep) {
        const env = refEnvelope[ti];
        if (env.r < 0.0003) continue;

        const pts = [];
        for (let j = 0; j <= envSegments; j++) {
          const angle = (j / envSegments) * Math.PI * 2;
          const ex = env.r * Math.cos(angle);
          const ey = env.r * Math.sin(angle);
          pts.push(p(ex, ey, env.t));
        }

        ctx.strokeStyle = C.envelopeEdge;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let j = 0; j < pts.length; j++) {
          j === 0 ? ctx.moveTo(pts[j].sx, pts[j].sy) : ctx.lineTo(pts[j].sx, pts[j].sy);
        }
        ctx.stroke();
      }

      // Envelope surface ribs
      for (let j = 0; j < envSegments; j += 6) {
        const angle = (j / envSegments) * Math.PI * 2;
        ctx.strokeStyle = C.envelope;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        let started = false;
        for (let ti = 0; ti < refEnvelope.length; ti += envTimeStep) {
          const env = refEnvelope[ti];
          const drawR = env.r;
          const ex = drawR * Math.cos(angle);
          const ey = drawR * Math.sin(angle);
          const pp = p(ex, ey, env.t);
          if (!started) { ctx.moveTo(pp.sx, pp.sy); started = true; } else { ctx.lineTo(pp.sx, pp.sy); }
        }
        ctx.stroke();
      }
    }

    // ── Draw reference helix (dashed) ──
    if (refHelix && refHelix.length > 1) {
      ctx.strokeStyle = C.reference;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const rp0 = p(refHelix[0].x, refHelix[0].y, refHelix[0].z);
      ctx.moveTo(rp0.sx, rp0.sy);
      for (let i = 1; i < refHelix.length; i += 2) {
        const rp = p(refHelix[i].x, refHelix[i].y, refHelix[i].z);
        ctx.lineTo(rp.sx, rp.sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ── Draw current helix ──
    if (currentHelix && currentHelix.length > 1) {
      const redDots = [];

      for (let i = 1; i < currentHelix.length; i++) {
        const h0 = currentHelix[i - 1];
        const h1 = currentHelix[i];
        const pp0 = p(h0.x, h0.y, h0.z);
        const pp1 = p(h1.x, h1.y, h1.z);

        // Check if outside envelope (only meaningful after the initial transient)
        let outsideEnvelope = false;
        if (refEnvelope && i < refEnvelope.length) {
          const envR = refEnvelope[i].r;
          outsideEnvelope = h1.r > envR * 1.25 && envR > 0.0003 && h1.t > 1.0;
        }

        // Color by state
        const t = i / currentHelix.length;
        let color;
        if (outsideEnvelope) {
          color = C.warn;
          if (i % 4 === 0) redDots.push({ sx: pp1.sx, sy: pp1.sy, depth: pp1.depth });
        } else {
          const r = Math.round(0 + t * 100);
          const g = Math.round(229 - t * 80);
          const b = Math.round(255);
          color = `rgb(${r},${g},${b})`;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = outsideEnvelope ? 3 : 2.5;
        ctx.beginPath();
        ctx.moveTo(pp0.sx, pp0.sy);
        ctx.lineTo(pp1.sx, pp1.sy);
        ctx.stroke();
      }

      // Draw red dots
      for (const dot of redDots) {
        ctx.fillStyle = C.warn;
        ctx.shadowColor = C.warn;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Start point
      if (currentHelix.length > 0) {
        const sp = p(currentHelix[0].x, currentHelix[0].y, currentHelix[0].z);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(sp.sx, sp.sy, 5, 0, Math.PI * 2); ctx.fill();
      }

      // End point
      const last = currentHelix[currentHelix.length - 1];
      const ep = p(last.x, last.y, last.z);
      ctx.fillStyle = C.safe;
      ctx.beginPath(); ctx.arc(ep.sx, ep.sy, 4, 0, Math.PI * 2); ctx.fill();
    }

    // ── Labels ──
    ctx.fillStyle = C.text; ctx.font = "9px monospace"; ctx.textAlign = "left";
    ctx.fillText("Complex plane (Δf, dΔf/dt) × time", 10, 16);
    ctx.fillText("Drag to rotate", 10, Hc - 8);

    // Envelope legend
    ctx.fillStyle = C.envelopeEdge; ctx.fillText("○ Stability envelope (H=6s conventional reference)", 10, 30);
    ctx.fillStyle = C.accent; ctx.fillText("━ System helix (phase portrait × time)", 10, 42);
    ctx.fillStyle = C.warn; ctx.fillText("● Outside envelope = exceeds reference margins", 10, 54);
  }, [currentHelix, refHelix, refEnvelope, params, tMax, sigma]);

  useEffect(() => {
    draw();
    const h = () => draw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw]);

  const handleMouseDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, rx: rotRef.current.rx, ry: rotRef.current.ry };
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    rotRef.current = {
      rx: dragRef.current.rx + dy * 0.005,
      ry: dragRef.current.ry + dx * 0.005,
    };
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(draw);
  };

  const handleMouseUp = () => { dragRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", cursor: "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}

// ── Slider ──
function Slider({ label, value, min, max, step, onChange, unit, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: C.text, fontSize: 10, fontFamily: "monospace" }}>{label}</span>
        <span style={{ color: color || C.accent, fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
          {value < 0.01 ? value.toExponential(1) : value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color || C.accent }} />
    </div>
  );
}

// ── Main Component ──
export default function DynamicPhasorHelix() {
  const [H, setH] = useState(6.0);
  const [D, setD] = useState(1.0);
  const [R, setR] = useState(0.05);
  const [Tg, setTg] = useState(0.3);
  const [Tt, setTt] = useState(0.5);
  const [Ki, setKi] = useState(0.05);
  const [showSecondary, setShowSecondary] = useState(true);

  const dt = 0.02;
  const tMax = 40;

  const params = { H, D, R, Tg, Tt, Ki, showSecondary };

  // Simulate
  const currentData = simulate(params, dt, tMax);

  // Compute helix
  const currentHelix = computeHelix(currentData, dt);

  // ── Compute closed-loop poles for readouts ──
  const { roots: allPoles, dominant: dominantPole, dominantComplex } = getDominantPole(params);
  
  const envelopePole = dominantComplex || dominantPole;
  const sigma = envelopePole ? envelopePole.re : -0.1;
  const omega_d = dominantComplex ? Math.abs(dominantComplex.im) : (dominantPole ? Math.abs(dominantPole.im) : 0);

  const dampingRatio = dominantComplex && (dominantComplex.re * dominantComplex.re + dominantComplex.im * dominantComplex.im) > 1e-10
    ? -dominantComplex.re / Math.sqrt(dominantComplex.re * dominantComplex.re + dominantComplex.im * dominantComplex.im)
    : (dominantPole && dominantPole.re < 0 ? 1.0 : 0);

  // ── Fixed reference envelope: H=6s conventional system ──
  const refParams = { H: 6, D: 1.0, R: 0.05, Tg: 0.3, Tt: 0.5, Ki: 0.05, showSecondary };
  const refData = simulate(refParams, dt, tMax);
  const refHelix = computeHelix(refData, dt);
  const refEnvelope = refHelix.map((pt) => ({ t: pt.t, r: pt.r }));

  const maxRadius = Math.max(...currentHelix.map((p) => p.r));

  // Status: based on actual system behavior, not just envelope comparison
  const isUnstable = allPoles.some((p) => p.re > 0.01);

  // Check if helix is still outside envelope in the SECOND HALF of the simulation
  // Initial overshoot is expected with lower H — that's physics, not instability
  const halfIdx = Math.floor(currentHelix.length / 2);
  let lateExceeds = 0;
  let lateCount = 0;
  for (let i = halfIdx; i < currentHelix.length && i < refEnvelope.length; i++) {
    lateCount++;
    if (currentHelix[i].r > refEnvelope[i].r * 1.2 && refEnvelope[i].r > 0.0003) lateExceeds++;
  }
  const pctLateOutside = lateCount > 0 ? lateExceeds / lateCount : 0;

  // Also track overall for red dots visual
  let exceedsEnvelope = 0;
  for (let i = 0; i < currentHelix.length && i < refEnvelope.length; i++) {
    if (currentHelix[i].r > refEnvelope[i].r * 1.1 && refEnvelope[i].r > 0.0003) exceedsEnvelope++;
  }
  const pctOutside = exceedsEnvelope / currentHelix.length;

  const decaying = sigma < -0.02;
  const growing = isUnstable || sigma > 0.005;

  const status = isUnstable ? { text: "UNSTABLE", color: C.warn }
    : growing ? { text: "DIVERGING", color: C.warn }
    : pctLateOutside > 0.2 ? { text: "SLOW RECOVERY", color: C.warn }
    : pctLateOutside > 0.05 ? { text: "MARGINAL", color: C.secondary }
    : dampingRatio < 0.05 && dampingRatio > 0 ? { text: "LIGHTLY DAMPED", color: C.secondary }
    : { text: "STABLE", color: C.safe };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.textBright, fontFamily: "monospace", padding: "12px 10px" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet" />

      <div style={{ marginBottom: 10, borderBottom: `1px solid ${C.grid}`, paddingBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.5, color: C.accent, textTransform: "uppercase" }}>
          Dynamic Phasor Helix — LFC Stability
        </div>
        <div style={{ fontSize: 9, color: C.text, marginTop: 3 }}>
          Step response in phase space × time — envelope from closed-loop poles
          <span style={{ marginLeft: 8, color: C.reference }}>Kundur Ch.11 — Single area model</span>
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
            <div style={{ fontSize: 9, color: C.text, letterSpacing: 1 }}>HELIX STATUS</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: status.color }}>{status.text}</div>
          </div>

          {/* Dominant pole readout */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>σ (decay rate)</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: sigma < -0.1 ? C.safe : sigma < 0 ? C.secondary : C.warn }}>
                {sigma.toFixed(3)} /s
              </div>
            </div>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>ω_d (osc. freq)</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
                {omega_d.toFixed(3)} rad/s
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>ζ (damping ratio)</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: dampingRatio > 0.3 ? C.safe : dampingRatio > 0.1 ? C.secondary : C.warn }}>
                {dampingRatio.toFixed(3)}
              </div>
            </div>
            <div style={{ flex: 1, background: C.bg, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.text }}>Peak |Δf|</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
                {(maxRadius * 1000).toFixed(1)} mHz
              </div>
            </div>
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

          <div style={{ borderTop: `1px solid ${C.grid}`, marginTop: 10, paddingTop: 8, fontSize: 9, color: C.text, lineHeight: 1.6 }}>
            <span style={{ color: C.safe }}>Green envelope</span> = fixed reference (H=6s conventional).
            <span style={{ color: C.warn }}>Red dots</span> = helix exceeds reference boundary.
            Drag 3D view to rotate.
            <br />
            <span style={{ color: C.textBright }}>Poles:</span>{" "}
            {allPoles.map((p, i) => (
              <span key={i} style={{ color: p.re < -0.1 ? C.safe : p.re < 0 ? C.secondary : C.warn }}>
                {p.re.toFixed(2)}{p.im >= 0 ? "+" : ""}{p.im.toFixed(2)}j{i < allPoles.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        </div>

        {/* 3D View */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.grid}`, borderRadius: 5, padding: 4 }}>
            <HelixView
              currentHelix={currentHelix}
              refHelix={refHelix}
              refEnvelope={refEnvelope}
              params={params}
              tMax={tMax}
              sigma={sigma}
            />
          </div>

          <div style={{
            marginTop: 8, padding: "8px 10px", background: C.panel, borderRadius: 3,
            border: `1px solid ${C.grid}`, fontSize: 9, lineHeight: 1.7, color: C.text,
          }}>
            <span style={{ color: C.accent, fontWeight: 700 }}>WHAT YOU SEE: </span>
            The frequency deviation Δf and its rate of change dΔf/dt form a phase portrait.
            With time as the vertical axis, the trajectory becomes a helix.
            A stable system collapses inward — the spiral tightens as it rises.
            An unstable system expands — the spiral grows until the system trips.
            <br /><br />
            <span style={{ color: C.safe, fontWeight: 700 }}>ENVELOPE: </span>
            The green rings are the decay profile of a conventional H=6s system — the
            benchmark. This envelope is fixed. It shows how a well-inertia'd grid recovers.
            When your helix punches through these rings, your system deviates more than
            the conventional reference at that point in time.
            <br /><br />
            <span style={{ color: C.secondary, fontWeight: 700 }}>POLE READOUTS: </span>
            σ is the real part of the dominant oscillatory pole. It governs the decay rate.
            ζ is the damping ratio. ω_d is the oscillation frequency.
            These come from the characteristic equation of YOUR system — they change
            with the sliders and tell you the physics behind what the helix is doing.
            <br /><br />
            <span style={{ color: C.warn, fontWeight: 700 }}>TRY: </span>
            Drag H from 6 → 1. The helix expands beyond the fixed envelope.
            Red dots appear — your system now deviates more than a conventional grid would.
            That's the margin you've lost by removing inertia.
          </div>
        </div>
      </div>
    </div>
  );
}
